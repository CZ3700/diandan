import type {
  AdminFinanceApplyCommand,
  AdminFinanceApplyResult,
} from "@fan-support/contracts";
import type {
  OutboxRepository,
  OrderPaymentApplicationRepository,
  InventoryRepository,
} from "@fan-support/persistence-port";
import { lockAdminOrder } from "./admin-orders-data.js";
import { cancelFinanceOrder } from "./admin-finance-cancel.js";
import { financeProviderEvent } from "./admin-finance-evidence.js";
import {
  draftRows,
  insertPaymentRow,
  adminOrdersTimestamp,
  financeAttempt,
  financeIntegrity,
  financeAudit,
  type TransactionClient,
} from "./admin-finance-data.js";
import { applyFinancePayment } from "./admin-finance-apply-payment.js";
import { applyFinanceRefund } from "./admin-finance-apply-refund.js";
import { applyFinanceDispute } from "./admin-finance-apply-dispute.js";

export async function applyAdminFinance(
  client: TransactionClient,
  outbox: OutboxRepository,
  inventory: InventoryRepository,
  payments: OrderPaymentApplicationRepository,
  command: AdminFinanceApplyCommand,
): Promise<AdminFinanceApplyResult> {
  const result = (
    decision: AdminFinanceApplyResult["decision"],
    reasonCode: string,
    orderId: string | null = null,
  ): AdminFinanceApplyResult => ({
    schemaVersion: 1,
    providerEventId: command.providerEventId,
    decision,
    orderId,
    reasonCode,
  });
  const [initial] = await draftRows(
    client,
    `SELECT e.*,a.id attempt_id,a.order_id FROM provider_events e LEFT JOIN payment_attempts a ON a.id IN(SELECT payment_attempt_id FROM provider_event_associations WHERE provider_event_id=e.id AND association_status='MATCHED') OR (NOT EXISTS(SELECT 1 FROM provider_event_associations WHERE provider_event_id=e.id AND association_status='MATCHED') AND a.provider_account_id=e.provider_account_id AND a.environment=e.environment AND a.external_reference=e.external_payment_reference) WHERE e.id=$1`,
    [command.providerEventId],
  );
  if (!initial) return result("UNMATCHED", "EVIDENCE_NOT_FOUND");
  if (!initial["order_id"])
    return result("UNMATCHED", "EXTERNAL_REFERENCE_NOT_BOUND");
  const orderId = String(initial["order_id"]);
  // Operations precede aggregates everywhere: a recovery lease cannot deadlock an evidence applier.
  await draftRows(
    client,
    `SELECT id FROM payment_runtime_operations WHERE attempt_id=$1 ORDER BY id FOR UPDATE`,
    [initial["attempt_id"]],
  );
  const operations = await draftRows(
    client,
    `SELECT * FROM admin_finance_operations WHERE order_id=$1 ORDER BY id FOR UPDATE`,
    [orderId],
  );
  const [event] = await draftRows(
    client,
    `SELECT e.*,${adminOrdersTimestamp("e.occurred_at")} occurred_at FROM provider_events e WHERE id=$1 FOR UPDATE`,
    [command.providerEventId],
  );
  if (!event) return financeIntegrity();
  const [prior] = await draftRows(
    client,
    `SELECT * FROM admin_finance_application_receipts WHERE provider_event_id=$1`,
    [command.providerEventId],
  );
  if (prior)
    return result(
      prior["decision"] === "APPLIED"
        ? "ALREADY_APPLIED"
        : (prior["decision"] as "REVIEW" | "IGNORED"),
      String(prior["reason_code"]),
      orderId,
    );
  const record = async (
    decision: "APPLIED" | "REVIEW" | "IGNORED",
    reason: string,
  ) => {
    if (decision === "REVIEW")
      await financeAudit(client, {
        action: "FINANCE_EVIDENCE_REVIEW_REQUIRED",
        subjectType: "ORDER",
        subjectId: orderId,
        reasonCode: reason,
        requestId: command.requestId,
        correlationId: command.correlationId,
      });
    await insertPaymentRow(client, "admin_finance_application_receipts", {
      provider_event_id: command.providerEventId,
      order_id: orderId,
      decision,
      reason_code: reason,
      request_id: command.requestId,
      correlation_id: command.correlationId,
    });
    return result(decision, reason, orderId);
  };
  const order = await lockAdminOrder(client, orderId);
  if (!order) return financeIntegrity();
  const attempt = await financeAttempt(client, order);
  if (!attempt) return result("UNMATCHED", "PAYMENT_CAPTURE_PENDING", orderId);
  if (
    attempt["id"] !== initial["attempt_id"] ||
    event["provider_account_id"] !== attempt["provider_account_id"] ||
    event["environment"] !== attempt["environment"] ||
    (attempt["external_reference"] !== null &&
      event["external_payment_reference"] !== attempt["external_reference"]) ||
    event["currency"] !== attempt["currency"]
  )
    return record("REVIEW", "PAYMENT_IDENTITY_MISMATCH");
  const context = {
    client,
    outbox,
    command,
    orderId,
    order,
    attempt,
    event,
    result,
    record,
  };
  if (event["event_type"] === "PAYMENT_STATUS")
    return applyFinancePayment({
      ...context,
      operations,
      payments,
      cancelOrder: async (current) => {
        const currentOrder = await lockAdminOrder(client, orderId);
        if (!currentOrder) return financeIntegrity();
        await cancelFinanceOrder({
          client,
          inventory,
          outbox,
          order: currentOrder,
          attempt: current,
          providerEvent: event,
          requestId: command.requestId,
          correlationId: command.correlationId,
        });
      },
    });
  if (
    attempt["status"] !== "SUCCEEDED" ||
    !["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
      String(order["payment_status"]),
    )
  )
    return result("UNMATCHED", "PAYMENT_CAPTURE_PENDING", orderId);
  const baseTarget = {
    paymentAttemptId: String(attempt["id"]),
    providerAccountId: String(attempt["provider_account_id"]),
    environment: attempt["environment"],
    externalReference: attempt["external_reference"],
    capturedAmountMinor: Number(attempt["amount_minor"]),
    currency: attempt["currency"],
  };
  const normalized = financeProviderEvent(event, attempt["id"]);
  if (event["event_type"] === "REFUND_STATUS") {
    const [refund] = await draftRows(
      client,
      `SELECT * FROM refunds WHERE provider_account_id=$1 AND environment=$2 AND provider_reference=$3 FOR UPDATE`,
      [
        event["provider_account_id"],
        event["environment"],
        event["provider_refund_reference"],
      ],
    );
    return applyFinanceRefund({ ...context, baseTarget, normalized, refund });
  }
  const [dispute] = await draftRows(
    client,
    `SELECT * FROM disputes WHERE provider_account_id=$1 AND environment=$2 AND provider_reference=$3 FOR UPDATE`,
    [
      event["provider_account_id"],
      event["environment"],
      event["provider_dispute_reference"],
    ],
  );
  return applyFinanceDispute({ ...context, baseTarget, normalized, dispute });
}
