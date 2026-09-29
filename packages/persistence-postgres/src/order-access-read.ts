import {
  mediaObjectKeySchema,
  orderAccessDetailSchema,
  orderAccessItemSchema,
  orderAccessLocaleSchema,
  orderAccessProofLocationSchema,
  publicMediaUrlSchema,
  type OrderAccessProofCommand,
} from "@fan-support/contracts";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  candidateBindings,
  oneAccessRow,
  rejectOrderAccess,
} from "./order-access-data.js";
import type { TransactionClient } from "./transaction-runner.js";

function historicalLocale(row: DraftRow, prefix: string, dailyColumn: string) {
  const daily = row[dailyColumn] !== null && row[dailyColumn] !== undefined;
  return orderAccessLocaleSchema.parse({
    schemaVersion: 1,
    mode: daily ? "DAILY" : "APPROVED",
    requestedLocale: row[`${prefix}_requested_locale`],
    resolvedLocale: row[`${prefix}_resolved_locale`],
    fallbackUsed: row[`${prefix}_fallback_used`],
    ...(daily ? { sourceLocale: row[`${prefix}_resolved_locale`] } : {}),
  });
}
function historicalMedia(row: DraftRow, prefix: string, baseUrl: string) {
  const objectKey = mediaObjectKeySchema.parse(
    row[`${prefix}_public_object_key`],
  );
  const base = new URL(publicMediaUrlSchema.parse(baseUrl));
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const url = new URL(objectKey, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    return rejectOrderAccess("TEMPORARY_UNAVAILABLE");
  return {
    url: publicMediaUrlSchema.parse(url.href),
    alt: row[`${prefix}_alt`],
    locale: historicalLocale(
      row,
      `${prefix}_alt`,
      `${prefix}_alt_daily_translation_id`,
    ),
  };
}
/**
 * Explicit projection of immutable facts; never load current idol/gift text.
 * A lost dispute returns the whole order's payment (disputes carry no line allocation),
 * so it withdraws every certificate of the order, like a full refund of the line.
 */
export function orderAccessItem(
  row: DraftRow,
  position: number,
  baseUrl: string,
  orderDisputeStatus: unknown = "NONE",
) {
  if (row["schema_version"] !== 1 && row["schema_version"] !== 2)
    return rejectOrderAccess("TEMPORARY_UNAVAILABLE");
  if (row["schema_version"] === 2 && typeof row["variant_label"] !== "string")
    return rejectOrderAccess("TEMPORARY_UNAVAILABLE");
  return orderAccessItemSchema.parse({
    schemaVersion: 1,
    position,
    idol: {
      handle: row["idol_handle"],
      displayName: row["idol_display_name"],
      locale: historicalLocale(
        row,
        "idol_translation",
        "idol_daily_translation_id",
      ),
      portrait: historicalMedia(row, "idol_portrait", baseUrl),
    },
    gift: {
      title: row["gift_title"],
      variantLabel: row["schema_version"] === 1 ? null : row["variant_label"],
      locale: historicalLocale(
        row,
        "gift_translation",
        "gift_daily_translation_id",
      ),
      image: historicalMedia(row, "gift_image", baseUrl),
    },
    quantity: row["quantity"],
    unitAmountMinor: Number(row["unit_amount_minor"]),
    lineSubtotalMinor: Number(row["line_subtotal_minor"]),
    taxAmountMinor: Number(row["tax_amount_minor"]),
    discountAmountMinor: Number(row["discount_amount_minor"]),
    lineTotalMinor: Number(row["line_total_minor"]),
    currency: row["currency"],
    displayMode: row["display_mode"],
    giftKind: row["gift_kind"] ?? null,
    fulfillmentStatus: row["fulfillment_status"],
    deliveryProofs: row["delivery_proofs"],
    supportCertificate:
      row["gift_kind"] === "VIRTUAL" &&
      row["fulfillment_status"] === "DELIVERED"
        ? {
            deliveredAt: row["delivered_at"],
            revoked:
              row["refunded_in_full"] === true || orderDisputeStatus === "LOST",
          }
        : null,
  });
}
export async function readOrderAccessDetail(
  client: TransactionClient,
  order: DraftRow,
  baseUrl: string,
) {
  const rows = await draftRows(
    client,
    `SELECT i.schema_version,i.idol_handle,i.idol_display_name,i.gift_title,
      i.idol_translation_requested_locale,i.idol_translation_resolved_locale,i.idol_translation_fallback_used,i.idol_daily_translation_id,
      i.gift_translation_requested_locale,i.gift_translation_resolved_locale,i.gift_translation_fallback_used,i.gift_daily_translation_id,
      i.idol_portrait_object_key,i.idol_portrait_alt,i.idol_portrait_alt_requested_locale,i.idol_portrait_alt_resolved_locale,i.idol_portrait_alt_fallback_used,i.idol_portrait_alt_daily_translation_id,
      i.gift_image_object_key,i.gift_image_alt,i.gift_image_alt_requested_locale,i.gift_image_alt_resolved_locale,i.gift_image_alt_fallback_used,i.gift_image_alt_daily_translation_id,
      portrait.object_key idol_portrait_public_object_key,gift_image.object_key gift_image_public_object_key,
      i.quantity,i.unit_amount_minor::text,i.line_subtotal_minor::text,i.tax_amount_minor::text,i.discount_amount_minor::text,i.line_total_minor::text,i.currency,i.display_mode,i.gift_kind,f.status fulfillment_status,
      original.line->>'giftVariantLabel' variant_label,delivery_proofs.proofs delivery_proofs,
      ${cartTimestamp("f.delivered_at")} delivered_at,
      (i.line_total_minor>0 AND coalesce((SELECT sum(ri.amount_minor) FROM public.refund_items ri
        JOIN public.refunds refund ON refund.id=ri.refund_id AND refund.order_id=i.order_id
        WHERE ri.order_item_id=i.id AND refund.status='SUCCEEDED'),0)>=i.line_total_minor) refunded_in_full
      FROM public.order_items i LEFT JOIN public.fulfillments f ON f.order_item_id=i.id AND f.order_id=i.order_id
      LEFT JOIN public.checkout_preflight_observations observation ON observation.id=i.checkout_preflight_id
      LEFT JOIN LATERAL(SELECT line FROM jsonb_array_elements(observation.observation#>'{consent,lines}') line WHERE (line->>'cartItemId')::uuid=i.cart_item_id) original ON true
      LEFT JOIN LATERAL(SELECT v.object_key FROM public.media_assets asset JOIN public.media_variants v ON v.media_asset_id=asset.id
        WHERE asset.id=i.idol_portrait_asset_id AND asset.checksum_sha256=i.idol_portrait_checksum_sha256 AND asset.object_key=i.idol_portrait_object_key
          AND v.status='READY' AND v.width<=asset.width AND v.height<=asset.height AND v.width::bigint*asset.height=v.height::bigint*asset.width
        ORDER BY v.width DESC,CASE v.format WHEN 'WEBP' THEN 0 WHEN 'AVIF' THEN 1 ELSE 2 END,v.id LIMIT 1) portrait ON true
      LEFT JOIN LATERAL(SELECT v.object_key FROM public.media_assets asset JOIN public.media_variants v ON v.media_asset_id=asset.id
        WHERE asset.id=i.gift_image_asset_id AND asset.checksum_sha256=i.gift_image_checksum_sha256 AND asset.object_key=i.gift_image_object_key
          AND v.status='READY' AND v.width<=asset.width AND v.height<=asset.height AND v.width::bigint*asset.height=v.height::bigint*asset.width
        ORDER BY v.width DESC,CASE v.format WHEN 'WEBP' THEN 0 WHEN 'AVIF' THEN 1 ELSE 2 END,v.id LIMIT 1) gift_image ON true
      LEFT JOIN LATERAL(SELECT coalesce(jsonb_agg(jsonb_build_object('proofId',p.id,'width',u.display_width,'height',u.display_height,
          'thumbnailWidth',u.thumbnail_width,'thumbnailHeight',u.thumbnail_height) ORDER BY p.sequence),'[]'::jsonb) proofs
        FROM public.fulfillment_proofs p JOIN public.fulfillment_proof_uploads u ON u.id=p.upload_id AND u.fulfillment_id=p.fulfillment_id
        WHERE p.fulfillment_id=f.id AND f.status='DELIVERED' AND i.gift_kind IS DISTINCT FROM 'VIRTUAL' AND u.status='READY'
          AND NOT EXISTS(SELECT 1 FROM public.fulfillment_proof_withdrawals w WHERE w.proof_id=p.id)) delivery_proofs ON true
      WHERE i.order_id=$1::uuid ORDER BY i.created_at,i.id LIMIT 501`,
    [order["id"]],
  );
  return orderAccessDetailSchema.parse({
    schemaVersion: 1,
    publicOrderId: order["public_order_id"],
    publicOrderNo: order["public_order_no"],
    presentationLocale: order["presentation_locale"],
    orderStatus: order["order_status"],
    paymentStatus: order["payment_status"],
    disputeStatus: order["dispute_status"],
    fulfillmentStatus: order["fulfillment_status"],
    amount: {
      schemaVersion: 1,
      currency: order["currency"],
      subtotalMinor: Number(order["subtotal_minor"]),
      taxAmountMinor: Number(order["tax_amount_minor"]),
      shippingAmountMinor: Number(order["shipping_amount_minor"]),
      feeAmountMinor: Number(order["fee_amount_minor"]),
      discountAmountMinor: Number(order["discount_amount_minor"]),
      totalAmountMinor: Number(order["total_amount_minor"]),
    },
    items: rows.map((row, index) =>
      orderAccessItem(row, index + 1, baseUrl, order["dispute_status"]),
    ),
    createdAt: order["created_at"],
    updatedAt: order["updated_at"],
  });
}

/**
 * Lock-free proof authorization: an active session of exactly this order and a proof the fan
 * can see (delivered physical line, READY, not withdrawn). Anything else is ACCESS_DENIED.
 */
export async function locateOrderAccessProof(
  client: TransactionClient,
  command: OrderAccessProofCommand,
) {
  const row = oneAccessRow(
    await draftRows(
      client,
      `SELECT CASE WHEN $4::text='display' THEN u.display_object_key ELSE u.thumbnail_object_key END object_key,
        CASE WHEN $4::text='display' THEN u.display_checksum_sha256 ELSE u.thumbnail_checksum_sha256 END checksum_sha256,
        CASE WHEN $4::text='display' THEN u.display_byte_size ELSE u.thumbnail_byte_size END byte_size,
        CASE WHEN $4::text='display' THEN u.display_width ELSE u.thumbnail_width END width,
        CASE WHEN $4::text='display' THEN u.display_height ELSE u.thumbnail_height END height
       FROM public.order_access_sessions session JOIN public.orders o ON o.id=session.order_id AND o.public_order_id=session.public_order_id
       JOIN public.fulfillment_proofs p ON p.order_id=o.id AND p.id=$3::uuid
       JOIN public.fulfillments f ON f.id=p.fulfillment_id AND f.order_id=p.order_id AND f.status='DELIVERED'
       JOIN public.order_items i ON i.id=f.order_item_id AND i.order_id=f.order_id AND i.gift_kind IS DISTINCT FROM 'VIRTUAL'
       JOIN public.fulfillment_proof_uploads u ON u.id=p.upload_id AND u.fulfillment_id=p.fulfillment_id AND u.status='READY'
       WHERE session.public_order_id=$2::uuid AND session.status='ACTIVE' AND session.created_at<=clock_timestamp() AND session.expires_at>clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM public.fulfillment_proof_withdrawals w WHERE w.proof_id=p.id)
        AND EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS candidate(digest text,version text) WHERE session.session_token_digest=decode(candidate.digest,'hex') AND session.token_pepper_version=candidate.version) LIMIT 2`,
      [
        candidateBindings(command.sessionCandidates),
        command.publicOrderId,
        command.proofId,
        command.rendition,
      ],
    ),
  );
  return orderAccessProofLocationSchema.parse({
    schemaVersion: 1,
    publicOrderId: command.publicOrderId,
    proofId: command.proofId,
    rendition: {
      objectKey: row["object_key"],
      checksumSha256: row["checksum_sha256"],
      byteSize: row["byte_size"],
      width: row["width"],
      height: row["height"],
      mimeType: "image/webp",
    },
  });
}
