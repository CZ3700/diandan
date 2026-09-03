import { Buffer } from "node:buffer";

import { describe, expect, test } from "vitest";

import * as contracts from "./index.js";

type SchemaLike = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean }>;
}>;

const contractExports = contracts as Record<string, unknown>;

function schema(name: string): SchemaLike {
  const candidate = contractExports[name] as SchemaLike | undefined;
  expect(candidate, `${name} must be exported`).toBeDefined();
  return candidate as SchemaLike;
}

describe("versioned adapter port contracts", () => {
  test.each([
    "paymentPortCommandSchema",
    "paymentPortResponseSchema",
    "mediaPortCommandSchema",
    "mediaPortResponseSchema",
    "identityPortCommandSchema",
    "identityPortResponseSchema",
    "notificationPortCommandSchema",
    "notificationPortResponseSchema",
    "cachePurgePortCommandSchema",
    "cachePurgePortResponseSchema",
    "keyManagementPortCommandSchema",
    "keyManagementPortResponseSchema",
    "persistencePortCommandSchema",
    "persistencePortResponseSchema",
    "persistenceTransactionFailureSchema",
  ])("exports the %s internal wire root", (name) => {
    expect(schema(name)).toBeDefined();
  });

  test("keeps transaction failures portable and recovery-safe", () => {
    const transactionFailureSchema = schema(
      "persistenceTransactionFailureSchema",
    );
    const outcomeUnknown = {
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      },
    };

    expect(transactionFailureSchema.safeParse(outcomeUnknown).success).toBe(
      true,
    );
    expect(
      transactionFailureSchema.safeParse({
        ...outcomeUnknown,
        error: { ...outcomeUnknown.error, recovery: "RETRY_SAME_COMMAND" },
      }).success,
    ).toBe(false);
    expect(
      transactionFailureSchema.safeParse({
        ...outcomeUnknown,
        rawSql: "forbidden supplier detail",
      }).success,
    ).toBe(false);
  });

  test("rejects unknown versions and unallowlisted provider error details", () => {
    const responseSchema = schema("mediaPortResponseSchema");
    const failure = {
      schemaVersion: 1,
      operation: "INSPECT_OBJECT",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "OBJECT_NOT_FOUND",
        recovery: "NONE",
      },
    };

    expect(responseSchema.safeParse(failure).success).toBe(true);
    expect(
      responseSchema.safeParse({ ...failure, schemaVersion: 2 }).success,
    ).toBe(false);
    expect(
      responseSchema.safeParse({
        ...failure,
        error: { ...failure.error, rawMessage: "provider detail" },
      }).success,
    ).toBe(false);
  });

  test("requires an opaque object revision before media deletion", () => {
    const commandSchema = schema("mediaPortCommandSchema");
    const deletion = {
      schemaVersion: 1,
      operation: "DELETE_OBJECT",
      storageClass: "SOURCE",
      objectKey: "source/asset-1/original.jpg",
      expectedChecksumSha256: "a".repeat(64),
    };

    expect(commandSchema.safeParse(deletion).success).toBe(false);
    expect(
      commandSchema.safeParse({
        ...deletion,
        expectedRevisionToken: "68b329da9893e34099c7d8ad5cb9c940",
      }).success,
    ).toBe(true);
    expect(
      commandSchema.safeParse({
        ...deletion,
        expectedRevisionToken: '"unsafe-provider-etag"',
      }).success,
    ).toBe(false);
  });

  test("rejects unsafe or oversized browser grant headers", () => {
    const responseSchema = schema("mediaPortResponseSchema");
    const response = {
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: "a".repeat(64),
        byteSize: 12,
        mimeType: "image/jpeg",
        method: "PUT",
        url: "https://uploads.example.invalid/signed",
        headers: { "content-type": "image/jpeg" },
        expiresAt: "2026-09-03T00:15:00.000Z",
      },
    };

    expect(responseSchema.safeParse(response).success).toBe(true);
    expect(
      responseSchema.safeParse({
        ...response,
        value: {
          ...response.value,
          headers: { "Content-Type": "image/jpeg" },
        },
      }).success,
    ).toBe(false);
    expect(
      responseSchema.safeParse({
        ...response,
        value: {
          ...response.value,
          headers: { "x-safe": "ok\r\nx-injected: yes" },
        },
      }).success,
    ).toBe(false);
  });

  test("allows credentialless localhost HTTPS media grants without weakening public URL roots", () => {
    const responseSchema = schema("mediaPortResponseSchema");
    const uploadGrant = {
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        checksumSha256: "a".repeat(64),
        byteSize: 12,
        mimeType: "image/jpeg",
        method: "PUT",
        url: "https://localhost:9443/private-source/source/asset-1/original.jpg?X-Amz-SignedHeaders=host",
        headers: { "content-type": "image/jpeg" },
        expiresAt: "2026-09-03T00:15:00.000Z",
      },
    };
    const downloadGrant = {
      schemaVersion: 1,
      operation: "CREATE_DOWNLOAD_GRANT",
      outcome: "SUCCESS",
      value: {
        storageClass: "SOURCE",
        objectKey: "source/asset-1/original.jpg",
        method: "GET",
        url: "https://localhost:9443/private-source/source/asset-1/original.jpg?X-Amz-SignedHeaders=host",
        headers: {},
        expiresAt: "2026-09-03T00:15:00.000Z",
      },
    };

    expect(responseSchema.safeParse(uploadGrant).success).toBe(true);
    expect(responseSchema.safeParse(downloadGrant).success).toBe(true);
  });

  test("rejects media object keys that URL resolution would normalize", () => {
    const commandSchema = schema("mediaPortCommandSchema");
    for (const objectKey of [
      "derivatives/./asset.webp",
      "derivatives//asset.webp",
      "derivatives/asset.webp/",
    ]) {
      expect(
        commandSchema.safeParse({
          schemaVersion: 1,
          operation: "INSPECT_OBJECT",
          storageClass: "DERIVATIVE",
          objectKey,
        }).success,
      ).toBe(false);
    }
    expect(
      commandSchema.safeParse({
        schemaVersion: 1,
        operation: "INSPECT_OBJECT",
        storageClass: "DERIVATIVE",
        objectKey: "derivatives/asset.webp",
      }).success,
    ).toBe(true);
  });

  test("keeps envelope data keys encrypted and serialized", () => {
    const responseSchema = schema("keyManagementPortResponseSchema");
    const valid = {
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      outcome: "SUCCESS",
      value: {
        algorithm: "AES_256_GCM",
        ciphertext: `enc:v1:${"A".repeat(32)}`,
        encryptedDataKey: `enc:v1:${"B".repeat(32)}`,
        keyVersion: "support-v1",
      },
    };

    expect(responseSchema.safeParse(valid).success).toBe(true);
    expect(
      responseSchema.safeParse({
        ...valid,
        value: { ...valid.value, plaintextDataKey: "forbidden" },
      }).success,
    ).toBe(false);
  });

  test("allows blind-index callers to select a retained key version", () => {
    const commandSchema = schema("keyManagementPortCommandSchema");
    const command = {
      schemaVersion: 1,
      operation: "COMPUTE_BLIND_INDEX",
      purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
      valueBase64: "Zml4dHVyZQ",
    };

    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...command,
        keyVersion: "blind-index-2026-08",
      }).success,
    ).toBe(true);
    expect(
      commandSchema.safeParse({ ...command, keyVersion: "../unsafe" }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...command,
        valueBase64: Buffer.alloc(4_051, 1).toString("base64url"),
      }).success,
    ).toBe(true);
    expect(
      commandSchema.safeParse({
        ...command,
        valueBase64: Buffer.alloc(4_052, 1).toString("base64url"),
      }).success,
    ).toBe(false);
  });

  test("requires canonical 32-byte HMAC-SHA-256 blind indexes", () => {
    const responseSchema = schema("keyManagementPortResponseSchema");
    const response = {
      schemaVersion: 1,
      operation: "COMPUTE_BLIND_INDEX",
      outcome: "SUCCESS",
      value: {
        digestBase64: Buffer.alloc(32, 1).toString("base64url"),
        keyVersion: "blind-index-2026-09",
        algorithm: "HMAC_SHA_256",
      },
    };

    expect(responseSchema.safeParse(response).success).toBe(true);
    expect(
      responseSchema.safeParse({
        ...response,
        value: { ...response.value, digestBase64: "AA" },
      }).success,
    ).toBe(false);
  });

  test("requires unique support-intent purposes in shared envelope encryption", () => {
    const commandSchema = schema("keyManagementPortCommandSchema");
    const command = {
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE_FIELDS",
      subjectId: "00000000-0000-4000-8000-000000000001",
      fields: [
        {
          purpose: "SUPPORT_INTENT_MESSAGE",
          plaintextBase64: "bWVzc2FnZQ",
        },
        {
          purpose: "SUPPORT_INTENT_DISPLAY_NAME",
          plaintextBase64: "bmlja25hbWU",
        },
      ],
    };

    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...command,
        fields: [command.fields[0], command.fields[0]],
      }).success,
    ).toBe(false);
  });

  test("binds normalized error codes to their only safe recovery action", () => {
    const paymentError = schema("paymentPortErrorSchema");
    expect(
      paymentError.safeParse({
        schemaVersion: 1,
        code: "TIMEOUT_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      }).success,
    ).toBe(true);
    expect(
      paymentError.safeParse({
        schemaVersion: 1,
        code: "TIMEOUT_OUTCOME_UNKNOWN",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      }).success,
    ).toBe(false);

    const notificationError = schema("notificationPortErrorSchema");
    expect(
      notificationError.safeParse({
        schemaVersion: 1,
        code: "TIMEOUT_OUTCOME_UNKNOWN",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      }).success,
    ).toBe(true);
    expect(
      notificationError.safeParse({
        schemaVersion: 1,
        code: "TIMEOUT_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      }).success,
    ).toBe(false);

    const mediaError = schema("mediaPortErrorSchema");
    expect(
      mediaError.safeParse({
        schemaVersion: 1,
        code: "RATE_LIMITED",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      }).success,
    ).toBe(true);
    expect(
      mediaError.safeParse({
        schemaVersion: 1,
        code: "OBJECT_NOT_FOUND",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      }).success,
    ).toBe(false);

    const persistenceError = schema("persistencePortErrorSchema");
    expect(
      persistenceError.safeParse({
        schemaVersion: 1,
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      }).success,
    ).toBe(true);
    expect(
      persistenceError.safeParse({
        schemaVersion: 1,
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      }).success,
    ).toBe(false);
    expect(
      persistenceError.safeParse({
        schemaVersion: 1,
        code: "INVALID_COMMAND",
        recovery: "NONE",
      }).success,
    ).toBe(true);
    expect(
      persistenceError.safeParse({
        schemaVersion: 1,
        code: "INVALID_COMMAND",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      }).success,
    ).toBe(false);
    expect(
      persistenceError.safeParse({
        schemaVersion: 1,
        code: "TRANSACTION_ABORTED",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 100,
      }).success,
    ).toBe(true);
    expect(
      persistenceError.safeParse({
        schemaVersion: 1,
        code: "TRANSACTION_ABORTED",
        recovery: "NONE",
      }).success,
    ).toBe(false);
  });

  test("allows unknown payment outcomes only after mutating operations", () => {
    const responseSchema = schema("paymentPortResponseSchema");
    const failureFor = (operation: string) => ({
      schemaVersion: 1,
      operation,
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TIMEOUT_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      },
    });

    for (const operation of [
      "CREATE_PAYMENT",
      "CANCEL_PAYMENT",
      "REFUND_PAYMENT",
    ]) {
      expect(responseSchema.safeParse(failureFor(operation)).success).toBe(
        true,
      );
    }
    for (const operation of [
      "GET_CAPABILITIES",
      "VERIFY_AND_PARSE_WEBHOOK",
      "GET_PAYMENT",
      "RECONCILE_PAYMENT",
      "RECONCILE_REFUND",
    ]) {
      expect(responseSchema.safeParse(failureFor(operation)).success).toBe(
        false,
      );
    }
  });

  test("allows create-payment reconciliation before an external reference exists", () => {
    const commandSchema = schema("paymentPortCommandSchema");
    const reconcile = {
      schemaVersion: 1,
      operation: "RECONCILE_PAYMENT",
      providerAccountId: "10000000-0000-4000-8000-000000000003",
      environment: "TEST",
      attemptId: "10000000-0000-4000-8000-000000000001",
      merchantReference: "10000000-0000-4000-8000-000000000001",
      providerIdempotencyKey: "10000000-0000-4000-8000-000000000001",
      amountMinor: 2_500,
      currency: "USD",
      auditLogId: "10000000-0000-4000-8000-000000000006",
    };

    expect(commandSchema.safeParse(reconcile).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...reconcile,
        merchantReference: "10000000-0000-4000-8000-000000000099",
      }).success,
    ).toBe(false);
  });

  test("requires reconciliation for malformed mutation responses", () => {
    const responseSchema = schema("paymentPortResponseSchema");
    const failureFor = (operation: string, recovery: string) => ({
      schemaVersion: 1,
      operation,
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "MALFORMED_PROVIDER_RESPONSE",
        recovery,
      },
    });

    for (const operation of [
      "CREATE_PAYMENT",
      "CANCEL_PAYMENT",
      "REFUND_PAYMENT",
    ]) {
      expect(
        responseSchema.safeParse(failureFor(operation, "RECONCILE_REQUIRED"))
          .success,
      ).toBe(true);
      expect(
        responseSchema.safeParse(failureFor(operation, "NONE")).success,
      ).toBe(false);
    }
    expect(
      responseSchema.safeParse(failureFor("GET_PAYMENT", "RECONCILE_REQUIRED"))
        .success,
    ).toBe(false);
    expect(
      responseSchema.safeParse(failureFor("GET_PAYMENT", "NONE")).success,
    ).toBe(true);
  });

  test("restarts authorization when a one-time code exchange outcome is unknown", () => {
    const responseSchema = schema("identityPortResponseSchema");
    const failure = {
      schemaVersion: 1,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "EXCHANGE_OUTCOME_UNKNOWN",
        recovery: "RESTART_AUTHORIZATION",
      },
    };

    expect(responseSchema.safeParse(failure).success).toBe(true);
    expect(
      responseSchema.safeParse({
        ...failure,
        error: {
          ...failure.error,
          recovery: "RETRY_SAME_COMMAND",
          retryAfterMs: 1_000,
        },
      }).success,
    ).toBe(false);
    expect(
      responseSchema.safeParse({
        ...failure,
        operation: "CREATE_AUTHORIZATION_REQUEST",
      }).success,
    ).toBe(false);
  });

  test("requires a canonical SHA-256 PKCE challenge encoding", () => {
    const challengeSchema = schema("oidcPkceCodeChallengeSchema");
    const valid = "DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo";
    expect(challengeSchema.safeParse(valid).success).toBe(true);
    expect(challengeSchema.safeParse(`${valid.slice(0, -1)}p`).success).toBe(
      false,
    );
  });

  test("bounds notification revisions and rejects header control characters", () => {
    const commandSchema = schema("notificationPortCommandSchema");
    const base = {
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      notification: {
        schemaVersion: 1,
        id: "10000000-0000-4000-8000-000000000007",
        orderId: "10000000-0000-4000-8000-000000000002",
        customerContactId: "10000000-0000-4000-8000-000000000008",
        eventType: "PAYMENT_CONFIRMED",
        locale: {
          schemaVersion: 1,
          requestedLocale: "en",
          resolvedLocale: "en",
          fallbackUsed: false,
          templateKey: "order.payment.confirmed",
          templateVersion: "fixture-v1",
          contentRevisionIds: [],
        },
        idempotencyKey: "notification-fixture-0001",
        correlationId: "10000000-0000-4000-8000-000000000009",
      },
      channel: "EMAIL",
      content: {
        subject: "Confirmed",
        preheader: "Ready",
        text: "Confirmed",
        html: "<p>Confirmed</p>",
      },
    };

    expect(commandSchema.safeParse(base).success).toBe(true);
    for (const field of ["subject", "preheader"] as const) {
      expect(
        commandSchema.safeParse({
          ...base,
          content: { ...base.content, [field]: `unsafe\u0000${field}` },
        }).success,
      ).toBe(false);
    }
    const revisionId = "20000000-0000-4000-8000-000000000001";
    expect(
      commandSchema.safeParse({
        ...base,
        notification: {
          ...base.notification,
          locale: {
            ...base.notification.locale,
            contentRevisionIds: [revisionId, revisionId],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...base,
        notification: {
          ...base.notification,
          locale: {
            ...base.notification.locale,
            contentRevisionIds: Array.from(
              { length: 65 },
              (_, index) =>
                `20000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
            ),
          },
        },
      }).success,
    ).toBe(false);
  });

  test("keeps malformed notification outcomes safely replayable", () => {
    const responseSchema = schema("notificationPortResponseSchema");
    const failure = {
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "MALFORMED_PROVIDER_RESPONSE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 1_000,
      },
    };
    expect(responseSchema.safeParse(failure).success).toBe(true);
    expect(
      responseSchema.safeParse({
        ...failure,
        error: { ...failure.error, recovery: "NONE", retryAfterMs: undefined },
      }).success,
    ).toBe(false);
  });

  test("requires public media resolutions to use internet-safe URLs", () => {
    const responseSchema = schema("mediaPortResponseSchema");
    const response = {
      schemaVersion: 1,
      operation: "RESOLVE_PUBLIC_URL",
      outcome: "SUCCESS",
      value: {
        storageClass: "DERIVATIVE",
        objectKey: "fixtures/media/public-image.webp",
        url: "https://media.example.invalid/fixtures/media/public-image.webp",
      },
    };
    expect(responseSchema.safeParse(response).success).toBe(true);
    for (const url of [
      "https://localhost/fixtures/media/public-image.webp",
      "https://127.0.0.1/fixtures/media/public-image.webp",
    ]) {
      expect(
        responseSchema.safeParse({
          ...response,
          value: { ...response.value, url },
        }).success,
      ).toBe(false);
    }
  });

  test("bounds and canonicalizes payment webhook headers", () => {
    const commandSchema = schema("paymentPortCommandSchema");
    const command = {
      schemaVersion: 1,
      operation: "VERIFY_AND_PARSE_WEBHOOK",
      providerAccountId: "10000000-0000-4000-8000-000000000001",
      environment: "TEST",
      webhookInboxId: "10000000-0000-4000-8000-000000000002",
      rawBodyBase64: "e30",
      headers: { "x-fixture-signature": "valid" },
      receivedAt: "2026-09-03T00:00:00.000Z",
    };

    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...command,
        headers: { "X-Fixture-Signature": "valid" },
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...command,
        headers: { "x-fixture-signature": "valid\r\ninjected: value" },
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...command,
        headers: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`x-${index}`, "v"]),
        ),
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...command,
        headers: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [
            `x-large-${index}`,
            "v".repeat(8_192),
          ]),
        ),
      }).success,
    ).toBe(false);
  });

  test("keeps webhook-sized envelope plaintext and ciphertext representable", () => {
    const commandSchema = schema("keyManagementPortCommandSchema");
    const encryptedSchema = schema("encryptedValueSchema");
    const command = {
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "WEBHOOK_PAYLOAD",
      subjectId: "10000000-0000-4000-8000-000000000001",
      plaintextBase64: "A".repeat(65_536),
    };

    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...command,
        plaintextBase64: `${command.plaintextBase64}A`,
      }).success,
    ).toBe(false);
    expect(
      encryptedSchema.safeParse(`enc:v1:${"A".repeat(65_574)}`).success,
    ).toBe(true);
    expect(
      encryptedSchema.safeParse(`enc:v1:${"A".repeat(65_575)}`).success,
    ).toBe(false);
  });

  test("accepts only canonical unpadded base64url values", () => {
    const base64 = schema("portBase64Schema");

    for (const value of ["Zg", "Zm8", "Zm9v", "ZmljdHVyZQ"]) {
      expect(base64.safeParse(value).success).toBe(true);
    }
    for (const value of ["A", "abcde", "Zh", "Zm9", "Zg=", "Zg=="]) {
      expect(base64.safeParse(value).success).toBe(false);
    }
  });

  test("binds a refund ID to its provider idempotency key", () => {
    const commandSchema = schema("paymentPortCommandSchema");
    const refund = {
      schemaVersion: 1,
      operation: "REFUND_PAYMENT",
      providerAccountId: "10000000-0000-4000-8000-000000000001",
      environment: "TEST",
      refundId: "10000000-0000-4000-8000-000000000002",
      paymentAttemptId: "10000000-0000-4000-8000-000000000003",
      externalReference: "fake-payment/fixture",
      refundReference: "merchant-refund/fixture",
      amountMinor: 2_500,
      currency: "USD",
      idempotencyKey: "10000000-0000-4000-8000-000000000002",
    };

    expect(commandSchema.safeParse(refund).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...refund,
        idempotencyKey: "10000000-0000-4000-8000-000000000004",
      }).success,
    ).toBe(false);
  });

  test("supports only RFC 7636 PKCE verifiers and S256 challenges", () => {
    const commandSchema = schema("identityPortCommandSchema");
    const verifierWithTilde = `${"A".repeat(42)}~`;
    const base = {
      schemaVersion: 1,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      issuer: "https://identity.example.invalid",
      clientId: "fan-support-admin",
      redirectUri: "https://admin.example.invalid/oidc/callback",
      code: "fixture-code",
      state: "s".repeat(43),
      expectedState: "s".repeat(43),
      nonce: "n".repeat(43),
      codeVerifier: verifierWithTilde,
      receivedAt: "2026-09-03T00:00:00.000Z",
    };

    expect(commandSchema.safeParse(base).success).toBe(true);
    expect(
      commandSchema.safeParse({ ...base, codeVerifier: "too-short" }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...base,
        codeVerifier: `${"A".repeat(42)}+`,
      }).success,
    ).toBe(false);
  });

  test("keeps OIDC identifiers opaque while rejecting control characters", () => {
    const commandSchema = schema("identityPortCommandSchema");
    const responseSchema = schema("identityPortResponseSchema");
    const command = {
      schemaVersion: 1,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      issuer: "https://identity.example.invalid",
      clientId: "fan~support|admin",
      redirectUri: "https://admin.example.invalid/oidc/callback",
      code: "valid~oauth|code",
      state: "s".repeat(43),
      expectedState: "s".repeat(43),
      nonce: "n".repeat(43),
      codeVerifier: "A".repeat(43),
      receivedAt: "2026-09-03T00:00:00.000Z",
    };
    const response = {
      schemaVersion: 1,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      outcome: "SUCCESS",
      value: {
        principal: {
          issuer: command.issuer,
          subject: "auth0|fixture-user",
          authenticatedAt: command.receivedAt,
          mfa: true,
        },
      },
    };

    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(responseSchema.safeParse(response).success).toBe(true);
    for (const field of ["clientId", "code"] as const) {
      expect(
        commandSchema.safeParse({
          ...command,
          [field]: `${command[field]}\r\ninjected`,
        }).success,
      ).toBe(false);
    }
    expect(
      responseSchema.safeParse({
        ...response,
        value: {
          principal: { ...response.value.principal, subject: "subject\u0000x" },
        },
      }).success,
    ).toBe(false);
  });

  test("binds verified webhook responses to the command trust context", () => {
    const matcher = contractExports["paymentPortResponseMatchesCommand"];
    expect(matcher).toBeTypeOf("function");
    const command = {
      schemaVersion: 1,
      operation: "VERIFY_AND_PARSE_WEBHOOK",
      providerAccountId: "10000000-0000-4000-8000-000000000001",
      environment: "TEST",
      webhookInboxId: "10000000-0000-4000-8000-000000000002",
      rawBodyBase64: "e30",
      headers: { "x-fixture-signature": "valid" },
      receivedAt: "2026-09-03T00:00:00.000Z",
    };
    const response = {
      schemaVersion: 1,
      operation: "VERIFY_AND_PARSE_WEBHOOK",
      outcome: "SUCCESS",
      value: {
        event: {
          schemaVersion: 1,
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          providerEventId: "fixture-event-1",
          evidence: {
            kind: "VERIFIED_WEBHOOK",
            webhookInboxId: command.webhookInboxId,
          },
          occurredAt: command.receivedAt,
          association: {
            status: "UNMATCHED",
            externalReference: "fixture-payment-1",
          },
          eventType: "PAYMENT_STATUS",
          status: "SUCCEEDED",
          amountMinor: 2_500,
          currency: "USD",
        },
      },
    };

    const matches = matcher as (command: unknown, response: unknown) => boolean;
    expect(matches(command, response)).toBe(true);
    expect(
      matches(command, {
        ...response,
        value: {
          event: {
            ...response.value.event,
            environment: "LIVE",
            evidence: {
              kind: "AUTHENTICATED_RECONCILE",
              auditLogId: "10000000-0000-4000-8000-000000000003",
            },
          },
        },
      }),
    ).toBe(false);
  });

  test("rejects capabilities leaked from another market or currency", () => {
    const matcher = contractExports["paymentPortResponseMatchesCommand"] as (
      command: unknown,
      response: unknown,
    ) => boolean;
    const command = {
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      providerAccountId: "10000000-0000-4000-8000-000000000001",
      environment: "TEST",
      market: "AMERICAS",
      country: "US",
      currency: "USD",
      amountMinor: 2_500,
      requestedLocale: "en",
      supportedActionTypes: ["REDIRECT"],
    };
    const matchingCapability = {
      schemaVersion: 1,
      id: "10000000-0000-4000-8000-000000000002",
      paymentMethod: "fixture_card",
      displayName: "Fixture card",
      market: "AMERICAS",
      country: "US",
      currency: "USD",
      minimumAmountMinor: 1,
      maximumAmountMinor: 10_000,
      actionTypes: ["REDIRECT"],
      available: true,
    };
    const response = {
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      outcome: "SUCCESS",
      value: { capabilities: [matchingCapability] },
    };

    expect(matcher(command, response)).toBe(true);
    expect(
      matcher(command, {
        ...response,
        value: {
          capabilities: [
            matchingCapability,
            {
              ...matchingCapability,
              id: "10000000-0000-4000-8000-000000000003",
              market: "SOUTHEAST_ASIA",
              country: "TH",
              currency: "THB",
            },
          ],
        },
      }),
    ).toBe(false);

    const commandSchema = schema("paymentPortCommandSchema");
    const responseSchema = schema("paymentPortResponseSchema");
    expect(
      commandSchema.safeParse({
        ...command,
        supportedActionTypes: ["REDIRECT", "REDIRECT"],
      }).success,
    ).toBe(false);
    expect(
      responseSchema.safeParse({
        ...response,
        value: {
          capabilities: [
            {
              ...matchingCapability,
              actionTypes: ["REDIRECT", "REDIRECT"],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test("bounds public HTTPS URLs carried across provider ports", () => {
    const urlSchema = schema("publicHttpsUrlSchema");
    const prefix = "https://example.invalid/";

    expect(
      urlSchema.safeParse(`${prefix}${"a".repeat(8_192 - prefix.length)}`)
        .success,
    ).toBe(true);
    expect(
      urlSchema.safeParse(`${prefix}${"a".repeat(8_193 - prefix.length)}`)
        .success,
    ).toBe(false);
  });

  test("rejects non-public payment and identity destinations at port roots", () => {
    const paymentCommandSchema = schema("paymentPortCommandSchema");
    const identityCommandSchema = schema("identityPortCommandSchema");
    const payment = {
      schemaVersion: 1,
      operation: "CREATE_PAYMENT",
      providerAccountId: "10000000-0000-4000-8000-000000000001",
      environment: "TEST",
      attemptId: "10000000-0000-4000-8000-000000000002",
      orderId: "10000000-0000-4000-8000-000000000003",
      paymentMethod: "fixture_card",
      amountMinor: 2_500,
      currency: "USD",
      requestedLocale: "en",
      merchantReference: "10000000-0000-4000-8000-000000000002",
      providerIdempotencyKey: "10000000-0000-4000-8000-000000000002",
      returnUrl: "https://store.example.invalid/payment/return",
      cancelUrl: "https://store.example.invalid/payment/cancel",
    };
    const identity = {
      schemaVersion: 1,
      operation: "CREATE_AUTHORIZATION_REQUEST",
      issuer: "https://identity.example.invalid",
      clientId: "fan-support-admin",
      redirectUri: "https://admin.example.invalid/oidc/callback",
      state: "s".repeat(43),
      nonce: "n".repeat(43),
      codeChallenge: "DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo",
      requestedAt: "2026-09-03T00:00:00.000Z",
    };

    expect(paymentCommandSchema.safeParse(payment).success).toBe(true);
    expect(identityCommandSchema.safeParse(identity).success).toBe(true);
    expect(
      paymentCommandSchema.safeParse({
        ...payment,
        returnUrl: "https://127.0.0.1/payment/return",
      }).success,
    ).toBe(false);
    expect(
      paymentCommandSchema.safeParse({
        ...payment,
        cancelUrl: "https://169.254.169.254/payment/cancel",
      }).success,
    ).toBe(false);
    expect(
      identityCommandSchema.safeParse({
        ...identity,
        issuer: "https://127.0.0.1",
      }).success,
    ).toBe(false);
    expect(
      identityCommandSchema.safeParse({
        ...identity,
        redirectUri: "https://169.254.169.254/oidc/callback",
      }).success,
    ).toBe(false);
  });
});
