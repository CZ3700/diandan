import { randomUUID } from "node:crypto";
import {
  type AdminFinanceClaim,
  type ProviderEvent,
  providerEventSchema,
} from "@fan-support/contracts";
import { resolveCanonicalPaymentTransaction } from "./payment-transaction-canonical.js";
import { associateOrderPaymentEvidence } from "./order-payment-data.js";
import {
  draftRows,
  financeAudit,
  financeIntegrity,
  insertPaymentRow,
  type TransactionClient,
  type DraftRow,
} from "./admin-finance-data.js";
export async function persistFinanceEvidence(
  client: TransactionClient,
  claim: AdminFinanceClaim,
  event: ProviderEvent,
) {
  if (
    event.evidence.kind !== "AUTHENTICATED_RECONCILE" ||
    event.evidence.auditLogId !== claim.auditLogId ||
    event.association.status !== "MATCHED"
  )
    return financeIntegrity();
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `finance-evidence:${event.providerAccountId}:${event.environment}:${event.providerEventId}`,
  ]);
  const [prior] = await draftRows(
    client,
    `SELECT *,event_type=$4 AND normalized_status=$5 AND external_payment_reference=$6 AND provider_refund_reference IS NOT DISTINCT FROM $7::text AND provider_dispute_reference IS NOT DISTINCT FROM $8::text AND amount_minor=$9 AND currency=$10 AND occurred_at=$11::timestamptz AND provider_transaction_type IS NOT DISTINCT FROM $12::text AND provider_transaction_reference IS NOT DISTINCT FROM $13::text matches FROM provider_events WHERE provider_account_id=$1 AND environment=$2 AND provider_event_id=$3`,
    [
      event.providerAccountId,
      event.environment,
      event.providerEventId,
      event.eventType,
      event.status,
      event.association.externalReference,
      event.eventType === "REFUND_STATUS" ? event.refundReference : null,
      event.eventType === "DISPUTE_STATUS" ? event.disputeReference : null,
      event.amountMinor,
      event.currency,
      event.occurredAt,
      event.transaction?.type ?? null,
      event.transaction?.providerReference ?? null,
    ],
  );
  if (prior) {
    if (prior["matches"] !== true) return financeIntegrity();
    await financeAudit(client, {
      id: claim.auditLogId!,
      action: "PAYMENT_PROVIDER_RECONCILE",
      subjectType: "PAYMENT_PROVIDER_ACCOUNT",
      subjectId: event.providerAccountId,
      requestId: claim.requestId,
      correlationId: claim.correlationId,
    });
    return String(prior["id"]);
  }
  const canonical = await resolveCanonicalPaymentTransaction(client, {
    providerAccountId: event.providerAccountId,
    environment: event.environment,
    eventType: event.eventType,
    status: event.status,
    externalReference: event.association.externalReference,
    knownAttemptId: event.association.paymentAttemptId,
    amountMinor: event.amountMinor,
    currency: event.currency,
    ...(event.eventType === "REFUND_STATUS"
      ? { refundReference: event.refundReference }
      : {}),
    ...(event.eventType === "DISPUTE_STATUS"
      ? { disputeReference: event.disputeReference }
      : {}),
    ...(event.transaction ? { transaction: event.transaction } : {}),
  });
  await financeAudit(client, {
    id: claim.auditLogId!,
    action: "PAYMENT_PROVIDER_RECONCILE",
    subjectType: "PAYMENT_PROVIDER_ACCOUNT",
    subjectId: event.providerAccountId,
    requestId: claim.requestId,
    correlationId: claim.correlationId,
  });
  const id = randomUUID();
  await insertPaymentRow(client, "provider_events", {
    id,
    provider_account_id: event.providerAccountId,
    environment: event.environment,
    provider_event_id: event.providerEventId,
    evidence_kind: "AUTHENTICATED_RECONCILE",
    reconcile_audit_log_id: claim.auditLogId,
    event_type: event.eventType,
    normalized_status: event.status,
    external_payment_reference: event.association.externalReference,
    provider_refund_reference:
      event.eventType === "REFUND_STATUS" ? event.refundReference : null,
    provider_dispute_reference:
      event.eventType === "DISPUTE_STATUS" ? event.disputeReference : null,
    provider_transaction_type: event.transaction?.type ?? null,
    provider_transaction_reference:
      event.transaction?.providerReference ?? null,
    amount_minor: event.amountMinor,
    currency: event.currency,
    occurred_at: event.occurredAt,
    canonical_transaction_event_id: canonical.canonicalId,
  });
  const [row] = await draftRows(
    client,
    `SELECT * FROM provider_events WHERE id=$1`,
    [id],
  );
  if (!row) return financeIntegrity();
  await associateOrderPaymentEvidence(
    client,
    row,
    event.association.paymentAttemptId,
  );
  return id;
}
export function financeProviderEvent(
  row: DraftRow,
  attemptId: unknown,
): ProviderEvent {
  return providerEventSchema.parse({
    schemaVersion: 1,
    providerAccountId: row["provider_account_id"],
    environment: row["environment"],
    providerEventId: row["provider_event_id"],
    eventType: row["event_type"],
    status: row["normalized_status"],
    evidence:
      row["evidence_kind"] === "VERIFIED_WEBHOOK"
        ? { kind: "VERIFIED_WEBHOOK", webhookInboxId: row["webhook_inbox_id"] }
        : {
            kind: "AUTHENTICATED_RECONCILE",
            auditLogId: row["reconcile_audit_log_id"],
          },
    association: {
      status: "MATCHED",
      paymentAttemptId: attemptId,
      externalReference: row["external_payment_reference"],
    },
    amountMinor: Number(row["amount_minor"]),
    currency: row["currency"],
    occurredAt: row["occurred_at"],
    ...(row["event_type"] === "REFUND_STATUS"
      ? { refundReference: row["provider_refund_reference"] }
      : { disputeReference: row["provider_dispute_reference"] }),
    ...(row["provider_transaction_type"]
      ? {
          transaction: {
            type: row["provider_transaction_type"],
            providerReference: row["provider_transaction_reference"],
          },
        }
      : {}),
  });
}
