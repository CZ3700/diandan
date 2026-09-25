import { randomUUID } from "node:crypto";
import { inventoryReservationSchema } from "@fan-support/contracts";
import type {
  InventoryRepository,
  OutboxRepository,
} from "@fan-support/persistence-port";
import { appendPaymentHistory } from "./payment-runtime-history.js";
import { applyOrderPaymentInventory } from "./order-payment-inventory.js";
import {
  draftRows,
  insertPaymentRow,
  financeAudit,
  financeIntegrity,
  adminOrdersTimestamp,
  type TransactionClient,
  type DraftRow,
} from "./admin-finance-data.js";
/** Close only a proven uncharged checkout. Captured or uncertain attempts never reach this function. */
export async function cancelFinanceOrder(input: {
  client: TransactionClient;
  inventory: InventoryRepository;
  outbox: OutboxRepository;
  order: DraftRow;
  attempt?: DraftRow;
  actorId?: string;
  providerEvent?: DraftRow;
  requestId: string;
  correlationId: string;
}) {
  const { client, order, attempt, providerEvent, actorId } = input;
  if (order["order_status"] === "CANCELED") return;
  const [{ at } = {}] = await draftRows(
    client,
    `SELECT ${adminOrdersTimestamp("transaction_timestamp()")} at`,
  );
  if (typeof at !== "string") return financeIntegrity();
  if (attempt && attempt["status"] === "CREATED") {
    const [operation] = await draftRows(
      client,
      `SELECT id FROM payment_runtime_operations WHERE attempt_id=$1`,
      [attempt["id"]],
    );
    if (operation || attempt["provider_call_started"] !== false || !actorId)
      return financeIntegrity();
    const audit = await financeAudit(client, {
      actorId,
      action: "FINANCE_PAYMENT_CANCELED",
      subjectType: "PAYMENT_ATTEMPT",
      subjectId: attempt["id"],
      reasonCode: "ORDER_CANCELED",
      requestId: input.requestId,
      correlationId: input.correlationId,
    });
    await client.query(
      `UPDATE payment_attempts SET status='CANCELED',status_evidence_kind='AUDITED_BUSINESS_CANCEL',evidence_audit_log_id=$2,evidence_reason_code='ORDER_CANCELED',version=version+1,updated_at=$3,terminated_at=$3 WHERE id=$1`,
      [attempt["id"], audit, at],
    );
    await appendPaymentHistory(client, input.outbox, {
      attempt: {
        id: attempt["id"],
        orderId: order["id"],
        market: order["market"],
        currency: order["currency"],
      } as Parameters<typeof appendPaymentHistory>[2]["attempt"],
      eventId: randomUUID(),
      outboxEventId: randomUUID(),
      version: Number(attempt["version"]) + 1,
      fromStatus: "CREATED",
      toStatus: "CANCELED",
      evidenceKind: "AUDITED_BUSINESS_CANCEL",
      auditLogId: audit,
      reasonCode: "ORDER_CANCELED",
      requestId: input.requestId,
      correlationId: input.correlationId,
      occurredAt: at,
    });
  } else if (
    attempt &&
    !["FAILED", "CANCELED", "EXPIRED"].includes(String(attempt["status"]))
  )
    return financeIntegrity();
  const rs = await draftRows(
    client,
    `SELECT r.*,ii.id inventory_item_id,${adminOrdersTimestamp("r.expires_at")} expires_at FROM inventory_reservations r JOIN inventory_items ii ON ii.gift_variant_id=r.gift_variant_id WHERE r.locked_order_id=$1 ORDER BY r.id`,
    [order["id"]],
  );
  const reservations = rs.map((r) =>
    inventoryReservationSchema.parse({
      schemaVersion: 1,
      id: r["id"],
      checkoutQuoteId: r["checkout_quote_id"],
      cartItemId: r["cart_item_id"],
      giftVariantId: r["gift_variant_id"],
      inventoryLocationId: r["location_id"],
      quantity: Number(r["quantity"]),
      status: r["status"],
      expiresAt: r["expires_at"],
      version: Number(r["version"]),
    }),
  );
  await applyOrderPaymentInventory({
    repository: input.inventory,
    targets: rs.map((r, i) => ({
      inventoryItemId: String(r["inventory_item_id"]) as Parameters<
        typeof applyOrderPaymentInventory
      >[0]["targets"][number]["inventoryItemId"],
      inventoryLocationId: reservations[i]!.inventoryLocationId,
      reservationId: reservations[i]!.id,
    })),
    reservations,
    targetStatus: "RELEASED",
    evaluatedAt: at,
    requestId: input.requestId,
    correlationId: input.correlationId,
  });
  await client.query(
    `UPDATE support_intents SET status='CANCELED',version=version+1,updated_at=GREATEST($2::timestamptz,updated_at) WHERE id IN(SELECT support_intent_id FROM order_items WHERE order_id=$1) AND status='CHECKOUT_LOCKED'`,
    [order["id"], at],
  );
  await client.query(
    `UPDATE checkout_sessions SET status='EXPIRED',updated_at=GREATEST($2::timestamptz,updated_at) WHERE id=$1 AND status IN('CREATED','READY','PAYMENT_PENDING')`,
    [order["checkout_session_id"], at],
  );
  await client.query(
    `UPDATE carts SET status='EXPIRED',version=version+1,updated_at=GREATEST($2::timestamptz,updated_at) WHERE id=$1 AND status='LOCKED'`,
    [order["cart_id"], at],
  );
  const audit = actorId
    ? await financeAudit(client, {
        actorId,
        action: "ORDER_CANCELED",
        subjectType: "ORDER",
        subjectId: order["id"],
        reasonCode: "ORDER_CANCELED",
        requestId: input.requestId,
        correlationId: input.correlationId,
      })
    : null;
  if (!actorId && !providerEvent) return financeIntegrity();
  await client.query(
    `UPDATE orders SET order_status='CANCELED',version=version+1,updated_at=GREATEST($2::timestamptz,updated_at) WHERE id=$1`,
    [order["id"], at],
  );
  await insertPaymentRow(client, "order_events", {
    id: randomUUID(),
    order_id: order["id"],
    sequence: Number(order["version"]) + 1,
    event_type: "LIFECYCLE_CHANGED",
    from_order_status: order["order_status"],
    to_order_status: "CANCELED",
    from_payment_status: order["payment_status"],
    to_payment_status: order["payment_status"],
    from_dispute_status: order["dispute_status"],
    to_dispute_status: order["dispute_status"],
    from_fulfillment_status: order["fulfillment_status"],
    to_fulfillment_status: order["fulfillment_status"],
    from_payment_attempt_id: order["current_payment_attempt_id"],
    to_payment_attempt_id: order["current_payment_attempt_id"],
    authority_kind: actorId ? "ADMIN" : "PROVIDER_EVIDENCE",
    admin_identity_id: actorId ?? null,
    audit_log_id: audit,
    provider_event_id: providerEvent?.["id"] ?? null,
    reason_code: "ORDER_CANCELED",
    request_id: input.requestId,
    correlation_id: input.correlationId,
    occurred_at: at,
  });
}
