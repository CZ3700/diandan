import { randomUUID } from "node:crypto";
import {
  orderPaymentApplyResultSchema,
  type OrderPaymentApplyCommand,
} from "@fan-support/contracts";
import type { DraftRow } from "./content-draft-data.js";
import {
  createPersistenceTransactionFailureError,
  type TransactionClient,
} from "./transaction-runner.js";
export function rejectOrderPayment(
  code: "NOT_FOUND" | "INVALID_COMMAND" | "INTEGRITY_VIOLATION",
): never {
  throw createPersistenceTransactionFailureError({ code, recovery: "NONE" });
}
export async function recordOrderPaymentResult(
  client: TransactionClient,
  command: OrderPaymentApplyCommand,
  value:
    | {
        decision: "REVIEW" | "IGNORED";
        attemptId: string | null;
        orderId: string | null;
        reasonCode: string;
      }
    | {
        decision: "APPLIED";
        attemptId: string;
        orderId: string;
        outcome: "PAID" | "PAID_REVIEW" | "FAILED_RELEASED";
      },
  canonicalEventId: string = command.providerEventId,
) {
  const result = orderPaymentApplyResultSchema.parse({
    schemaVersion: 1,
    receiptId: randomUUID(),
    providerEventId: command.providerEventId,
    ...value,
  });
  if (result.decision === "UNMATCHED")
    return rejectOrderPayment("INTEGRITY_VIOLATION");
  await client.query(
    `INSERT INTO public.order_payment_application_receipts(id,provider_event_id,canonical_provider_event_id,attempt_id,order_id,decision,outcome,reason_code,request_id,correlation_id,task_name,result) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::uuid,$10::uuid,$11,$12::jsonb)`,
    [
      result.receiptId,
      command.providerEventId,
      canonicalEventId,
      result.attemptId,
      result.orderId,
      result.decision,
      "outcome" in result ? result.outcome : null,
      "reasonCode" in result ? result.reasonCode : null,
      command.requestId,
      command.correlationId,
      command.taskName,
      JSON.stringify(result),
    ],
  );
  return result;
}

export async function associateOrderPaymentEvidence(
  client: TransactionClient,
  event: DraftRow,
  attemptId: string,
) {
  await client.query(
    `INSERT INTO public.provider_event_associations(id,provider_event_id,association_status,payment_attempt_id,reason_code) SELECT $1::uuid,$2::uuid,'MATCHED',$3::uuid,'MATCHED_BY_REFERENCE' WHERE NOT EXISTS(SELECT 1 FROM public.provider_event_associations WHERE provider_event_id=$2::uuid AND association_status='MATCHED')`,
    [randomUUID(), event["id"], attemptId],
  );
  if (
    event["provider_transaction_type"] !== null &&
    event["provider_transaction_type"] !== undefined &&
    !event["canonical_transaction_event_id"]
  )
    await client.query(
      `INSERT INTO public.payment_transactions(id,payment_attempt_id,transaction_type,provider_transaction_reference,amount_minor,currency,evidence_kind,provider_event_id,reconcile_audit_log_id,occurred_at,recorded_at) SELECT $1::uuid,$2::uuid,e.provider_transaction_type,e.provider_transaction_reference,e.amount_minor,e.currency,e.evidence_kind,e.id,e.reconcile_audit_log_id,e.occurred_at,GREATEST(clock_timestamp(),e.occurred_at) FROM public.provider_events e WHERE e.id=$3::uuid AND NOT EXISTS(SELECT 1 FROM public.payment_transactions WHERE provider_event_id=e.id)`,
      [randomUUID(), attemptId, event["id"]],
    );
}
