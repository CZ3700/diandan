import type { OrderPaymentApplicationRepository } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./admin-finance-data.js";
import type { FinanceApplyContext } from "./admin-finance-apply-projection.js";

export async function applyFinancePayment({
  client,
  command,
  orderId,
  attempt,
  event,
  result,
  record,
  operations,
  payments,
  cancelOrder,
}: FinanceApplyContext &
  Readonly<{
    operations: readonly DraftRow[];
    payments: OrderPaymentApplicationRepository;
    cancelOrder: (attempt: DraftRow) => Promise<void>;
  }>) {
  const target = String(event["normalized_status"]);
  if (!["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(target)) {
    if (
      operations.some(
        (x) =>
          x["action"] === "CANCEL" &&
          x["phase"] !== "COMPLETE" &&
          Number(x["dispatch_count"]) === 0,
      ) &&
      ["PROCESSING", "REQUIRES_ACTION"].includes(target)
    )
      await client.query(
        `UPDATE admin_finance_operations SET phase='CANCEL_READY',next_attempt_at=clock_timestamp(),updated_at=GREATEST(clock_timestamp(),updated_at) WHERE order_id=$1 AND action='CANCEL' AND phase<>'COMPLETE' AND dispatch_count=0`,
        [orderId],
      );
    return record("IGNORED", "NONTERMINAL_PAYMENT_OBSERVATION");
  }
  const payment = await payments.apply(command);
  if (payment.decision === "UNMATCHED")
    return result("UNMATCHED", "PAYMENT_APPLICATION_PENDING", orderId);
  const [current] = await draftRows(
    client,
    `SELECT * FROM payment_attempts WHERE id=$1`,
    [attempt["id"]],
  );
  if (!current || current["status"] !== target)
    return record("REVIEW", "PAYMENT_APPLICATION_REQUIRES_REVIEW");
  if (
    operations.some(
      (x) => x["action"] === "CANCEL" && x["phase"] !== "COMPLETE",
    ) &&
    target !== "SUCCEEDED"
  ) {
    await cancelOrder(current);
  }
  await client.query(
    `UPDATE admin_finance_operations SET phase='COMPLETE',lease_token_digest=NULL,lease_expires_at=NULL,claim=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE order_id=$1 AND refund_id IS NULL AND phase<>'COMPLETE'`,
    [orderId],
  );
  return record(
    "APPLIED",
    target === "SUCCEEDED"
      ? "PAYMENT_CAPTURE_CONFIRMED"
      : "PAYMENT_CANCELLATION_CONFIRMED",
  );
}
