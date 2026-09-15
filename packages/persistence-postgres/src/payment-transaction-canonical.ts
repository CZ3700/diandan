import { associateOrderPaymentEvidence } from "./order-payment-data.js";
import { draftRows } from "./content-draft-data.js";
import {
  createPersistenceTransactionFailureError,
  type TransactionClient,
} from "./transaction-runner.js";
export type PaymentCanonicalFacts = {
  providerAccountId: string;
  environment: string;
  eventType: string;
  status: string;
  externalReference: string;
  amountMinor: number;
  currency: string;
  knownAttemptId?: string;
  transaction?: { type: string; providerReference: string };
};
/** A missing bridge is supported only by explicitly historical migration fixtures. No evidence is discarded. */
export async function resolveCanonicalPaymentTransaction(
  client: TransactionClient,
  input: PaymentCanonicalFacts,
): Promise<{ supported: boolean; canonicalId: string | null }> {
  if (input.transaction?.type !== "CAPTURE")
    return { supported: false, canonicalId: null };
  const [feature] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.provider_events'::regclass AND attname='canonical_transaction_event_id' AND NOT attisdropped) supported`,
    [],
  );
  if (feature?.["supported"] !== true)
    return { supported: false, canonicalId: null };
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `${input.providerAccountId}:${input.environment}:${input.transaction.type}:${input.transaction.providerReference}`,
  ]);
  const [existing] = await draftRows(
    client,
    `SELECT e.id,e.provider_transaction_type,(e.event_type=$5 AND e.normalized_status=$6 AND e.external_payment_reference=$7 AND e.amount_minor=$8::bigint AND e.currency=$9) matches,EXISTS(SELECT 1 FROM public.payment_transactions ledger JOIN public.provider_event_associations association ON association.provider_event_id=e.id AND association.association_status='MATCHED' AND association.payment_attempt_id=ledger.payment_attempt_id WHERE ledger.provider_event_id=e.id AND ledger.transaction_type=e.provider_transaction_type AND ledger.provider_transaction_reference=e.provider_transaction_reference AND ledger.amount_minor=e.amount_minor AND ledger.currency=e.currency AND ledger.evidence_kind=e.evidence_kind AND ledger.reconcile_audit_log_id IS NOT DISTINCT FROM e.reconcile_audit_log_id AND ledger.occurred_at=e.occurred_at) complete FROM public.provider_events e WHERE e.provider_account_id=$1::uuid AND e.environment=$2 AND e.provider_transaction_type=$3 AND e.provider_transaction_reference=$4 AND e.canonical_transaction_event_id IS NULL`,
    [
      input.providerAccountId,
      input.environment,
      input.transaction.type,
      input.transaction.providerReference,
      input.eventType,
      input.status,
      input.externalReference,
      input.amountMinor,
      input.currency,
    ],
  );
  if (!existing) return { supported: true, canonicalId: null };
  if (existing["matches"] !== true)
    throw createPersistenceTransactionFailureError({
      code: "IDEMPOTENCY_CONFLICT",
      recovery: "NONE",
    });
  if (existing["complete"] !== true) {
    const matches = await draftRows(
      client,
      `SELECT a.id FROM public.payment_attempts a WHERE a.provider_account_id=$1::uuid AND a.environment=$2 AND a.amount_minor=$4::bigint AND a.currency=$5 AND (a.external_reference=$3 OR (a.id=$6::uuid AND a.external_reference IS NULL))`,
      [
        input.providerAccountId,
        input.environment,
        input.externalReference,
        input.amountMinor,
        input.currency,
        input.knownAttemptId ?? null,
      ],
    );
    if (matches.length !== 1)
      throw createPersistenceTransactionFailureError({
        code: "TRANSACTION_ABORTED",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      });
    const [association] = await draftRows(
      client,
      `SELECT payment_attempt_id FROM public.provider_event_associations WHERE provider_event_id=$1::uuid AND association_status='MATCHED'`,
      [existing["id"]],
    );
    if (association && association["payment_attempt_id"] !== matches[0]!["id"])
      throw createPersistenceTransactionFailureError({
        code: "INTEGRITY_VIOLATION",
        recovery: "NONE",
      });
    await associateOrderPaymentEvidence(
      client,
      existing,
      String(matches[0]!["id"]),
    );
  }
  return { supported: true, canonicalId: String(existing["id"]) };
}
