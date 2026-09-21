import { decideFinanceEvidence } from "@fan-support/domain";
import { associateOrderPaymentEvidence } from "./order-payment-data.js";
import {
  draftRows,
  financeRefundTransition,
  type DraftRow,
} from "./admin-finance-data.js";
import {
  projectFinanceOrder,
  type FinanceCapturedEvidenceContext,
} from "./admin-finance-apply-projection.js";

export async function applyFinanceRefund({
  client,
  outbox,
  command,
  orderId,
  order,
  attempt,
  event,
  result,
  record,
  baseTarget,
  normalized,
  refund,
}: FinanceCapturedEvidenceContext &
  Readonly<{ refund: DraftRow | undefined }>) {
  if (!refund) return result("UNMATCHED", "REFUND_REQUEST_NOT_FOUND", orderId);
  if (
    refund["order_id"] !== orderId ||
    refund["payment_attempt_id"] !== attempt["id"] ||
    refund["provider_account_id"] !== attempt["provider_account_id"] ||
    refund["environment"] !== attempt["environment"]
  )
    return record("REVIEW", "REFUND_IDENTITY_MISMATCH");
  const decision = decideFinanceEvidence({
    schemaVersion: 1,
    kind: "REFUND",
    currentStatus: refund["status"],
    target: {
      ...baseTarget,
      providerReference: refund["provider_reference"],
      amountMinor: Number(refund["requested_amount_minor"]),
    },
    event: normalized,
  });
  if (decision.decision === "WAIT")
    return result("UNMATCHED", decision.reasonCode, orderId);
  if (decision.decision !== "APPLY")
    return record(
      decision.decision === "IGNORE" ? "IGNORED" : "REVIEW",
      decision.reasonCode,
    );
  await associateOrderPaymentEvidence(client, event, String(attempt["id"]));
  const updated = await financeRefundTransition(
    client,
    outbox,
    refund,
    order,
    decision.targetStatus!,
    command,
    event,
  );
  if (updated["status"] === "SUCCEEDED") {
    const [total] = await draftRows(
      client,
      `SELECT coalesce(sum(processed_amount_minor),0) amount FROM refunds WHERE order_id=$1 AND status='SUCCEEDED'`,
      [orderId],
    );
    await projectFinanceOrder(
      client,
      order,
      event,
      "REFUND",
      Number(total?.["amount"]) === Number(attempt["amount_minor"])
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED",
      command,
    );
  }
  if (["SUCCEEDED", "FAILED"].includes(String(updated["status"])))
    await client.query(
      `UPDATE admin_finance_operations SET phase='COMPLETE',lease_token_digest=NULL,lease_expires_at=NULL,claim=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE refund_id=$1 AND phase<>'COMPLETE'`,
      [refund["id"]],
    );
  return record("APPLIED", "REFUND_STATUS_CONFIRMED");
}
