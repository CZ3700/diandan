import { randomUUID } from "node:crypto";
import type {
  AdminFinanceCommand,
  AdminFinanceFailure,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import {
  draftRows,
  financeFailure,
  financeHistory,
  insertPaymentRow,
  type TransactionClient,
  type DraftRow,
} from "./admin-finance-data.js";
type RefundCommand = Extract<AdminFinanceCommand, { action: "REFUND" }>;
/** The caller holds the order and attempt locks before checking the complete occupied set. */
export async function validateFinanceRefund(
  client: TransactionClient,
  c: RefundCommand,
  order: DraftRow,
  attempt: DraftRow | undefined,
): Promise<AdminFinanceFailure | null> {
  if (
    attempt?.["status"] !== "SUCCEEDED" ||
    !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
      String(order["payment_status"]),
    )
  )
    return financeFailure("PAYMENT_NOT_CONFIRMED");
  const disputes = await draftRows(
    client,
    `SELECT id,status FROM disputes WHERE payment_attempt_id=$1 ORDER BY id FOR UPDATE`,
    [attempt?.["id"]],
  );
  if (disputes.some((d) => ["OPEN", "LOST"].includes(String(d["status"]))))
    return financeFailure("DISPUTE_REQUIRES_REVIEW");
  if (c.currency !== attempt?.["currency"])
    return financeFailure("CURRENCY_MISMATCH");
  const [capture] = await draftRows(
    client,
    `SELECT id FROM payment_transactions WHERE payment_attempt_id=$1 AND transaction_type='CAPTURE' AND amount_minor=$2 AND currency=$3`,
    [attempt?.["id"], attempt?.["amount_minor"], attempt?.["currency"]],
  );
  if (!capture) return financeFailure("PAYMENT_NOT_CONFIRMED");
  const refunds = await draftRows(
    client,
    `SELECT * FROM refunds WHERE payment_attempt_id=$1 ORDER BY id FOR UPDATE`,
    [attempt?.["id"]],
  );
  const occupied = refunds.reduce(
    (sum, r) =>
      sum +
      (r["status"] === "FAILED"
        ? 0n
        : BigInt(String(r["requested_amount_minor"]))),
    0n,
  );
  if (
    occupied + BigInt(c.amountMinor) >
    BigInt(String(attempt?.["amount_minor"]))
  )
    return financeFailure("REFUND_CAPACITY_EXCEEDED");
  const lines = await draftRows(
    client,
    `SELECT i.id,i.line_total_minor,coalesce((SELECT sum(ri.amount_minor) FROM refund_items ri JOIN refunds r ON r.id=ri.refund_id WHERE ri.order_item_id=i.id AND r.status<>'FAILED'),0) occupied FROM order_items i WHERE i.order_id=$1 ORDER BY i.id FOR UPDATE OF i`,
    [c.orderId],
  );
  for (const allocation of c.allocations) {
    const item = lines.find((i) => i["id"] === allocation.orderItemId);
    if (
      !item ||
      BigInt(String(item["occupied"])) + BigInt(allocation.amountMinor) >
        BigInt(String(item["line_total_minor"]))
    )
      return financeFailure("REFUND_ITEM_CAPACITY_EXCEEDED");
  }
  return null;
}
/** The accepted request, item allocations and outbox history stay in the receipt transaction. */
export async function recordFinanceRefund(
  client: TransactionClient,
  outbox: OutboxRepository,
  input: {
    command: RefundCommand;
    refundId: string;
    order: DraftRow;
    attempt: DraftRow | undefined;
    auditId: string;
    trace: { requestId: string; correlationId: string };
  },
): Promise<void> {
  const { command: c, refundId, order, attempt, auditId, trace } = input;
  const [refund] = await draftRows(
    client,
    `INSERT INTO refunds(id,order_id,payment_attempt_id,provider_account_id,environment,provider_reference,idempotency_key,requested_audit_log_id,captured_currency,currency,captured_amount_minor,requested_amount_minor,status,status_evidence_kind) VALUES($1,$2,$3,$4,$5,($1::uuid)::text,$6,$7,$8,$8,$9,$10,'REQUESTED','REFUND_REQUESTED') RETURNING *,${"to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"} at`,
    [
      refundId,
      c.orderId,
      attempt?.["id"],
      attempt?.["provider_account_id"],
      attempt?.["environment"],
      refundId,
      auditId,
      c.currency,
      attempt?.["amount_minor"],
      c.amountMinor,
    ],
  );
  for (const a of c.allocations)
    await insertPaymentRow(client, "refund_items", {
      id: randomUUID(),
      refund_id: refundId,
      order_id: c.orderId,
      order_item_id: a.orderItemId,
      amount_minor: a.amountMinor,
    });
  if (!refund) throw new Error("REFUND_INSERT_FAILED");
  await financeHistory(
    client,
    outbox,
    "REFUND",
    refund,
    order,
    null,
    trace,
    String(refund["at"]),
  );
}
