import {
  adminOrdersLineSchema,
  adminOrdersListItemSchema,
  adminOrdersResponseSchema,
  checkoutPreflightObservationSchema,
  dailyPublicationDocumentSchema,
  giftKindSchema,
  type AdminOrdersPrincipal,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  adminOrdersTimestamp,
  readAdminOrderLines,
  rejectAdminOrdersIntegrity,
} from "./admin-orders-data.js";
import { fulfillmentActions } from "./admin-orders-rules.js";
import { readOrderAccessDetail } from "./order-access-read.js";
import { readGiftRevisionProfile } from "./gift-commerce-gift-profile.js";
import { readAdminOrderNotification } from "./admin-notification-resend-read.js";
export async function readAdminOrdersList(
  client: Parameters<typeof draftRows>[0],
  request: AdminOrdersStoreRequest,
) {
  const c = request.command;
  if (c.action !== "LIST") return rejectAdminOrdersIntegrity();
  const pattern = `%${c.query.replace(/[\\%_]/gu, "\\$&")}%`;
  const condition = `($1::text='' OR o.public_order_id::text ILIKE $2 OR EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=o.id AND (i.idol_display_name ILIKE $2 OR i.gift_title ILIKE $2)))
 AND ($3::text='ALL' OR o.fulfillment_status=$3)
 AND ($4::text='ALL' OR EXISTS(SELECT 1 FROM public.order_items i JOIN public.support_intents s ON s.id=i.support_intent_id JOIN public.cart_items c ON c.id=i.cart_item_id WHERE i.order_id=o.id AND CASE WHEN $4::text='REJECTED' THEN s.moderation_status IN('REJECTED','REDACTED') ELSE (c.has_fan_message OR s.fan_message_ciphertext IS NOT NULL OR s.display_mode='nickname') AND (s.moderation_status<>'APPROVED' OR s.privacy_state<>'ACTIVE') END))`;
  const args = [c.query, pattern, c.fulfillment, c.moderation];
  const [total] = await draftRows(
    client,
    `SELECT count(*)::text total FROM public.orders o WHERE ${condition}`,
    args,
  );
  const rows = await draftRows(
    client,
    `SELECT o.*,${adminOrdersTimestamp("o.created_at")} created_at,${adminOrdersTimestamp("o.updated_at")} updated_at,
 (SELECT count(*)::int FROM public.order_items i WHERE i.order_id=o.id) item_count,
 (SELECT count(*)::int FROM public.order_items i JOIN public.support_intents s ON s.id=i.support_intent_id JOIN public.cart_items c ON c.id=i.cart_item_id WHERE i.order_id=o.id AND (c.has_fan_message OR s.fan_message_ciphertext IS NOT NULL OR s.display_mode='nickname') AND (s.moderation_status<>'APPROVED' OR s.privacy_state<>'ACTIVE')) pending_review_count
 FROM public.orders o WHERE ${condition} ORDER BY o.created_at DESC,o.id DESC LIMIT $5 OFFSET $6`,
    [...args, c.pageSize, (c.page - 1) * c.pageSize],
  );
  return adminOrdersResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    page: c.page,
    pageSize: c.pageSize,
    totalItems: Number(total?.["total"]),
    items: rows.map((o) =>
      adminOrdersListItemSchema.parse({
        orderId: o["id"],
        publicOrderId: o["public_order_id"],
        version: Number(o["version"]),
        presentationLocale: o["presentation_locale"],
        orderStatus: o["order_status"],
        paymentStatus: o["payment_status"],
        disputeStatus: o["dispute_status"],
        fulfillmentStatus: o["fulfillment_status"],
        currency: o["currency"],
        totalAmountMinor: Number(o["total_amount_minor"]),
        itemCount: o["item_count"],
        pendingReviewCount: o["pending_review_count"],
        createdAt: o["created_at"],
        updatedAt: o["updated_at"],
      }),
    ),
  });
}
async function historicalGiftKind(
  client: Parameters<typeof draftRows>[0],
  line: DraftRow,
) {
  // The purchase-time snapshot (migration 0038) is authoritative; derive only for legacy lines.
  if (typeof line["gift_kind"] === "string")
    return giftKindSchema.parse(line["gift_kind"]);
  const [row] = await draftRows(
    client,
    `SELECT r.id,r.gift_id,r.profile_version,d.document FROM public.gift_revisions r LEFT JOIN public.gift_revision_translations t ON t.gift_revision_id=r.id LEFT JOIN public.daily_publication_revisions d ON d.gift_revision_id=r.id WHERE r.gift_id=$1 AND (t.id=$2::uuid OR d.source_translation_id=$3::uuid) LIMIT 2`,
    [
      line["gift_id"],
      line["gift_translation_revision_id"],
      line["gift_daily_translation_id"],
    ],
  );
  if (!row) return rejectAdminOrdersIntegrity();
  if (Number(row["profile_version"]) === 3) {
    const d = dailyPublicationDocumentSchema.parse(row["document"]);
    if (d.kind !== "GIFT") return rejectAdminOrdersIntegrity();
    return d.giftKind;
  }
  const profile = await readGiftRevisionProfile(
    client,
    String(line["gift_id"]),
    String(row["id"]),
  );
  return profile.kind === "LEGACY" ? "LEGACY" : profile.profile.giftKind;
}
async function historicalInventory(
  client: Parameters<typeof draftRows>[0],
  line: DraftRow,
) {
  if (line["checkout_preflight_id"] === null) return "LEGACY";
  const [row] = await draftRows(
    client,
    "SELECT observation FROM public.checkout_preflight_observations WHERE id=$1",
    [line["checkout_preflight_id"]],
  );
  const observation = checkoutPreflightObservationSchema.parse(
    row?.["observation"],
  );
  const original = observation.consent.lines.find(
    (item) => item.cartItemId === line["cart_item_id"],
  );
  if (
    !original ||
    original.supportIntentId !== line["support_intent_id"] ||
    original.giftId !== line["gift_id"]
  )
    return rejectAdminOrdersIntegrity();
  return original.inventoryPolicy;
}
export async function readAdminOrdersDetail(
  client: Parameters<typeof draftRows>[0],
  order: DraftRow,
  principal: AdminOrdersPrincipal,
  base: string,
) {
  const orderId = String(order["id"]),
    lines = await readAdminOrderLines(client, orderId);
  const items = [];
  for (const [index, line] of lines.entries())
    items.push(
      adminOrdersLineSchema.parse({
        itemId: line["item_id"],
        position: index + 1,
        fulfillmentId: line["fulfillment_id"],
        fulfillmentVersion: Number(line["fulfillment_version"]),
        intentVersion: Number(line["intent_version"]),
        hasMessage: line["has_message"],
        hasDisplayName: line["has_display_name"],
        declaredLocale: line["fan_message_locale"],
        languageConfidence: line["reviewed_locale"]
          ? "CONFIRMED"
          : line["fan_message_locale"] === "und"
            ? "LOW"
            : "UNVERIFIED",
        reviewedLocale: line["reviewed_locale"] ?? null,
        moderationStatus: line["moderation_status"],
        privacyState: line["privacy_state"],
        giftKind: await historicalGiftKind(client, line),
        inventoryPolicy: await historicalInventory(client, line),
        allowedActions: fulfillmentActions(order, line, principal.permissions),
      }),
    );
  const notes = await draftRows(
    client,
    `SELECT id,actor_id,${adminOrdersTimestamp("created_at")} created_at FROM public.admin_order_notes WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`,
    [orderId],
  );
  const notification = await readAdminOrderNotification(client, orderId);
  return adminOrdersResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "DETAIL",
    orderId,
    version: Number(order["version"]),
    order: await readOrderAccessDetail(client, order, base),
    items,
    notes: notes.map((n) => ({
      noteId: n["id"],
      actorId: n["actor_id"],
      createdAt: n["created_at"],
    })),
    notification: {
      ...notification,
      canResend:
        notification.canResend &&
        principal.permissions.includes("orders.notification.resend"),
    },
  });
}
