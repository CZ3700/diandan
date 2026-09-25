import { randomBytes, randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  paymentRuntimeAttemptRecordSchema,
  paymentRuntimeBeginCreateResultSchema,
  paymentRuntimeClaimSchema,
  paymentRuntimeContextSchema,
  paymentRuntimeProviderBindingSchema,
  paymentRuntimeConfigurationSchema,
  type PaymentRuntimeAttemptRecord,
  type PaymentRuntimeClaim,
  type PaymentRuntimeCreateReceipt,
  type CreatePaymentCommand,
  type ReconcilePaymentCommand,
  type GetPaymentCommand,
} from "@fan-support/contracts";
import {
  PaymentRuntimeRepositoryError,
  PersistenceTransactionFailureError,
  type JsonValue,
  type PaymentRuntimeRepositories,
  type PaymentRuntimeRepository,
  type PaymentRuntimeTransactionManager,
} from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type { PaymentProvider } from "@fan-support/payment-port";
import { checkoutHarness } from "./checkout-preflight.harness.js";
import { id } from "./checkout-preflight.test-fixtures.js";

export async function paymentHarness() {
  const original = checkoutHarness();
  const checkoutCommand = await original.prepare();
  await original.app.create(checkoutCommand, {
    ...original.context,
    idempotencyKey: "create-checkout-before-payment",
  });
  const checkout = Object.values(original.state().sessions)[0]!;
  const now = original.state().current.evaluatedAt;
  let inTransaction = false,
    commitUnknown = false,
    afterDecrypt = () => {};
  let createOutcome: "SUCCESS" | "UNKNOWN" | "MALFORMED" = "SUCCESS";
  let reconcileStatus: "PROCESSING" | "REQUIRES_ACTION" = "PROCESSING";
  let state = {
    current: paymentRuntimeContextSchema.parse({
      schemaVersion: 1,
      evaluatedAt: now,
      cart: original.state().current.cart,
      checkout,
      orderVersion: 2,
      readiness: "READY",
      currentAttempt: null,
      routing: {
        schemaVersion: 1,
        publicationId: id(201),
        manifestHash: "a".repeat(64),
        configVersionId: id(202),
        configVersion: 1,
        ruleVersion: 1,
        routes: [
          {
            schemaVersion: 1,
            ruleVersion: 1,
            providerConfigId: id(204),
            environment: "TEST",
            adapterKey: "fake",
            providerEnabled: true,
            accountStatus: "ACTIVE",
            merchantStatus: "ACTIVE",
            healthStatus: "HEALTHY",
            rolloutBasisPoints: 10000,
            providerRolloutBasisPoints: 10000,
            displayOrder: 0,
            displayName: "TEST payment",
            customerHint: "Test funds only",
            displayLocale: "en",
            rule: {
              schemaVersion: 1,
              id: id(203),
              providerAccountId: id(205),
              paymentMethod: "fake_card",
              enabled: true,
              countries: ["US"],
              markets: [checkout.observation.consent.market],
              currencies: [checkout.observation.consent.currency],
              minimumAmountMinor: 0,
              maximumAmountMinor: 1000000,
              requiredDeviceCapabilities: ["REDIRECT"],
              priority: 1,
            },
          },
        ],
      },
    }),
    attempts: {} as Record<string, PaymentRuntimeAttemptRecord>,
    receipts: {} as Record<string, PaymentRuntimeCreateReceipt>,
    claims: {} as Record<string, PaymentRuntimeClaim>,
  };
  const context = {
    ...original.context,
    idempotencyKey: "payment-create-test-0001",
  };
  const configuration = paymentRuntimeConfigurationSchema.parse({
    schemaVersion: 1,
    publicStorefrontOrigin: "https://store.example.test",
    leaseMs: 30000,
    recoveryDelayMs: 10000,
    actionTtlMs: 300000,
    returnStateTtlMs: 3600000,
    recoveryBatchSize: 5,
  });
  const binding = paymentRuntimeProviderBindingSchema.parse({
    schemaVersion: 1,
    providerAccountId: id(205),
    providerCode: "fake",
    environment: "TEST",
    localeMapping: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        { providerLocale: locale, fallbackUsed: false },
      ]),
    ),
    allowedActionOrigins: ["https://payments.example.test"],
  });
  const authorized = (accesses: unknown) => {
    if (JSON.stringify(accesses) !== JSON.stringify(context.accesses))
      throw new PaymentRuntimeRepositoryError("INVALID_ACCESS");
  };
  const update = (record: PaymentRuntimeAttemptRecord) => {
    state.attempts[record.id] = record;
    state.current.currentAttempt = record;
    return structuredClone(record);
  };
  const repo: PaymentRuntimeRepository = {
    async loadContext(command) {
      authorized(command.accesses);
      return structuredClone(state.current);
    },
    async loadCurrentCheckout(command) {
      authorized(command.accesses);
      return {
        schemaVersion: 1,
        checkout: structuredClone(state.current.checkout),
        attempt: structuredClone(state.current.currentAttempt),
      };
    },
    async findCreateReceipt(command) {
      authorized(command.accesses);
      return structuredClone(state.receipts[command.idempotencyKey] ?? null);
    },
    async beginCreate(command) {
      authorized(command.accesses);
      if (state.current.readiness !== "READY")
        throw new PaymentRuntimeRepositoryError(state.current.readiness);
      if (
        state.current.currentAttempt &&
        !state.current.currentAttempt.canRetry
      )
        throw new PaymentRuntimeRepositoryError("PAYMENT_IN_PROGRESS");
      if (!state.current.routing?.routes[0]?.rule.enabled)
        throw new PaymentRuntimeRepositoryError("CAPABILITY_UNAVAILABLE");
      const frozen = command.createCommand;
      const attempt = paymentRuntimeAttemptRecordSchema.parse({
        schemaVersion: 1,
        id: command.attemptId,
        cartId: state.current.cart.id,
        checkoutSessionId: command.checkoutSessionId,
        orderId: frozen.orderId,
        providerAccountId: frozen.providerAccountId,
        adapterKey: "fake",
        environment: frozen.environment,
        paymentMethod: frozen.paymentMethod,
        amountMinor: frozen.amountMinor,
        market: state.current.cart.market,
        currency: frozen.currency,
        requestedLocale: frozen.requestedLocale,
        providerLocale: command.providerLocale,
        providerLocaleFallbackUsed: command.providerLocaleFallbackUsed,
        configVersionId: command.configVersionId,
        configVersion: command.configVersion,
        routeRuleId: command.routeRuleId,
        ruleVersion: command.ruleVersion,
        merchantReference: frozen.merchantReference,
        providerIdempotencyKey: frozen.providerIdempotencyKey,
        externalReference: null,
        status: "CREATED",
        version: 1,
        providerCallStarted: false,
        action: null,
        recovery: "CREATE_PENDING",
        canRetry: false,
        actionExpired: false,
        createdAt: now,
        updatedAt: now,
      });
      const receipt = {
        schemaVersion: 1 as const,
        receiptId: command.receiptId,
        operationId: command.operationId,
        cartId: attempt.cartId,
        checkoutSessionId: attempt.checkoutSessionId,
        attemptId: attempt.id,
        idempotencyKey: command.idempotencyKey,
        canonicalRequestHash: command.canonicalRequestHash,
        occurredAt: now,
      };
      const claim = paymentRuntimeClaimSchema.parse({
        schemaVersion: 1,
        operationId: command.operationId,
        generation: 1,
        leaseTokenDigest: command.leaseTokenDigest,
        leaseExpiresAt: new Date(
          Date.parse(now) + command.leaseDurationMs,
        ).toISOString(),
        mode: "CREATE",
        attempt,
        createCommand: frozen,
        supportedActionTypes: command.supportedActionTypes,
        auditLogId: null,
        requestId: command.requestId,
        correlationId: command.correlationId,
        taskName: command.taskName,
      });
      state.receipts[command.idempotencyKey] = receipt;
      state.claims[attempt.id] = claim;
      update(attempt);
      return paymentRuntimeBeginCreateResultSchema.parse({
        schemaVersion: 1,
        receipt,
        claim,
      });
    },
    async settleCreate(command) {
      const current = state.attempts[command.claim.attempt.id]!;
      if (
        current.status !== "CREATED" ||
        current.version !== command.claim.attempt.version
      )
        throw new PaymentRuntimeRepositoryError("STALE_CLAIM");
      const result = command.result;
      return update(
        paymentRuntimeAttemptRecordSchema.parse({
          ...current,
          status:
            result.kind === "NETWORK_UNCERTAINTY" ? "UNKNOWN" : result.status,
          recovery:
            result.kind === "NETWORK_UNCERTAINTY"
              ? "RECONCILE_REQUIRED"
              : "NONE",
          providerCallStarted: true,
          externalReference:
            result.kind === "NETWORK_UNCERTAINTY"
              ? null
              : result.externalReference,
          action: result.kind === "NETWORK_UNCERTAINTY" ? null : result.action,
          version: current.version + 1,
        }),
      );
    },
    async claimRecovery(command) {
      if (command.target.kind === "CHECKOUT")
        authorized(command.target.accesses);
      const current =
        command.target.kind === "CHECKOUT"
          ? state.attempts[command.target.attemptId]
          : state.current.currentAttempt;
      if (
        !current ||
        current.recovery === "EVIDENCE_PENDING" ||
        ["FAILED", "CANCELED", "EXPIRED", "SUCCEEDED"].includes(current.status)
      )
        return null;
      const old = state.claims[current.id]!;
      const claim = paymentRuntimeClaimSchema.parse({
        ...old,
        generation: old.generation + 1,
        leaseTokenDigest: command.leaseTokenDigest,
        requestId: command.requestId,
        correlationId: command.correlationId,
        taskName: command.taskName,
        mode: current.status === "CREATED" ? "CREATE" : "RECONCILE",
        auditLogId: current.status === "CREATED" ? null : command.auditLogId,
        attempt: current,
      });
      state.claims[current.id] = claim;
      return claim;
    },
    async recordReconcile(command) {
      const current = state.attempts[command.claim.attempt.id]!;
      if (command.event.eventType !== "PAYMENT_STATUS")
        throw new Error("Invalid fixture event");
      if (command.event.status === "SUCCEEDED")
        return update({ ...current, recovery: "EVIDENCE_PENDING" });
      if (command.event.status === current.status)
        return structuredClone(current);
      return update(
        paymentRuntimeAttemptRecordSchema.parse({
          ...current,
          status: command.event.status,
          action: "action" in command ? command.action : null,
          externalReference: command.event.association.externalReference,
          recovery:
            command.event.status === "UNKNOWN" ? "RECONCILE_REQUIRED" : "NONE",
          version: current.version + 1,
          canRetry: ["FAILED", "CANCELED", "EXPIRED"].includes(
            command.event.status,
          ),
        }),
      );
    },
    async deferRecovery(command) {
      return structuredClone(state.attempts[command.claim.attempt.id]!);
    },
    async readAttempt(command) {
      authorized(command.accesses);
      const current = state.attempts[command.attemptId];
      if (!current || current.checkoutSessionId !== command.checkoutSessionId)
        return null;
      if (
        command.expectedVersion !== undefined &&
        command.expectedVersion !== current.version
      )
        throw new PaymentRuntimeRepositoryError("VERSION_CONFLICT");
      return structuredClone(current);
    },
  };
  const repositories = {
    ...original.repos,
    paymentRuntime: repo,
  } as unknown as PaymentRuntimeRepositories;
  const transactions: PaymentRuntimeTransactionManager = {
    async runInPaymentRuntimeTransaction<Result extends JsonValue>(
      work: (repos: PaymentRuntimeRepositories) => Promise<Result>,
    ): Promise<Result> {
      const before = structuredClone(state);
      inTransaction = true;
      let result: Result;
      try {
        result = await work(repositories);
      } catch (error) {
        state = before;
        throw error;
      } finally {
        inTransaction = false;
      }
      if (
        commitUnknown &&
        Object.keys(state.attempts).length > Object.keys(before.attempts).length
      ) {
        commitUnknown = false;
        throw new PersistenceTransactionFailureError({
          schemaVersion: 1,
          operation: "RUN_TRANSACTION",
          outcome: "FAILURE",
          error: {
            schemaVersion: 1,
            code: "TRANSACTION_OUTCOME_UNKNOWN",
            recovery: "RECONCILE_REQUIRED",
          },
        });
      }
      return result;
    },
  };
  const envelopes = new Map<string, string>();
  const success = (operation: string, value: unknown) => ({
    schemaVersion: 1,
    operation,
    outcome: "SUCCESS",
    value,
  });
  const keys = {
    encryptEnvelope: vi.fn(
      async ({ plaintextBase64 }: { plaintextBase64: string }) => {
        expect(inTransaction).toBe(false);
        const ciphertext = `enc:v1:${randomBytes(32).toString("base64url")}`;
        envelopes.set(ciphertext, plaintextBase64);
        return success("ENCRYPT_ENVELOPE", {
          ciphertext,
          encryptedDataKey: `enc:v1:${randomBytes(32).toString("base64url")}`,
          keyVersion: "test-key-v1",
          algorithm: "AES_256_GCM",
        });
      },
    ),
    decryptEnvelope: vi.fn(async ({ ciphertext }: { ciphertext: string }) => {
      expect(inTransaction).toBe(false);
      afterDecrypt();
      return success("DECRYPT_ENVELOPE", {
        plaintextBase64: envelopes.get(ciphertext)!,
      });
    }),
    computeBlindIndex: vi.fn(async () =>
      success("COMPUTE_BLIND_INDEX", {
        digestBase64: randomBytes(32).toString("base64url"),
        keyVersion: "test-key-v1",
        algorithm: "HMAC_SHA_256",
      }),
    ),
    encryptEnvelopeFields: vi.fn(async () => {
      throw new Error("Unused fixture operation");
    }),
  };
  const accepted = new Map<string, CreatePaymentCommand>();
  const provider = {
    getCapabilities: vi.fn(
      async (command: Parameters<PaymentProvider["getCapabilities"]>[0]) => {
        expect(inTransaction).toBe(false);
        return success("GET_CAPABILITIES", {
          capabilities: [
            {
              schemaVersion: 1,
              id: id(206),
              paymentMethod: "fake_card",
              displayName: "Ignored provider label",
              market: command.market,
              country: command.country,
              currency: command.currency,
              minimumAmountMinor: 0,
              maximumAmountMinor: 1000000,
              actionTypes: ["REDIRECT"],
              available: true,
            },
          ],
        });
      },
    ),
    createPayment: vi.fn(async (command: CreatePaymentCommand) => {
      expect(inTransaction).toBe(false);
      accepted.set(command.attemptId, structuredClone(command));
      if (createOutcome === "UNKNOWN")
        throw new Error("Injected response loss after provider accept");
      if (createOutcome === "MALFORMED") return { success: true };
      return success("CREATE_PAYMENT", {
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        attemptId: command.attemptId,
        orderId: command.orderId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        status: "REQUIRES_ACTION",
        externalReference: `fake/payment/${command.attemptId}`,
        providerLocale: command.requestedLocale,
        fallbackUsed: false,
        action: {
          schemaVersion: 1,
          type: "REDIRECT",
          url: `https://payments.example.test/continue/${command.attemptId}`,
        },
        observedAt: now,
      });
    }),
    reconcilePayment: vi.fn(async (command: ReconcilePaymentCommand) => {
      expect(inTransaction).toBe(false);
      expect(accepted.has(command.attemptId)).toBe(true);
      return success("RECONCILE_PAYMENT", {
        event: {
          schemaVersion: 1,
          providerAccountId: command.providerAccountId,
          environment: command.environment,
          providerEventId: `fake/reconcile/${command.auditLogId}`,
          evidence: {
            kind: "AUTHENTICATED_RECONCILE",
            auditLogId: command.auditLogId,
          },
          occurredAt: now,
          association: {
            status: "MATCHED",
            paymentAttemptId: command.attemptId,
            externalReference: `fake/payment/${command.attemptId}`,
          },
          eventType: "PAYMENT_STATUS",
          status: reconcileStatus,
          amountMinor: command.amountMinor,
          currency: command.currency,
        },
      });
    }),
    getPayment: vi.fn(async (command: GetPaymentCommand) => {
      expect(inTransaction).toBe(false);
      const original = accepted.get(command.attemptId)!;
      return success("GET_PAYMENT", {
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        attemptId: command.attemptId,
        externalReference: command.externalReference,
        status: "REQUIRES_ACTION",
        providerLocale: original.requestedLocale,
        fallbackUsed: false,
        action: {
          schemaVersion: 1,
          type: "REDIRECT",
          url: `https://payments.example.test/continue/${command.attemptId}`,
        },
        observedAt: now,
      });
    }),
    cancelPayment: vi.fn(async () => {
      throw new Error("Unused fixture operation");
    }),
    refundPayment: vi.fn(async () => {
      throw new Error("Unused fixture operation");
    }),
    reconcileRefund: vi.fn(async () => {
      throw new Error("Unused fixture operation");
    }),
  };
  const dependencies = {
    transactions,
    keyManagement: keys as KeyManagementPort,
    providers: [
      { configuration: binding, provider: provider as PaymentProvider },
    ],
    configuration,
  };
  const create = {
    schemaVersion: 1,
    operation: "CREATE_PAYMENT_ATTEMPT",
    checkoutSessionId: checkout.receipt.checkoutSessionId,
    capabilityId: id(203),
    configVersion: 1,
    ruleVersion: 1,
    country: "US",
    supportedActionTypes: ["REDIRECT"],
  };
  return {
    dependencies,
    create,
    context,
    keys,
    provider,
    repo,
    state: () => state,
    setOutcome: (value: typeof createOutcome) => {
      createOutcome = value;
    },
    setReconcileStatus: (value: typeof reconcileStatus) => {
      reconcileStatus = value;
    },
    loseFirstCommit: () => {
      commitUnknown = true;
    },
    afterDecrypt: (work: () => void) => {
      afterDecrypt = work;
    },
    recover: (attemptId: string) => ({
      schemaVersion: 1,
      operation: "RECOVER_PAYMENT_ATTEMPT",
      checkoutSessionId: create.checkoutSessionId,
      attemptId,
    }),
    read: (attemptId: string) => ({
      schemaVersion: 1,
      operation: "READ_PAYMENT_ATTEMPT",
      checkoutSessionId: create.checkoutSessionId,
      attemptId,
    }),
    freshContext: () => ({ ...context, idempotencyKey: randomUUID() }),
  };
}
