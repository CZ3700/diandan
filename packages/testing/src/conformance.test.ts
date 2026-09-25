import { describe, expect, test } from "vitest";

import type { CachePurgePort } from "@fan-support/cache-purge-port";
import {
  identityPortCommandSchema,
  type CreateAuthorizationRequestCommand,
  type ExchangeAuthorizationCodeCommand,
  type IdentityProvider,
} from "@fan-support/identity-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type { MediaStoragePort } from "@fan-support/media-port";
import type { TransactionManager } from "@fan-support/persistence-port";

import {
  createFakeIdentityProvider,
  createFakeNotificationProvider,
  createFakeNotificationProviderHarness,
} from "./fakes.js";
import { deterministicPortFixtures } from "./fixtures.js";
import {
  runIdentityProviderConformance,
  runCachePurgeConformance,
  runKeyManagementConformance,
  runMediaStorageConformance,
  runNotificationProviderConformance,
  runPersistenceConformance,
} from "./conformance.js";

function normalizedFailure(operation: string): unknown {
  return {
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code: "TEMPORARY_UNAVAILABLE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 1_000,
    },
  };
}

function mediaAdapter(
  invoke: (command: Readonly<{ operation: string }>) => Promise<unknown>,
): MediaStoragePort {
  return {
    createUploadGrant: invoke,
    inspectObject: invoke,
    createDownloadGrant: invoke,
    deleteObject: invoke,
    resolvePublicUrl: invoke,
  } as unknown as MediaStoragePort;
}

describe("framework-neutral port conformance", () => {
  test("rejects a persistence adapter that returns only schema-valid failures", async () => {
    const invalid = (operation: string) => ({
      schemaVersion: 1,
      operation,
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "INVALID_COMMAND",
        recovery: "NONE",
      },
    });
    const repositories = {
      idempotency: {
        begin: async (command: Readonly<{ operation: string }>) =>
          invalid(command.operation),
        complete: async (command: Readonly<{ operation: string }>) =>
          invalid(command.operation),
      },
      outbox: {
        append: async () => ({
          schemaVersion: 1,
          operation: "APPEND_OUTBOX_EVENT",
          outcome: "SUCCESS",
          value: {
            eventId: "30000000-0000-4000-8000-000000000001",
            appended: true,
          },
        }),
      },
      inventory: {
        loadManyForUpdate: async (command: Readonly<{ operation: string }>) =>
          invalid(command.operation),
        applyReservationCreation: async (
          command: Readonly<{ operation: string }>,
        ) => invalid(command.operation),
        applyReservationTransition: async (
          command: Readonly<{ operation: string }>,
        ) => invalid(command.operation),
      },
    };
    const manager = {
      runInTransaction: async (
        _options: unknown,
        work: (value: typeof repositories) => Promise<unknown>,
      ) => work(repositories),
    } as unknown as TransactionManager;

    const report = await runPersistenceConformance(manager);

    expect(report.passed).toBe(false);
    expect(report.cases).toHaveLength(6);
    expect(
      report.cases.every(
        (result) => result.failureCode === "SEMANTIC_MISMATCH",
      ),
    ).toBe(true);
    expect(report.cases).toContainEqual({
      schemaVersion: 1,
      caseName: "append-outbox-event",
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    });
  });

  test("accepts the deterministic identity and notification fakes", async () => {
    const identityReport = await runIdentityProviderConformance(
      createFakeIdentityProvider(),
    );
    const notificationReport = await runNotificationProviderConformance(
      createFakeNotificationProvider(),
    );

    expect(identityReport.passed).toBe(true);
    expect(notificationReport.passed).toBe(true);
  });

  test("keeps identity state encoded, expiring, and free of profile PII", async () => {
    const provider = createFakeIdentityProvider();
    const command = identityPortCommandSchema.parse({
      ...deterministicPortFixtures.identity.createAuthorizationRequest,
      state: "fixture/state+value-00000000000000000000000000",
    }) as CreateAuthorizationRequestCommand;

    const authorization = await provider.createAuthorizationRequest(command);
    const isolatedExchange = await provider.exchangeAuthorizationCode(
      deterministicPortFixtures.identity.exchangeAuthorizationCode,
    );

    expect(authorization.outcome).toBe("SUCCESS");
    if (authorization.outcome === "SUCCESS") {
      expect(authorization.value.authorizationUrl).toContain(
        encodeURIComponent(command.state),
      );
      expect(Date.parse(authorization.value.expiresAt)).toBeGreaterThan(
        Date.parse(command.requestedAt),
      );
    }
    expect(isolatedExchange).toMatchObject({
      outcome: "FAILURE",
      error: { code: "STATE_MISMATCH" },
    });
    expect(JSON.stringify(isolatedExchange)).not.toMatch(
      /email|displayName|@/iu,
    );
  });

  test("binds fake OIDC exchange to an issued state, nonce, redirect, and PKCE verifier", async () => {
    const provider = createFakeIdentityProvider();
    const create =
      deterministicPortFixtures.identity.createAuthorizationRequest;
    const exchange =
      deterministicPortFixtures.identity.exchangeAuthorizationCode;

    await expect(
      provider.createAuthorizationRequest(create),
    ).resolves.toMatchObject({
      outcome: "SUCCESS",
    });
    await expect(
      provider.exchangeAuthorizationCode({
        ...exchange,
        nonce: `${exchange.nonce.slice(0, -1)}x`,
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "NONCE_MISMATCH" },
    });
    await expect(
      provider.exchangeAuthorizationCode({
        ...exchange,
        code: "tampered-code",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_AUTHORIZATION_CODE" },
    });
    await expect(
      provider.exchangeAuthorizationCode(exchange),
    ).resolves.toMatchObject({
      outcome: "SUCCESS",
    });
    await expect(
      provider.exchangeAuthorizationCode(exchange),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_AUTHORIZATION_CODE" },
    });
  });

  test("consumes a fake OIDC authorization code globally across distinct states", async () => {
    const provider = createFakeIdentityProvider();
    const firstCreate =
      deterministicPortFixtures.identity.createAuthorizationRequest;
    const firstExchange =
      deterministicPortFixtures.identity.exchangeAuthorizationCode;
    const secondState = "second-state-0000000000000000000000000000000";
    const secondNonce = "second-nonce-0000000000000000000000000000000";
    const secondCreate = identityPortCommandSchema.parse({
      ...firstCreate,
      state: secondState,
      nonce: secondNonce,
    }) as CreateAuthorizationRequestCommand;
    const secondExchange = identityPortCommandSchema.parse({
      ...firstExchange,
      state: secondState,
      expectedState: secondState,
      nonce: secondNonce,
    }) as ExchangeAuthorizationCodeCommand;

    await provider.createAuthorizationRequest(firstCreate);
    await provider.createAuthorizationRequest(secondCreate);
    await expect(
      provider.exchangeAuthorizationCode(firstExchange),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
    await expect(
      provider.exchangeAuthorizationCode(secondExchange),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_AUTHORIZATION_CODE" },
    });
  });

  test("deep-freezes every deterministic port fixture node", () => {
    const visit = (value: unknown, seen = new WeakSet<object>()): void => {
      if (typeof value !== "object" || value === null || seen.has(value)) {
        return;
      }
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const nested of Object.values(value)) {
        visit(nested, seen);
      }
    };

    visit(deterministicPortFixtures);
    const command = deterministicPortFixtures.payment.createPayment;
    const originalAmount = command.amountMinor;
    expect(Reflect.set(command, "amountMinor", 1)).toBe(false);
    expect(command.amountMinor).toBe(originalAmount);
  });

  test("rejects an identity adapter that does not bind authorization responses", async () => {
    const provider = {
      async createAuthorizationRequest() {
        return {
          schemaVersion: 1,
          operation: "CREATE_AUTHORIZATION_REQUEST",
          outcome: "SUCCESS",
          value: {
            authorizationUrl:
              "https://identity.example.invalid/authorize?state=wrong",
            state: "wrong-state-000000000000000000000000000000000",
            expiresAt: "2026-09-03T00:05:00.000Z",
          },
        };
      },
      async exchangeAuthorizationCode() {
        return {
          schemaVersion: 1,
          operation: "EXCHANGE_AUTHORIZATION_CODE",
          outcome: "SUCCESS",
          value: {
            principal: {
              issuer: "https://wrong-issuer.example.invalid",
              subject: "synthetic-subject",
              authenticatedAt: "2026-09-03T00:00:00.000Z",
              mfa: true,
            },
          },
        };
      },
    } as unknown as IdentityProvider;

    const report = await runIdentityProviderConformance(provider);

    expect(report.passed).toBe(false);
    expect(
      report.cases.some((result) => result.failureCode === "SEMANTIC_MISMATCH"),
    ).toBe(true);
  });

  test("rejects an identity adapter that ignores issuer, client, redirect, or expiry binding", async () => {
    const underlying = createFakeIdentityProvider();
    const requests = new Map<string, CreateAuthorizationRequestCommand>();
    const provider = {
      async createAuthorizationRequest(
        command: CreateAuthorizationRequestCommand,
      ) {
        requests.set(command.state, command);
        return underlying.createAuthorizationRequest(command);
      },
      async exchangeAuthorizationCode(
        command: ExchangeAuthorizationCodeCommand,
      ) {
        const request = requests.get(command.state);
        return underlying.exchangeAuthorizationCode(
          request === undefined
            ? command
            : {
                ...command,
                issuer: request.issuer,
                clientId: request.clientId,
                redirectUri: request.redirectUri,
                receivedAt: request.requestedAt,
              },
        );
      },
    } as IdentityProvider;

    const report = await runIdentityProviderConformance(provider);

    expect(report.passed).toBe(false);
    expect(
      report.cases
        .filter((result) => !result.passed)
        .map((result) => result.caseName),
    ).toEqual([
      "reject-issuer-mismatch",
      "reject-client-id-mismatch",
      "reject-redirect-uri-mismatch",
      "reject-expired-authorization-code",
    ]);
  });

  test("rejects an authorization URL outside the reviewed provider endpoint", async () => {
    const underlying = createFakeIdentityProvider();
    const provider = {
      async createAuthorizationRequest(
        command: CreateAuthorizationRequestCommand,
      ) {
        const response = await underlying.createAuthorizationRequest(command);
        if (response.outcome !== "SUCCESS") {
          return response;
        }
        const authorizationUrl = new URL(response.value.authorizationUrl);
        authorizationUrl.hostname = "attacker.example.invalid";
        return {
          ...response,
          value: {
            ...response.value,
            authorizationUrl: authorizationUrl.toString(),
          },
        };
      },
      exchangeAuthorizationCode: (command: ExchangeAuthorizationCodeCommand) =>
        underlying.exchangeAuthorizationCode(command),
    } as IdentityProvider;

    const report = await runIdentityProviderConformance(provider);

    expect(report.passed).toBe(false);
    expect(report.cases[0]).toEqual({
      schemaVersion: 1,
      caseName: "create-authorization-request",
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    });
  });

  test("uses a fresh authorization transaction for every destructive OIDC case", () => {
    const transactions = Object.values(
      deterministicPortFixtures.identity.authorizationTransactions,
    );

    expect(
      new Set(
        transactions.map(
          ({ createAuthorizationRequest }) => createAuthorizationRequest.state,
        ),
      ).size,
    ).toBe(transactions.length);
    expect(
      new Set(
        transactions.map(
          ({ exchangeAuthorizationCode }) => exchangeAuthorizationCode.code,
        ),
      ).size,
    ).toBe(transactions.length);
  });

  test("requires key-management encryption to decrypt under the same AAD only", async () => {
    const fixedEnvelope = {
      ciphertext: `enc:v1:${"A".repeat(32)}`,
      encryptedDataKey: `enc:v1:${"B".repeat(32)}`,
      keyVersion: "fixture-envelope-v1",
      algorithm: "AES_256_GCM",
    } as const;
    const port = {
      async encryptEnvelope() {
        return {
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          outcome: "SUCCESS",
          value: fixedEnvelope,
        };
      },
      async encryptEnvelopeFields() {
        return {
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE_FIELDS",
          outcome: "SUCCESS",
          value: {
            fields: [
              {
                purpose: "SUPPORT_INTENT_MESSAGE",
                ciphertext: fixedEnvelope.ciphertext,
              },
              {
                purpose: "SUPPORT_INTENT_DISPLAY_NAME",
                ciphertext: fixedEnvelope.ciphertext,
              },
            ],
            encryptedDataKey: fixedEnvelope.encryptedDataKey,
            keyVersion: fixedEnvelope.keyVersion,
            algorithm: fixedEnvelope.algorithm,
          },
        };
      },
      async decryptEnvelope(command: { operation: string }) {
        return normalizedFailure(command.operation);
      },
      async computeBlindIndex() {
        return {
          schemaVersion: 1,
          operation: "COMPUTE_BLIND_INDEX",
          outcome: "SUCCESS",
          value: {
            digestBase64: "A".repeat(43),
            keyVersion:
              deterministicPortFixtures.keyManagement.computeBlindIndex
                .keyVersion,
            algorithm: "HMAC_SHA_256",
          },
        };
      },
    } as unknown as KeyManagementPort;

    const report = await runKeyManagementConformance(port);

    expect(report.passed).toBe(false);
    expect(report.cases).toContainEqual({
      schemaVersion: 1,
      caseName: "domain-separate-blind-index-purpose",
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    });
  });

  test("does not execute an inherited find getter from mutable key-management fixtures", async () => {
    const fixtures = JSON.parse(
      JSON.stringify(deterministicPortFixtures.keyManagement),
    ) as typeof deterministicPortFixtures.keyManagement;
    const fixedEnvelope = {
      ciphertext: `enc:v1:${"A".repeat(32)}`,
      encryptedDataKey: `enc:v1:${"B".repeat(32)}`,
      keyVersion: "fixture-envelope-v1",
      algorithm: "AES_256_GCM",
    } as const;
    const encryptedFields = [
      {
        purpose: "SUPPORT_INTENT_MESSAGE",
        ciphertext: fixedEnvelope.ciphertext,
      },
      {
        purpose: "SUPPORT_INTENT_DISPLAY_NAME",
        ciphertext: fixedEnvelope.ciphertext,
      },
    ] as const;
    const firstFixtureField =
      deterministicPortFixtures.keyManagement.encryptEnvelopeFields.fields[0];
    if (firstFixtureField === undefined) {
      throw new Error("key-management fixture must contain a plaintext field");
    }
    let inheritedFindGetterCalls = 0;
    let fixtureWasMutated = false;
    const port = {
      async encryptEnvelope() {
        return {
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          outcome: "SUCCESS",
          value: fixedEnvelope,
        };
      },
      async encryptEnvelopeFields() {
        return {
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE_FIELDS",
          outcome: "SUCCESS",
          value: {
            fields: encryptedFields,
            encryptedDataKey: fixedEnvelope.encryptedDataKey,
            keyVersion: fixedEnvelope.keyVersion,
            algorithm: fixedEnvelope.algorithm,
          },
        };
      },
      async decryptEnvelope() {
        if (!fixtureWasMutated) {
          const prototype = Object.create(Array.prototype) as object;
          Object.defineProperty(prototype, "find", {
            get() {
              inheritedFindGetterCalls += 1;
              throw new Error("must not execute inherited fixture methods");
            },
          });
          Object.setPrototypeOf(
            fixtures.encryptEnvelopeFields.fields,
            prototype,
          );
          fixtureWasMutated = true;
        }
        return {
          schemaVersion: 1,
          operation: "DECRYPT_ENVELOPE",
          outcome: "SUCCESS",
          value: {
            plaintextBase64: firstFixtureField.plaintextBase64,
          },
        };
      },
      async computeBlindIndex() {
        return {
          schemaVersion: 1,
          operation: "COMPUTE_BLIND_INDEX",
          outcome: "SUCCESS",
          value: {
            digestBase64: "A".repeat(43),
            keyVersion: fixtures.computeBlindIndex.keyVersion,
            algorithm: "HMAC_SHA_256",
          },
        };
      },
    } as unknown as KeyManagementPort;

    const report = await runKeyManagementConformance(port, fixtures);

    expect(report.passed).toBe(false);
    expect(report.cases).toContainEqual({
      schemaVersion: 1,
      caseName: "decrypt-envelope-message-field-round-trip",
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    });
    expect(inheritedFindGetterCalls).toBe(0);
  });

  test("rejects media success responses for a different object", async () => {
    const adapter = mediaAdapter(async (command) => {
      switch (command.operation) {
        case "CREATE_UPLOAD_GRANT":
          return {
            schemaVersion: 1,
            operation: command.operation,
            outcome: "SUCCESS",
            value: {
              method: "PUT",
              url: "https://media.example.invalid/wrong-object.jpg",
              headers: {},
              expiresAt: "2026-09-03T00:15:00.000Z",
            },
          };
        case "INSPECT_OBJECT":
          return {
            schemaVersion: 1,
            operation: command.operation,
            outcome: "SUCCESS",
            value: {
              storageClass: "DERIVATIVE",
              objectKey: "wrong-object.jpg",
              checksumSha256: "a".repeat(64),
              byteSize: 1,
              mimeType: "image/jpeg",
              revisionToken: "wrong-revision",
            },
          };
        case "CREATE_DOWNLOAD_GRANT":
          return {
            schemaVersion: 1,
            operation: command.operation,
            outcome: "SUCCESS",
            value: {
              method: "GET",
              url: "https://media.example.invalid/wrong-object.jpg",
              headers: {},
              expiresAt: "2026-09-03T00:15:00.000Z",
            },
          };
        case "DELETE_OBJECT":
          return {
            schemaVersion: 1,
            operation: command.operation,
            outcome: "SUCCESS",
            value: { objectKey: "wrong-object.jpg", deleted: true },
          };
        default:
          return {
            schemaVersion: 1,
            operation: command.operation,
            outcome: "SUCCESS",
            value: { url: "https://media.example.invalid/wrong-object.jpg" },
          };
      }
    });

    const report = await runMediaStorageConformance(adapter);

    expect(report.passed).toBe(false);
    expect(
      report.cases.some((result) => result.failureCode === "SEMANTIC_MISMATCH"),
    ).toBe(true);
  });

  test("binds cache status lookup to the reference returned by submit", async () => {
    const port = {
      async submitPurge(command: { paths: readonly string[] }) {
        if (command.paths.length > 1) {
          return {
            schemaVersion: 1,
            operation: "SUBMIT_PURGE",
            outcome: "FAILURE",
            error: {
              schemaVersion: 1,
              code: "IDEMPOTENCY_CONFLICT",
              recovery: "NONE",
            },
          };
        }
        return {
          schemaVersion: 1,
          operation: "SUBMIT_PURGE",
          outcome: "SUCCESS",
          value: {
            purgeReference: "wrong-submit/9999",
            status: "PENDING",
            submittedAt: "2026-09-03T00:00:00.000Z",
          },
        };
      },
      async getPurgeStatus() {
        return {
          schemaVersion: 1,
          operation: "GET_PURGE_STATUS",
          outcome: "SUCCESS",
          value: {
            purgeReference: "fixture-purge/0001",
            status: "COMPLETED",
          },
        };
      },
    } as unknown as CachePurgePort;

    const report = await runCachePurgeConformance(port);

    expect(report.passed).toBe(false);
    expect(report.cases).toContainEqual({
      schemaVersion: 1,
      caseName: "get-purge-status",
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    });
  });

  test("allows an idempotent cache replay to advance monotonically", async () => {
    let submitCalls = 0;
    const port = {
      async submitPurge(command: { paths: readonly string[] }) {
        if (command.paths.length > 1) {
          return {
            schemaVersion: 1,
            operation: "SUBMIT_PURGE",
            outcome: "FAILURE",
            error: {
              schemaVersion: 1,
              code: "IDEMPOTENCY_CONFLICT",
              recovery: "NONE",
            },
          };
        }
        submitCalls += 1;
        return {
          schemaVersion: 1,
          operation: "SUBMIT_PURGE",
          outcome: "SUCCESS",
          value: {
            purgeReference: "dynamic-purge/0001",
            status: submitCalls === 1 ? "PENDING" : "COMPLETED",
            submittedAt: "2026-09-03T00:00:00.000Z",
          },
        };
      },
      async getPurgeStatus(command: { purgeReference: string }) {
        return {
          schemaVersion: 1,
          operation: "GET_PURGE_STATUS",
          outcome: "SUCCESS",
          value: {
            purgeReference: command.purgeReference,
            status: "COMPLETED",
            completedAt: "2026-09-03T00:01:00.000Z",
          },
        };
      },
    } as unknown as CachePurgePort;

    const report = await runCachePurgeConformance(port);

    expect(report.passed).toBe(true);
  });

  test("rejects cache status that regresses after a completed replay", async () => {
    let submitCalls = 0;
    const port = {
      async submitPurge(command: { paths: readonly string[] }) {
        if (command.paths.length > 1) {
          return {
            schemaVersion: 1,
            operation: "SUBMIT_PURGE",
            outcome: "FAILURE",
            error: {
              schemaVersion: 1,
              code: "IDEMPOTENCY_CONFLICT",
              recovery: "NONE",
            },
          };
        }
        submitCalls += 1;
        return {
          schemaVersion: 1,
          operation: "SUBMIT_PURGE",
          outcome: "SUCCESS",
          value: {
            purgeReference: "dynamic-purge/0001",
            status: submitCalls === 1 ? "PENDING" : "COMPLETED",
            submittedAt: "2026-09-03T00:00:00.000Z",
          },
        };
      },
      async getPurgeStatus(command: { purgeReference: string }) {
        return {
          schemaVersion: 1,
          operation: "GET_PURGE_STATUS",
          outcome: "SUCCESS",
          value: {
            purgeReference: command.purgeReference,
            status: "PENDING",
          },
        };
      },
    } as unknown as CachePurgePort;

    const report = await runCachePurgeConformance(port);

    expect(report.passed).toBe(false);
    expect(report.cases).toContainEqual({
      schemaVersion: 1,
      caseName: "get-purge-status",
      passed: false,
      failureCode: "SEMANTIC_MISMATCH",
    });
  });

  test("replays notification attempts exactly and rejects key drift", async () => {
    const harness = createFakeNotificationProviderHarness();
    const command = deterministicPortFixtures.notification.sendNotification;

    const first = await harness.provider.sendNotification(command);
    const replay = await harness.provider.sendNotification(command);
    const conflict = await harness.provider.sendNotification({
      ...command,
      content: { ...command.content, subject: "Changed subject" },
    });

    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({
      outcome: "FAILURE",
      error: { code: "IDEMPOTENCY_CONFLICT", recovery: "NONE" },
    });
    expect(harness.deliveries()).toHaveLength(1);
    expect(JSON.stringify(harness.deliveries())).not.toMatch(
      /subject|preheader|text|html|contact|email|confirmed/iu,
    );
  });

  test("replays an unknown notification outcome with the same retry command", async () => {
    const harness = createFakeNotificationProviderHarness({
      outcome: "UNKNOWN",
    });
    const command = deterministicPortFixtures.notification.sendNotification;

    const first = await harness.provider.sendNotification(command);
    const replay = await harness.provider.sendNotification(command);

    expect(first).toMatchObject({
      outcome: "FAILURE",
      error: {
        code: "TIMEOUT_OUTCOME_UNKNOWN",
        recovery: "RETRY_SAME_COMMAND",
      },
    });
    expect(replay).toEqual(first);
    expect(harness.deliveries()).toHaveLength(1);
  });

  test("keeps all exported deterministic fixtures free of PII and secrets", () => {
    const serialized = JSON.stringify(deterministicPortFixtures);

    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    expect(serialized).not.toMatch(
      /fanMessage|displayName|secret|password|privateKey|accessKey|cardNumber|cvv/iu,
    );
  });

  test("rejects normalized-looking responses carrying raw provider details", async () => {
    const adapter = mediaAdapter(async (command) => ({
      ...(normalizedFailure(command.operation) as object),
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
        rawMessage: "must never cross the adapter boundary",
      },
    }));

    const report = await runMediaStorageConformance(adapter);

    expect(report.passed).toBe(false);
    expect(
      report.cases.every((result) => result.failureCode === "INVALID_RESPONSE"),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain("must never cross");
  });

  test("rejects non-JSON adapter objects before toJSON can hide provider fields", async () => {
    let toJsonCalls = 0;
    const adapter = mediaAdapter(async (command) => ({
      ...(normalizedFailure(command.operation) as object),
      providerRequest: () => "must never cross the adapter boundary",
      toJSON() {
        toJsonCalls += 1;
        return normalizedFailure(command.operation);
      },
    }));

    const report = await runMediaStorageConformance(adapter);

    expect(report.passed).toBe(false);
    expect(
      report.cases.every(
        (result) => result.failureCode === "NON_SERIALIZABLE_RESPONSE",
      ),
    ).toBe(true);
    expect(toJsonCalls).toBe(0);
  });

  test("rejects non-canonical adapter arrays without executing accessors", async () => {
    const scenarios: ReadonlyArray<
      Readonly<{
        name: string;
        createValue(recordGetterCall: () => void): unknown[];
      }>
    > = [
      {
        name: "custom Array prototype",
        createValue: () => {
          const value = ["safe"];
          Object.setPrototypeOf(value, Object.create(Array.prototype));
          return value;
        },
      },
      {
        name: "inherited toJSON getter",
        createValue: (recordGetterCall) => {
          const value = ["safe"];
          const prototype = Object.create(Array.prototype) as object;
          Object.defineProperty(prototype, "toJSON", {
            get() {
              recordGetterCall();
              return () => [];
            },
          });
          Object.setPrototypeOf(value, prototype);
          return value;
        },
      },
      {
        name: "inherited some getter",
        createValue: (recordGetterCall) => {
          const value = ["safe"];
          const prototype = Object.create(Array.prototype) as object;
          Object.defineProperty(prototype, "some", {
            get() {
              recordGetterCall();
              return Array.prototype.some;
            },
          });
          Object.setPrototypeOf(value, prototype);
          return value;
        },
      },
      {
        name: "inherited map getter",
        createValue: (recordGetterCall) => {
          const value = ["safe"];
          const prototype = Object.create(Array.prototype) as object;
          Object.defineProperty(prototype, "map", {
            get() {
              recordGetterCall();
              return Array.prototype.map;
            },
          });
          Object.setPrototypeOf(value, prototype);
          return value;
        },
      },
      {
        name: "index accessor",
        createValue: (recordGetterCall) => {
          const value: unknown[] = [];
          Object.defineProperty(value, "0", {
            configurable: true,
            enumerable: true,
            get() {
              recordGetterCall();
              return "safe";
            },
          });
          return value;
        },
      },
      {
        name: "non-enumerable index",
        createValue: () => {
          const value: unknown[] = [];
          Object.defineProperty(value, "0", {
            configurable: true,
            enumerable: false,
            value: "safe",
          });
          return value;
        },
      },
      {
        name: "sparse array",
        createValue: () => {
          const value: unknown[] = [];
          value.length = 2;
          value[1] = "safe";
          return value;
        },
      },
    ];

    for (const scenario of scenarios) {
      let getterCalls = 0;
      const adapter = mediaAdapter(async (command) => ({
        ...(normalizedFailure(command.operation) as object),
        providerData: scenario.createValue(() => {
          getterCalls += 1;
        }),
      }));

      const report = await runMediaStorageConformance(adapter);

      expect({
        scenario: scenario.name,
        failureCodes: report.cases.map((result) => result.failureCode),
      }).toEqual({
        scenario: scenario.name,
        failureCodes: Array.from(
          { length: report.cases.length },
          () => "NON_SERIALIZABLE_RESPONSE",
        ),
      });
      expect({ scenario: scenario.name, getterCalls }).toEqual({
        scenario: scenario.name,
        getterCalls: 0,
      });
    }
  });

  test("fails closed when adapter Proxy reflection throws", async () => {
    const scenarios: ReadonlyArray<
      Readonly<{
        name: string;
        createValue(): object;
      }>
    > = [
      {
        name: "getPrototypeOf trap",
        createValue: () =>
          new Proxy(
            {},
            {
              getPrototypeOf() {
                throw new Error("must stay inside conformance");
              },
            },
          ),
      },
      {
        name: "ownKeys trap",
        createValue: () =>
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error("must stay inside conformance");
              },
            },
          ),
      },
      {
        name: "getOwnPropertyDescriptor trap",
        createValue: () =>
          new Proxy(
            { safe: true },
            {
              getOwnPropertyDescriptor() {
                throw new Error("must stay inside conformance");
              },
            },
          ),
      },
      {
        name: "revoked object Proxy",
        createValue: () => {
          const revocable = Proxy.revocable({}, {});
          revocable.revoke();
          return revocable.proxy;
        },
      },
      {
        name: "revoked array Proxy",
        createValue: () => {
          const revocable = Proxy.revocable<unknown[]>([], {});
          revocable.revoke();
          return revocable.proxy;
        },
      },
    ];

    for (const scenario of scenarios) {
      const adapter = mediaAdapter(async (command) => ({
        ...(normalizedFailure(command.operation) as object),
        providerData: scenario.createValue(),
      }));

      const report = await runMediaStorageConformance(adapter);

      expect({
        scenario: scenario.name,
        failureCodes: report.cases.map((result) => result.failureCode),
      }).toEqual({
        scenario: scenario.name,
        failureCodes: Array.from(
          { length: report.cases.length },
          () => "NON_SERIALIZABLE_RESPONSE",
        ),
      });
    }
  });

  test("rejects stateful response Proxies without business-property reads", async () => {
    const underlying = createFakeIdentityProvider();
    const readProperties: PropertyKey[] = [];
    const wrap = <Response extends object>(response: Response): Response =>
      new Proxy(response, {
        get(target, property, receiver) {
          readProperties.push(property);
          if (property === "toJSON") {
            return () => ({ providerSecret: "must never cross" });
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
    const provider = {
      async createAuthorizationRequest(
        command: CreateAuthorizationRequestCommand,
      ) {
        return wrap(await underlying.createAuthorizationRequest(command));
      },
      async exchangeAuthorizationCode(
        command: ExchangeAuthorizationCodeCommand,
      ) {
        return wrap(await underlying.exchangeAuthorizationCode(command));
      },
    } as IdentityProvider;

    const report = await runIdentityProviderConformance(provider);

    expect(report.passed).toBe(false);
    expect(
      report.cases.every(
        (result) => result.failureCode === "NON_SERIALIZABLE_RESPONSE",
      ),
    ).toBe(true);
    expect(readProperties.filter((property) => property !== "then")).toEqual(
      [],
    );
    expect(JSON.stringify(report)).not.toContain("must never cross");
  });

  test("detects accessor mutation without executing the supplier getter", async () => {
    let getterCalls = 0;
    const fixtureCopy = JSON.parse(
      JSON.stringify(deterministicPortFixtures.media),
    ) as typeof deterministicPortFixtures.media;
    const adapter = mediaAdapter(async (command) => {
      Object.defineProperty(command, "supplierObject", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "must never execute";
        },
      });
      return normalizedFailure(command.operation);
    });

    const report = await runMediaStorageConformance(adapter, fixtureCopy);

    expect(report.passed).toBe(false);
    expect(
      report.cases.every((result) => result.failureCode === "COMMAND_MUTATED"),
    ).toBe(true);
    expect(getterCalls).toBe(0);
  });

  test("does not treat an all-temporary-failure adapter as conformant", async () => {
    const adapter = mediaAdapter(async (command) =>
      normalizedFailure(command.operation),
    );

    const report = await runMediaStorageConformance(adapter);

    expect(report.passed).toBe(false);
  });

  test("detects operation mismatches without exposing adapter output", async () => {
    const adapter = mediaAdapter(async () =>
      normalizedFailure("INSPECT_OBJECT"),
    );

    const report = await runMediaStorageConformance(adapter);

    expect(report.passed).toBe(false);
    expect(
      report.cases.some(
        (result) => result.failureCode === "OPERATION_MISMATCH",
      ),
    ).toBe(true);
  });

  test("fails when an adapter mutates a supplied fixture command", async () => {
    const fixtureCopy = JSON.parse(
      JSON.stringify(deterministicPortFixtures.media),
    ) as typeof deterministicPortFixtures.media;
    const adapter = mediaAdapter(async (command) => {
      (command as unknown as { objectKey: string }).objectKey =
        "fixtures/media/mutated.jpg";
      return normalizedFailure(command.operation);
    });

    const report = await runMediaStorageConformance(adapter, fixtureCopy);

    expect(report.passed).toBe(false);
    expect(
      report.cases.every((result) => result.failureCode === "COMMAND_MUTATED"),
    ).toBe(true);
  });
});
