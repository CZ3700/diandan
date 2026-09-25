import {
  paymentRuntimeClaimSchema,
  type PaymentRuntimeClaim,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { loadPaymentAttempt, rejectPayment } from "./payment-runtime-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export const runtimeOperationColumns = `operation.*,receipt.create_command,receipt.supported_action_types,
  encode(operation.lease_token_digest,'hex') lease_digest,${cartTimestamp("operation.lease_expires_at")} lease_until`;
export async function paymentClaimFromRow(
  client: TransactionClient,
  row: DraftRow,
) {
  const attempt = await loadPaymentAttempt(client, String(row["attempt_id"]));
  if (!attempt) return rejectPayment("STALE_CLAIM");
  return paymentRuntimeClaimSchema.parse({
    schemaVersion: 1,
    requestId: row["request_id"],
    correlationId: row["correlation_id"],
    taskName: row["task_name"],
    operationId: row["id"],
    generation: Number(row["generation"]),
    leaseTokenDigest: row["lease_digest"],
    leaseExpiresAt: row["lease_until"],
    mode: row["phase"],
    attempt,
    createCommand: row["create_command"],
    auditLogId: row["audit_log_id"],
    supportedActionTypes: row["supported_action_types"],
  });
}
/** Claims are reconstructed from locked durable rows; callers cannot replace a frozen PSP command. */
export async function requirePaymentClaim(
  client: TransactionClient,
  input: PaymentRuntimeClaim,
) {
  const [row] = await draftRows(
    client,
    `SELECT ${runtimeOperationColumns} FROM public.payment_runtime_operations operation JOIN public.payment_create_receipts receipt ON receipt.operation_id=operation.id AND receipt.attempt_id=operation.attempt_id WHERE operation.id=$1::uuid AND operation.attempt_id=$2::uuid AND operation.generation=$3::bigint AND operation.lease_token_digest=decode($4,'hex') AND operation.lease_expires_at>clock_timestamp() AND operation.phase=$5 FOR UPDATE OF operation`,
    [
      input.operationId,
      input.attempt.id,
      input.generation,
      input.leaseTokenDigest,
      input.mode,
    ],
  );
  if (!row) return rejectPayment("STALE_CLAIM");
  const actual = await paymentClaimFromRow(client, row);
  // Includes attempt version, pinned locales, account/adapter and original supported action types.
  if (canonicalPublicationValue(actual) !== canonicalPublicationValue(input))
    return rejectPayment("STALE_CLAIM");
  return actual;
}
