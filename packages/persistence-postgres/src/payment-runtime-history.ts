import {
  persistencePortCommandSchema,
  type PaymentRuntimeAttemptRecord,
  type PaymentRuntimeClaim,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { rejectPayment } from "./payment-runtime-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Identifiers come exclusively from fixed module row builders; all data remains parameterized. */
export async function insertPaymentRow(
  client: TransactionClient,
  table: string,
  row: Record<string, unknown>,
) {
  const columns = Object.keys(row);
  await client.query(
    `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row),
  );
}
export async function appendPaymentHistory(
  client: TransactionClient,
  outbox: OutboxRepository,
  input: {
    attempt: Pick<
      PaymentRuntimeAttemptRecord,
      "id" | "orderId" | "market" | "currency"
    >;
    eventId: string;
    outboxEventId: string;
    version: number;
    fromStatus: string | null;
    toStatus: string;
    evidenceKind: string;
    reasonCode: string;
    providerEventId?: string;
    auditLogId?: string;
    requestId: string;
    correlationId: string;
    occurredAt: string;
  },
) {
  await insertPaymentRow(client, "payment_attempt_events", {
    id: input.eventId,
    payment_attempt_id: input.attempt.id,
    sequence: input.version,
    from_status: input.fromStatus,
    to_status: input.toStatus,
    reason_code: input.reasonCode,
    evidence_kind: input.evidenceKind,
    provider_event_id: input.providerEventId ?? null,
    audit_log_id: input.auditLogId ?? null,
    request_id: input.requestId,
    correlation_id: input.correlationId,
    occurred_at: input.occurredAt,
  });
  const command = persistencePortCommandSchema.parse({
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: input.outboxEventId,
      eventType: "PAYMENT_STATUS_CHANGED",
      aggregateId: input.attempt.id,
      requestId: input.requestId,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
      payload: {
        paymentAttemptId: input.attempt.id,
        orderId: input.attempt.orderId,
        status: input.toStatus,
      },
    },
    aggregateVersion: input.version,
    primarySubjectId: input.attempt.id,
    secondarySubjectId: input.attempt.orderId,
    market: input.attempt.market,
    currency: input.attempt.currency,
    idempotencyKey: `payment.status:${input.attempt.id}:${input.version}`,
    availableAt: input.occurredAt,
  });
  if (command.operation !== "APPEND_OUTBOX_EVENT")
    return rejectPayment("CONTENT_UNAVAILABLE");
  const result = await outbox.append(command);
  if (
    result.outcome !== "SUCCESS" ||
    result.operation !== "APPEND_OUTBOX_EVENT" ||
    result.value.eventId !== input.outboxEventId
  )
    return rejectPayment("TEMPORARY_UNAVAILABLE");
}
export async function markPaymentUnknown(
  client: TransactionClient,
  outbox: OutboxRepository,
  claim: PaymentRuntimeClaim,
  eventId: string,
  outboxEventId: string,
  occurredAt: string,
  reasonCode: string,
) {
  await client.query(
    `UPDATE public.payment_attempts SET status='UNKNOWN',provider_call_started=true,version=version+1,status_evidence_kind='NETWORK_UNCERTAINTY',evidence_reason_code=$2,updated_at=$3::timestamptz WHERE id=$1::uuid`,
    [claim.attempt.id, reasonCode, occurredAt],
  );
  await appendPaymentHistory(client, outbox, {
    attempt: claim.attempt,
    eventId,
    outboxEventId,
    version: claim.attempt.version + 1,
    fromStatus: claim.attempt.status,
    toStatus: "UNKNOWN",
    evidenceKind: "NETWORK_UNCERTAINTY",
    reasonCode,
    requestId: claim.requestId,
    correlationId: claim.correlationId,
    occurredAt,
  });
}
