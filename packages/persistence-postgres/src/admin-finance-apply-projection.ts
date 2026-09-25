import { randomUUID } from "node:crypto";
import type {
  AdminFinanceApplyCommand,
  AdminFinanceApplyResult,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import {
  financeTime,
  insertPaymentRow,
  type TransactionClient,
  type DraftRow,
} from "./admin-finance-data.js";
import type { financeProviderEvent } from "./admin-finance-evidence.js";

export type FinanceApplyContext = Readonly<{
  client: TransactionClient;
  outbox: OutboxRepository;
  command: AdminFinanceApplyCommand;
  orderId: string;
  order: DraftRow;
  attempt: DraftRow;
  event: DraftRow;
  result: (
    decision: AdminFinanceApplyResult["decision"],
    reasonCode: string,
    orderId?: string | null,
  ) => AdminFinanceApplyResult;
  record: (
    decision: "APPLIED" | "REVIEW" | "IGNORED",
    reasonCode: string,
  ) => Promise<AdminFinanceApplyResult>;
}>;
export type FinanceCapturedEvidenceContext = FinanceApplyContext &
  Readonly<{
    baseTarget: Readonly<Record<string, unknown>>;
    normalized: ReturnType<typeof financeProviderEvent>;
  }>;

export async function projectFinanceOrder(
  client: TransactionClient,
  order: DraftRow,
  event: DraftRow,
  kind: "REFUND" | "DISPUTE",
  target: string,
  command: AdminFinanceApplyCommand,
) {
  const field = kind === "REFUND" ? "payment_status" : "dispute_status";
  if (order[field] === target) return;
  const at = await financeTime(client, String(order["id"]));
  await client.query(
    `UPDATE orders SET ${field}=$2,version=version+1,updated_at=$3 WHERE id=$1`,
    [order["id"], target, at],
  );
  await insertPaymentRow(client, "order_events", {
    id: randomUUID(),
    order_id: order["id"],
    sequence: Number(order["version"]) + 1,
    event_type:
      kind === "REFUND" ? "PAYMENT_STATUS_CHANGED" : "DISPUTE_STATUS_CHANGED",
    from_order_status: order["order_status"],
    to_order_status: order["order_status"],
    from_payment_status: order["payment_status"],
    to_payment_status: kind === "REFUND" ? target : order["payment_status"],
    from_dispute_status: order["dispute_status"],
    to_dispute_status: kind === "DISPUTE" ? target : order["dispute_status"],
    from_fulfillment_status: order["fulfillment_status"],
    to_fulfillment_status: order["fulfillment_status"],
    from_payment_attempt_id: order["current_payment_attempt_id"],
    to_payment_attempt_id: order["current_payment_attempt_id"],
    authority_kind:
      kind === "REFUND" ? "REFUND_AGGREGATE" : "PROVIDER_EVIDENCE",
    provider_event_id: kind === "DISPUTE" ? event["id"] : null,
    reason_code:
      kind === "REFUND"
        ? "ORDER_REFUND_TOTAL_CONFIRMED"
        : "ORDER_DISPUTE_CONFIRMED",
    request_id: command.requestId,
    correlation_id: command.correlationId,
    occurred_at: at,
  });
}
