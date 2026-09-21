import {
  type AdminFinanceStoreRequest,
  adminFinanceOrderSummarySchema,
} from "@fan-support/contracts";
import {
  draftRows,
  adminOrdersTimestamp,
  financeFailure,
  parseFinanceResponse,
  type DraftRow,
  type TransactionClient,
} from "./admin-finance-data.js";
const summarySql = `SELECT o.*,${adminOrdersTimestamp("o.updated_at")} updated_at,
 coalesce((SELECT a.amount_minor FROM payment_attempts a WHERE a.id=o.current_payment_attempt_id AND a.status='SUCCEEDED'),0) captured,
 coalesce((SELECT sum(requested_amount_minor) FROM refunds r WHERE r.order_id=o.id AND r.status<>'FAILED'),0) occupied,
 coalesce((SELECT sum(processed_amount_minor) FROM refunds r WHERE r.order_id=o.id AND r.status='SUCCEEDED'),0) refunded,
 (EXISTS(SELECT 1 FROM admin_finance_operations x WHERE x.order_id=o.id AND x.phase<>'COMPLETE') OR EXISTS(SELECT 1 FROM payment_attempts a WHERE a.id=o.current_payment_attempt_id AND a.status IN('UNKNOWN','PROCESSING')) OR EXISTS(SELECT 1 FROM admin_finance_application_receipts x WHERE x.order_id=o.id AND x.decision='REVIEW')) needs_reconciliation FROM orders o`;
function summary(row: DraftRow) {
  const captured = Number(row["captured"]),
    occupied = Number(row["occupied"]);
  return adminFinanceOrderSummarySchema.parse({
    orderId: row["id"],
    publicOrderId: row["public_order_id"],
    version: Number(row["version"]),
    presentationLocale: row["presentation_locale"],
    orderStatus: row["order_status"],
    paymentStatus: row["payment_status"],
    disputeStatus: row["dispute_status"],
    currency: row["currency"],
    totalAmountMinor: Number(row["total_amount_minor"]),
    capturedAmountMinor: captured,
    occupiedRefundAmountMinor: occupied,
    refundedAmountMinor: Number(row["refunded"]),
    availableRefundAmountMinor: Math.max(0, captured - occupied),
    needsReconciliation: row["needs_reconciliation"],
    updatedAt: row["updated_at"],
  });
}
export async function readAdminFinance(
  client: TransactionClient,
  request: AdminFinanceStoreRequest,
  canManage: boolean,
) {
  const c = request.command;
  if (c.action === "LIST") {
    const filter = `WHERE ($1='' OR strpos(o.public_order_id::text,lower($1))>0) AND ($2='ALL' OR ($2='REFUNDS' AND EXISTS(SELECT 1 FROM refunds WHERE order_id=o.id)) OR ($2='DISPUTES' AND EXISTS(SELECT 1 FROM disputes WHERE order_id=o.id AND status<>'NONE')) OR ($2='NEEDS_RECONCILIATION' AND (EXISTS(SELECT 1 FROM admin_finance_operations x WHERE x.order_id=o.id AND x.phase<>'COMPLETE') OR EXISTS(SELECT 1 FROM payment_attempts a WHERE a.id=o.current_payment_attempt_id AND a.status IN('PROCESSING','UNKNOWN')) OR EXISTS(SELECT 1 FROM admin_finance_application_receipts x WHERE x.order_id=o.id AND x.decision='REVIEW'))))`;
    const [count] = await draftRows(
      client,
      `SELECT count(*) total FROM orders o ${filter}`,
      [c.query, c.filter],
    );
    const rows = await draftRows(
      client,
      `${summarySql} ${filter} ORDER BY o.updated_at DESC,o.id LIMIT $3 OFFSET $4`,
      [c.query, c.filter, c.pageSize, (c.page - 1) * c.pageSize],
    );
    return parseFinanceResponse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LIST",
      page: c.page,
      pageSize: c.pageSize,
      totalItems: Number(count?.["total"]),
      canManage,
      items: rows.map(summary),
    });
  }
  if (c.action !== "DETAIL") return financeFailure("INVALID_COMMAND");
  const [order] = await draftRows(client, `${summarySql} WHERE o.id=$1`, [
    c.orderId,
  ]);
  if (!order) return financeFailure("NOT_FOUND");
  const items = await draftRows(
    client,
    `SELECT i.id,i.line_total_minor,row_number() over(order by i.created_at,i.id) position,coalesce((SELECT sum(ri.amount_minor) FROM refund_items ri JOIN refunds r ON r.id=ri.refund_id WHERE ri.order_item_id=i.id AND r.status<>'FAILED'),0) occupied FROM order_items i WHERE i.order_id=$1 ORDER BY i.created_at,i.id`,
    [c.orderId],
  );
  const attempts = await draftRows(
    client,
    `SELECT id,status,amount_minor FROM payment_attempts WHERE order_id=$1 ORDER BY created_at,id LIMIT 500`,
    [c.orderId],
  );
  const refunds = await draftRows(
    client,
    `SELECT r.*,${adminOrdersTimestamp("r.created_at")} created_at,${adminOrdersTimestamp("r.updated_at")} updated_at,(SELECT jsonb_agg(jsonb_build_object('orderItemId',i.order_item_id,'amountMinor',i.amount_minor) ORDER BY i.order_item_id) FROM refund_items i WHERE i.refund_id=r.id) allocations FROM refunds r WHERE r.order_id=$1 ORDER BY r.created_at DESC,r.id LIMIT 500`,
    [c.orderId],
  );
  const disputes = await draftRows(
    client,
    `SELECT id,status,amount_minor,${adminOrdersTimestamp("updated_at")} updated_at FROM disputes WHERE order_id=$1 AND status<>'NONE' ORDER BY created_at DESC,id LIMIT 500`,
    [c.orderId],
  );
  const issues = await draftRows(
    client,
    `SELECT provider_event_id,reason_code,${adminOrdersTimestamp("created_at")} created_at FROM admin_finance_application_receipts WHERE order_id=$1 AND decision='REVIEW' ORDER BY created_at DESC LIMIT 100`,
    [c.orderId],
  );
  return parseFinanceResponse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "DETAIL",
    order: summary(order),
    canManage,
    canCancel:
      canManage &&
      order["order_status"] === "PENDING_PAYMENT" &&
      ["PENDING", "UNPAID"].includes(String(order["payment_status"])),
    items: items.map((i) => ({
      orderItemId: i["id"],
      position: Number(i["position"]),
      amountMinor: Number(i["line_total_minor"]),
      occupiedAmountMinor: Number(i["occupied"]),
      availableAmountMinor:
        Number(i["line_total_minor"]) - Number(i["occupied"]),
    })),
    attempts: attempts.map((a) => ({
      attemptId: a["id"],
      status: a["status"],
      amountMinor: Number(a["amount_minor"]),
      canReconcile:
        canManage &&
        ["CREATED", "PROCESSING", "REQUIRES_ACTION", "UNKNOWN"].includes(
          String(a["status"]),
        ),
    })),
    refunds: refunds.map((r) => ({
      refundId: r["id"],
      version: Number(r["version"]),
      status: r["status"],
      amountMinor: Number(r["requested_amount_minor"]),
      processedAmountMinor: Number(r["processed_amount_minor"]),
      allocations: r["allocations"],
      canReconcile:
        canManage && !["SUCCEEDED", "FAILED"].includes(String(r["status"])),
      createdAt: r["created_at"],
      updatedAt: r["updated_at"],
    })),
    disputes: disputes.map((d) => ({
      disputeId: d["id"],
      status: d["status"],
      amountMinor: Number(d["amount_minor"]),
      updatedAt: d["updated_at"],
    })),
    issues: issues.map((i) => ({
      issueId: i["provider_event_id"],
      reasonCode: i["reason_code"],
      createdAt: i["created_at"],
    })),
  });
}
