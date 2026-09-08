import { randomUUID } from "node:crypto";
import {
  auditLogIdSchema,
  contentTimestampSchema,
  paymentRuntimeRecordReconcileCommandSchema,
  providerEventIdSchema,
  type PaymentRuntimeRecordReconcileCommand,
} from "@fan-support/contracts";
import { PaymentRuntimeRepositoryError } from "@fan-support/persistence-port";
import type { TransactionClient } from "./transaction-runner.js";

const unavailable = (): never => {
  throw new PaymentRuntimeRepositoryError("CONTENT_UNAVAILABLE");
};
async function rows(client: TransactionClient, sql: string, values: unknown[]) {
  const result = (await client.query(sql, values)) as { rows?: unknown };
  if (
    !Array.isArray(result?.rows) ||
    result.rows.some(
      (row) => !row || typeof row !== "object" || Array.isArray(row),
    )
  )
    return unavailable();
  return result.rows as Record<string, unknown>[];
}
async function insert(
  client: TransactionClient,
  sql: string,
  values: unknown[],
) {
  const result = await rows(client, sql, values);
  if (
    result.length !== 1 ||
    typeof result[0]?.["id"] !== "string" ||
    result[0]["id"].toLowerCase() !== String(values[0]).toLowerCase()
  )
    unavailable();
}

/** Caller holds the persisted operation fence. This helper appends evidence only, never applies payment success. */
export async function persistPaymentRuntimeEvidence(
  client: TransactionClient,
  input: PaymentRuntimeRecordReconcileCommand,
  recordedAt: string,
): Promise<{ providerEventId: string; auditLogId: string }> {
  const parsed = paymentRuntimeRecordReconcileCommandSchema.safeParse(input);
  if (!parsed.success || !contentTimestampSchema.safeParse(recordedAt).success)
    return unavailable();
  const command = parsed.data;
  const { claim, event } = command;
  if (
    event.eventType !== "PAYMENT_STATUS" ||
    event.association.status !== "MATCHED" ||
    claim.auditLogId === null
  )
    return unavailable();

  // Replay compares instants in PostgreSQL, retaining microseconds and the original audit identity.
  const existing = await rows(
    client,
    `SELECT e.id, e.reconcile_audit_log_id audit_log_id,
    (e.evidence_kind='AUTHENTICATED_RECONCILE' AND e.webhook_inbox_id IS NULL
      AND e.event_type='PAYMENT_STATUS' AND e.normalized_status=$4
      AND e.external_payment_reference=$5
      AND e.provider_refund_reference IS NULL AND e.provider_dispute_reference IS NULL
      AND e.provider_transaction_type IS NOT DISTINCT FROM $6::text
      AND e.provider_transaction_reference IS NOT DISTINCT FROM $7::text
      AND e.amount_minor=$8::bigint AND e.currency=$9
      AND e.occurred_at = $10::timestamptz
      AND EXISTS(SELECT 1 FROM public.audit_logs audit
        WHERE audit.id=e.reconcile_audit_log_id
          AND audit.action='PAYMENT_PROVIDER_RECONCILE'
          AND audit.subject_type='PAYMENT_PROVIDER_ACCOUNT'
          AND audit.subject_id=e.provider_account_id AND audit.outcome='SUCCEEDED'
          AND audit.request_id IS NOT NULL AND audit.correlation_id IS NOT NULL)
      AND (SELECT count(*) FROM public.provider_event_associations association
        WHERE association.provider_event_id=e.id AND association.association_status='MATCHED')=1
      AND EXISTS(SELECT 1 FROM public.provider_event_associations association
        WHERE association.provider_event_id=e.id AND association.association_status='MATCHED'
          AND association.payment_attempt_id=$11::uuid)
      AND ((e.provider_transaction_type IS NULL AND NOT EXISTS(
        SELECT 1 FROM public.payment_transactions ledger WHERE ledger.provider_event_id=e.id))
        OR (e.provider_transaction_type IS NOT NULL
          AND (SELECT count(*) FROM public.payment_transactions ledger WHERE ledger.provider_event_id=e.id)=1
          AND EXISTS(SELECT 1 FROM public.payment_transactions ledger
            WHERE ledger.provider_event_id=e.id AND ledger.payment_attempt_id=$11::uuid
              AND ledger.transaction_type=e.provider_transaction_type
              AND ledger.provider_transaction_reference=e.provider_transaction_reference
              AND ledger.amount_minor=e.amount_minor AND ledger.currency=e.currency
              AND ledger.evidence_kind=e.evidence_kind
              AND ledger.reconcile_audit_log_id=e.reconcile_audit_log_id
              AND ledger.occurred_at=e.occurred_at)))) matches
    FROM public.provider_events e
    WHERE e.provider_account_id=$1::uuid AND e.environment=$2 AND e.provider_event_id=$3`,
    [
      event.providerAccountId,
      event.environment,
      event.providerEventId,
      event.status,
      event.association.externalReference,
      event.transaction?.type ?? null,
      event.transaction?.providerReference ?? null,
      event.amountMinor,
      event.currency,
      event.occurredAt,
      claim.attempt.id,
    ],
  );
  if (existing.length > 1) return unavailable();
  if (existing[0]) {
    const eventId = providerEventIdSchema.safeParse(existing[0]["id"]);
    const auditId = auditLogIdSchema.safeParse(existing[0]["audit_log_id"]);
    if (existing[0]["matches"] !== true || !eventId.success || !auditId.success)
      return unavailable();
    return { providerEventId: eventId.data, auditLogId: auditId.data };
  }

  await insert(
    client,
    `INSERT INTO public.audit_logs
    (id,schema_version,actor_type,task_name,action,subject_type,subject_id,request_id,correlation_id,outcome,created_at)
    VALUES($1::uuid,1,'SYSTEM',$2,'PAYMENT_PROVIDER_RECONCILE','PAYMENT_PROVIDER_ACCOUNT',$3::uuid,$4::uuid,$5::uuid,'SUCCEEDED',$6::timestamptz)
    RETURNING id`,
    [
      claim.auditLogId,
      claim.taskName,
      event.providerAccountId,
      claim.requestId,
      claim.correlationId,
      recordedAt,
    ],
  );
  await insert(
    client,
    `INSERT INTO public.provider_events
    (id,schema_version,provider_account_id,environment,provider_event_id,evidence_kind,reconcile_audit_log_id,
     event_type,normalized_status,external_payment_reference,provider_transaction_type,provider_transaction_reference,
     amount_minor,currency,occurred_at,normalized_at)
    VALUES($1::uuid,1,$2::uuid,$3,$4,'AUTHENTICATED_RECONCILE',$5::uuid,'PAYMENT_STATUS',$6,$7,$8,$9,$10::bigint,$11,$12::timestamptz,$13::timestamptz)
    RETURNING id`,
    [
      command.providerEventId,
      event.providerAccountId,
      event.environment,
      event.providerEventId,
      claim.auditLogId,
      event.status,
      event.association.externalReference,
      event.transaction?.type ?? null,
      event.transaction?.providerReference ?? null,
      event.amountMinor,
      event.currency,
      event.occurredAt,
      recordedAt,
    ],
  );
  await insert(
    client,
    `INSERT INTO public.provider_event_associations
    (id,schema_version,provider_event_id,association_status,payment_attempt_id,reason_code,created_at)
    VALUES($1::uuid,1,$2::uuid,'MATCHED',$3::uuid,'AUTHENTICATED_RECONCILE',$4::timestamptz)
    RETURNING id`,
    [
      command.associationId,
      command.providerEventId,
      claim.attempt.id,
      recordedAt,
    ],
  );
  if (event.transaction)
    await insert(
      client,
      `INSERT INTO public.payment_transactions
      (id,schema_version,payment_attempt_id,transaction_type,provider_transaction_reference,amount_minor,currency,
       evidence_kind,provider_event_id,reconcile_audit_log_id,occurred_at,recorded_at)
      VALUES($1::uuid,1,$2::uuid,$3,$4,$5::bigint,$6,'AUTHENTICATED_RECONCILE',$7::uuid,$8::uuid,$9::timestamptz,$10::timestamptz)
      RETURNING id`,
      [
        randomUUID(),
        claim.attempt.id,
        event.transaction.type,
        event.transaction.providerReference,
        event.amountMinor,
        event.currency,
        command.providerEventId,
        claim.auditLogId,
        event.occurredAt,
        recordedAt,
      ],
    );
  return {
    providerEventId: command.providerEventId,
    auditLogId: claim.auditLogId,
  };
}
