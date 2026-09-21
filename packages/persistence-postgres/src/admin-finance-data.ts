import { randomUUID } from "node:crypto";
import {
  adminFinanceResponseSchema,
  persistencePortCommandSchema,
  type AdminFinanceFailure,
  type AdminFinanceClaim,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { insertPaymentRow } from "./payment-runtime-history.js";
import { adminOrdersTimestamp } from "./admin-orders-data.js";
import {
  createPersistenceTransactionFailureError,
  type TransactionClient,
} from "./transaction-runner.js";
export { draftRows, insertPaymentRow, adminOrdersTimestamp };
export type { DraftRow, TransactionClient };
export const financeFailure = (
  code: AdminFinanceFailure["code"],
): AdminFinanceFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export function financeIntegrity(): never {
  throw createPersistenceTransactionFailureError({
    code: "INTEGRITY_VIOLATION",
    recovery: "NONE",
  });
}
export async function financeTime(client: TransactionClient, orderId: string) {
  const [row] = await draftRows(
    client,
    `SELECT ${adminOrdersTimestamp("GREATEST(clock_timestamp(),o.updated_at,coalesce((SELECT max(updated_at)+interval '1 microsecond' FROM refunds WHERE order_id=o.id),o.updated_at),coalesce((SELECT max(updated_at)+interval '1 microsecond' FROM disputes WHERE order_id=o.id),o.updated_at))")} at FROM orders o WHERE id=$1`,
    [orderId],
  );
  return typeof row?.["at"] === "string" ? row["at"] : financeIntegrity();
}
export async function financeAttempt(
  client: TransactionClient,
  order: DraftRow,
  attemptId: unknown = order["current_payment_attempt_id"],
) {
  const [row] = await draftRows(
    client,
    `SELECT a.*,p.adapter_key FROM payment_attempts a JOIN payment_provider_accounts p ON p.id=a.provider_account_id AND p.environment=a.environment WHERE a.id=$1 AND a.order_id=$2 FOR UPDATE OF a`,
    [attemptId, order["id"]],
  );
  return row;
}
export async function financeHistory(
  client: TransactionClient,
  outbox: OutboxRepository,
  kind: "REFUND" | "DISPUTE",
  row: DraftRow,
  order: DraftRow,
  from: string | null,
  trace: { requestId: string; correlationId: string },
  at: string,
) {
  const field = kind === "REFUND" ? "refund" : "dispute";
  await insertPaymentRow(client, `${field}_events`, {
    id: randomUUID(),
    [`${field}_id`]: row["id"],
    sequence: row["version"],
    from_status: from,
    to_status: row["status"],
    reason_code:
      kind === "REFUND" ? "REFUND_STATUS_RECORDED" : "DISPUTE_STATUS_RECORDED",
    evidence_kind: row["status_evidence_kind"],
    provider_event_id: row["provider_event_id"] ?? null,
    audit_log_id: row["evidence_audit_log_id"] ?? null,
    request_id: trace.requestId,
    correlation_id: trace.correlationId,
    occurred_at: at,
  });
  const command = persistencePortCommandSchema.parse({
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: `${kind}_STATUS_CHANGED`,
      aggregateId: row["id"],
      requestId: trace.requestId,
      correlationId: trace.correlationId,
      occurredAt: at,
      payload: {
        [`${field}Id`]: row["id"],
        orderId: order["id"],
        status: row["status"],
      },
    },
    aggregateVersion: Number(row["version"]),
    primarySubjectId: row["id"],
    secondarySubjectId: order["id"],
    market: order["market"],
    currency: order["currency"],
    idempotencyKey: `finance:${field}:${row["id"]}:${row["version"]}`,
    availableAt: at,
  });
  if (command.operation !== "APPEND_OUTBOX_EVENT") return financeIntegrity();
  const result = await outbox.append(command);
  if (result.outcome !== "SUCCESS") financeIntegrity();
}
export async function financeRefundTransition(
  client: TransactionClient,
  outbox: OutboxRepository,
  refund: DraftRow,
  order: DraftRow,
  status: string,
  trace: { requestId: string; correlationId: string },
  event?: DraftRow,
) {
  const at = await financeTime(client, String(order["id"]));
  const [row] = await draftRows(
    client,
    `UPDATE refunds SET status=$2,status_evidence_kind=$3,provider_event_id=$4,evidence_audit_log_id=$5,processed_amount_minor=CASE WHEN $2='SUCCEEDED' THEN requested_amount_minor ELSE 0 END,completed_at=CASE WHEN $2 IN('SUCCEEDED','FAILED') THEN $6::timestamptz ELSE NULL END,version=version+1,updated_at=$6 WHERE id=$1 RETURNING *`,
    [
      refund["id"],
      status,
      event?.["evidence_kind"] ??
        (status === "SUBMITTING" ? "SUBMIT_COMMAND" : "NETWORK_UNCERTAINTY"),
      event?.["id"] ?? null,
      event?.["reconcile_audit_log_id"] ?? null,
      at,
    ],
  );
  if (!row) return financeIntegrity();
  await financeHistory(
    client,
    outbox,
    "REFUND",
    row,
    order,
    String(refund["status"]),
    trace,
    at,
  );
  return row;
}
export async function financeAudit(
  client: TransactionClient,
  input: {
    id?: string;
    actorId?: unknown;
    action: string;
    subjectType: string;
    subjectId: unknown;
    reasonCode?: unknown;
    requestId: string;
    correlationId: string;
    outcome?: string;
  },
) {
  const id = input.id ?? randomUUID();
  await insertPaymentRow(client, "audit_logs", {
    id,
    actor_type: input.actorId ? "ADMIN" : "SYSTEM",
    ...(input.actorId
      ? { actor_id: input.actorId }
      : { task_name: "admin-finance" }),
    action: input.action,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    reason_code: input.reasonCode ?? null,
    request_id: input.requestId,
    correlation_id: input.correlationId,
    outcome: input.outcome ?? "SUCCEEDED",
  });
  return id;
}
export async function financeClaimRow(
  client: TransactionClient,
  claim: AdminFinanceClaim,
) {
  const [row] = await draftRows(
    client,
    `SELECT * FROM admin_finance_operations WHERE id=$1 AND generation=$2 AND lease_token_digest=decode($3,'hex') AND lease_expires_at>clock_timestamp() AND claim=$4::jsonb FOR UPDATE`,
    [
      claim.operationId,
      claim.generation,
      claim.leaseTokenDigest,
      JSON.stringify(claim),
    ],
  );
  return row && (await financeClaimLive(client, claim)) ? row : undefined;
}
export const parseFinanceResponse = adminFinanceResponseSchema.parse;

export async function financeClaimLive(
  client: TransactionClient,
  claim: AdminFinanceClaim,
) {
  const [row] = await draftRows(
    client,
    `SELECT id FROM admin_finance_operations WHERE id=$1 AND generation=$2 AND lease_token_digest=decode($3,'hex') AND lease_expires_at>clock_timestamp() AND claim=$4::jsonb`,
    [
      claim.operationId,
      claim.generation,
      claim.leaseTokenDigest,
      JSON.stringify(claim),
    ],
  );
  return Boolean(row);
}
