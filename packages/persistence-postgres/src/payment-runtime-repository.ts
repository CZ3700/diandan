import {
  paymentRuntimeLoadContextCommandSchema,
  paymentRuntimeLoadCurrentCheckoutCommandSchema,
  paymentRuntimeFindCreateReceiptCommandSchema,
  paymentRuntimeBeginCreateCommandSchema,
  paymentRuntimeSettleCreateCommandSchema,
  paymentRuntimeClaimRecoveryCommandSchema,
  paymentRuntimeRecordReconcileCommandSchema,
  paymentRuntimeDeferRecoveryCommandSchema,
  paymentRuntimeReadAttemptCommandSchema,
  paymentRuntimeCurrentCheckoutSchema,
} from "@fan-support/contracts";
import {
  PaymentRuntimeRepositoryError,
  CartRuntimeRepositoryError,
  CheckoutPreflightRepositoryError,
  parsePersistenceTransactionFailure,
  PersistenceTransactionFailureError,
  type PaymentRuntimeRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  authorizePaymentCart,
  loadPaymentAttempt,
  loadPaymentCheckout,
  loadPermanentPaymentReceipt,
  rejectPayment,
} from "./payment-runtime-data.js";
import { loadPaymentContext } from "./payment-runtime-context.js";
import {
  beginPaymentCreate,
  settlePaymentCreate,
} from "./payment-runtime-write.js";
import {
  claimPaymentRecovery,
  recordPaymentReconcile,
  deferPaymentRecovery,
} from "./payment-runtime-recovery.js";
import { createOutboxRepository } from "./outbox-repository.js";
import type { PostgresQueryLayer } from "./query-layer.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
export function createPaymentRuntimeRepository(
  client: TransactionClient,
  database: PostgresQueryLayer,
  scope: TransactionScopeControl,
): PaymentRuntimeRepository {
  const outbox = createOutboxRepository(database, scope);
  const run = <Result>(work: () => Promise<Result>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof PaymentRuntimeRepositoryError) throw error;
        if (
          error instanceof CartRuntimeRepositoryError ||
          error instanceof CheckoutPreflightRepositoryError
        )
          throw new PaymentRuntimeRepositoryError(error.code);
        const failure = parsePersistenceTransactionFailure(error);
        if (failure) throw new PersistenceTransactionFailureError(failure);
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    loadContext(input) {
      return run(async () => {
        const parsed = paymentRuntimeLoadContextCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        return loadPaymentContext(client, parsed.data);
      });
    },
    loadCurrentCheckout(input) {
      return run(async () => {
        const parsed =
          paymentRuntimeLoadCurrentCheckoutCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        const cart = await authorizePaymentCart(client, parsed.data.accesses);
        const rows = await draftRows(
          client,
          `SELECT s.id,o.current_payment_attempt_id FROM public.checkout_sessions s JOIN public.orders o ON o.checkout_session_id=s.id AND o.cart_id=s.cart_id JOIN public.carts c ON c.id=s.cart_id AND c.locked_order_id=o.id WHERE s.cart_id=$1::uuid ORDER BY s.created_at DESC LIMIT 2`,
          [cart.id],
        );
        if (rows.length === 0) return null;
        if (rows.length !== 1) return rejectPayment("CONTENT_UNAVAILABLE");
        const row = rows[0]!;
        const checkout = await loadPaymentCheckout(
          client,
          cart.id,
          String(row["id"]),
        );
        if (!checkout) return rejectPayment("CONTENT_UNAVAILABLE");
        const attempt =
          typeof row["current_payment_attempt_id"] === "string"
            ? await loadPaymentAttempt(
                client,
                row["current_payment_attempt_id"],
                cart.id,
                String(row["id"]),
              )
            : null;
        return paymentRuntimeCurrentCheckoutSchema.parse({
          schemaVersion: 1,
          checkout,
          attempt,
        });
      });
    },
    findCreateReceipt(input) {
      return run(async () => {
        const parsed =
          paymentRuntimeFindCreateReceiptCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        const cart = await authorizePaymentCart(client, parsed.data.accesses);
        return loadPermanentPaymentReceipt(
          client,
          cart.id,
          parsed.data.checkoutSessionId,
          parsed.data.idempotencyKey,
        );
      });
    },
    beginCreate(input) {
      return run(async () => {
        const parsed = paymentRuntimeBeginCreateCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        return beginPaymentCreate(client, outbox, parsed.data);
      });
    },
    settleCreate(input) {
      return run(async () => {
        const parsed = paymentRuntimeSettleCreateCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        return settlePaymentCreate(client, outbox, parsed.data);
      });
    },
    claimRecovery(input) {
      return run(async () => {
        const parsed =
          paymentRuntimeClaimRecoveryCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        return claimPaymentRecovery(client, outbox, parsed.data);
      });
    },
    recordReconcile(input) {
      return run(async () => {
        const parsed =
          paymentRuntimeRecordReconcileCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        return recordPaymentReconcile(client, outbox, parsed.data);
      });
    },
    deferRecovery(input) {
      return run(async () => {
        const parsed =
          paymentRuntimeDeferRecoveryCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        return deferPaymentRecovery(client, parsed.data);
      });
    },
    readAttempt(input) {
      return run(async () => {
        const parsed = paymentRuntimeReadAttemptCommandSchema.safeParse(input);
        if (!parsed.success) return rejectPayment("INVALID_COMMAND");
        const command = parsed.data;
        const cart = await authorizePaymentCart(client, command.accesses);
        const attempt = await loadPaymentAttempt(
          client,
          command.attemptId,
          cart.id,
          command.checkoutSessionId,
        );
        if (
          attempt &&
          command.expectedVersion !== undefined &&
          attempt.version !== command.expectedVersion
        )
          return rejectPayment("VERSION_CONFLICT");
        return attempt;
      });
    },
  };
}
