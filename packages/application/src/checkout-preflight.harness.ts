import { expect, vi } from "vitest";
import {
  cartRuntimeRequestContextSchema,
  checkoutPreflightCreateCommandSchema,
  checkoutPreflightReceiptSchema,
  checkoutPreflightSessionRecordSchema,
  type CheckoutPreflightCommitCommand,
  type CheckoutPreflightObservation,
  type AppendOutboxEventCommand,
} from "@fan-support/contracts";
import {
  PersistenceTransactionFailureError,
  type CheckoutPreflightRepositories,
  type CheckoutPreflightTransactionManager,
  type JsonValue,
} from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import { checkoutFixture, id } from "./checkout-preflight.test-fixtures.js";
import { createCheckoutPreflightUseCases } from "./checkout-preflight.js";

export function checkoutHarness() {
  let state = {
    current: checkoutFixture(),
    observations: {} as Record<string, CheckoutPreflightObservation>,
    sessions: {} as Record<
      string,
      ReturnType<typeof checkoutPreflightSessionRecordSchema.parse>
    >,
    receipts: {} as Record<string, { hash: string; ref?: string }>,
    commits: [] as CheckoutPreflightCommitCommand[],
    events: [] as AppendOutboxEventCommand[],
  };
  let inTransaction = false;
  let nextCommitUnknown = false;
  let afterEncryption = () => {};
  const context = cartRuntimeRequestContextSchema.parse({
    schemaVersion: 1,
    accesses: [
      {
        schemaVersion: 1,
        tokenDigest: "a".repeat(64),
        pepperVersion: "test-v1",
      },
    ],
    requestId: id(40),
    correlationId: id(41),
    idempotencyKey: "checkout-test-0001",
  });
  const success = (operation: string, value: unknown) => ({
    schemaVersion: 1,
    operation,
    outcome: "SUCCESS",
    value,
  });
  const repos = {
    cartRuntime: {
      findByCredentialForUpdate: vi.fn(async () =>
        structuredClone(state.current.cart),
      ),
    },
    checkoutPreflight: {
      loadCurrent: vi.fn(async () => structuredClone(state.current)),
      savePreflight: vi.fn(
        async ({
          observation,
        }: {
          observation: CheckoutPreflightObservation;
        }) => {
          state.observations[observation.id] = structuredClone(observation);
          return observation;
        },
      ),
      readPreflight: vi.fn(
        async ({ preflightId }: { preflightId: string }) =>
          state.observations[preflightId] ?? null,
      ),
      commit: vi.fn(async (command: CheckoutPreflightCommitCommand) => {
        state.commits.push(command);
        state.current.cart.version++;
        state.current.cart.status = "LOCKED";
        const receipt = checkoutPreflightReceiptSchema.parse({
          schemaVersion: 1,
          preflightId: command.preflightId,
          cartId: command.cartId,
          cartVersion: state.current.cart.version,
          checkoutSessionId: command.checkoutSessionId,
          orderId: command.orderId,
          publicOrderId: command.publicOrderId,
          occurredAt: state.current.evaluatedAt,
        });
        state.sessions[command.checkoutSessionId] =
          checkoutPreflightSessionRecordSchema.parse({
            schemaVersion: 1,
            receipt,
            observation: state.observations[command.preflightId],
            evaluatedAt: state.current.evaluatedAt,
            expired: false,
            status: "READY",
            orderStatus: "PENDING_PAYMENT",
            paymentStatus: "UNPAID",
          });
        return receipt;
      }),
      readSession: vi.fn(
        async ({ checkoutSessionId }: { checkoutSessionId: string }) =>
          state.sessions[checkoutSessionId] ?? null,
      ),
    },
    idempotency: {
      begin: vi.fn(
        async (command: {
          idempotencyOperation: string;
          idempotencyKey: string;
          canonicalRequestHash: string;
        }) => {
          const key = `${command.idempotencyOperation}/${command.idempotencyKey}`;
          const previous = state.receipts[key];
          if (previous)
            return success(
              "BEGIN_IDEMPOTENCY",
              previous.hash !== command.canonicalRequestHash
                ? { decision: "CONFLICT" }
                : previous.ref
                  ? { decision: "REPLAY", safeResultReference: previous.ref }
                  : { decision: "IN_PROGRESS" },
            );
          state.receipts[key] = { hash: command.canonicalRequestHash };
          return success("BEGIN_IDEMPOTENCY", { decision: "STARTED" });
        },
      ),
      complete: vi.fn(
        async (command: {
          idempotencyOperation: string;
          idempotencyKey: string;
          safeResultReference: string;
        }) => {
          state.receipts[
            `${command.idempotencyOperation}/${command.idempotencyKey}`
          ]!.ref = command.safeResultReference;
          return success("COMPLETE_IDEMPOTENCY", { completed: true });
        },
      ),
    },
    inventory: {
      loadManyForUpdate: vi.fn(),
      applyReservationCreation: vi.fn(),
    },
    outbox: {
      append: vi.fn(async (command: AppendOutboxEventCommand) => {
        expect(inTransaction).toBe(true);
        state.events.push(structuredClone(command));
        return success("APPEND_OUTBOX_EVENT", {
          eventId: command.event.eventId,
          appended: true,
        });
      }),
    },
  };
  const transactions: CheckoutPreflightTransactionManager = {
    async runInCheckoutPreflightTransaction<Result extends JsonValue>(
      work: (value: CheckoutPreflightRepositories) => Promise<Result>,
    ): Promise<Result> {
      const before = structuredClone(state);
      inTransaction = true;
      let result: Result;
      try {
        result = await work(repos as unknown as CheckoutPreflightRepositories);
      } catch (error) {
        state = before;
        throw error;
      } finally {
        inTransaction = false;
      }
      if (nextCommitUnknown && state.commits.length > before.commits.length) {
        nextCommitUnknown = false;
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
  const keys = {
    encryptEnvelope: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      expect(
        Object.values(state.receipts).every(
          (receipt) => receipt.ref !== undefined,
        ),
      ).toBe(true);
      afterEncryption();
      return success("ENCRYPT_ENVELOPE", {
        ciphertext: `enc:v1:${"a".repeat(43)}`,
        encryptedDataKey: `enc:v1:${"b".repeat(43)}`,
        keyVersion: "test-envelope-v1",
        algorithm: "AES_256_GCM",
      });
    }),
    computeBlindIndex: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      return success("COMPUTE_BLIND_INDEX", {
        digestBase64: "c".repeat(43),
        keyVersion: "test-lookup-v1",
        algorithm: "HMAC_SHA_256",
      });
    }),
    decryptEnvelope: vi.fn(),
    encryptEnvelopeFields: vi.fn(),
  };
  const app = createCheckoutPreflightUseCases({
    transactions,
    keyManagement: keys as unknown as KeyManagementPort,
  });
  const validate = {
    schemaVersion: 1,
    operation: "VALIDATE_CHECKOUT",
    expectedCartVersion: state.current.cart.version,
    presentationLocale: "en",
  };
  return {
    app,
    repos,
    keys,
    context,
    validate,
    state: () => state,
    afterEncryption: (action: () => void) => {
      afterEncryption = action;
    },
    makeCommitUnknown: () => {
      nextCommitUnknown = true;
    },
    async prepare() {
      const result = await app.validate(validate, context);
      expect(result).toMatchObject({
        outcome: "SUCCESS",
        action: "VALIDATED",
        replayed: false,
      });
      if (result.outcome !== "SUCCESS" || result.action !== "VALIDATED")
        throw new Error("Fixture preflight failed");
      return checkoutPreflightCreateCommandSchema.parse({
        schemaVersion: 1,
        operation: "CREATE_CHECKOUT",
        preflightId: result.preflight.id,
        expectedCartVersion: result.preflight.cartVersion,
        email: "private-checkout@example.test",
        policyAcceptances: result.preflight.policies.map((policy) => ({
          policyKey: policy.policyKey,
          policyRevisionId: policy.policyRevisionId,
          policyTranslationRevisionId: policy.policyTranslationRevisionId,
          accepted: true,
        })),
      });
    },
  };
}
