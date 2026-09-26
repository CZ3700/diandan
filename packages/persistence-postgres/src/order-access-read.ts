import {
  mediaObjectKeySchema,
  orderAccessDetailSchema,
  orderAccessItemSchema,
  orderAccessLocaleSchema,
  publicMediaUrlSchema,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { rejectOrderAccess } from "./order-access-data.js";
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
/** Explicit projection of immutable facts; never load current idol/gift text. */
export function orderAccessItem(
  row: DraftRow,
  position: number,
  baseUrl: string,
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
      original.line->>'giftVariantLabel' variant_label
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
      WHERE i.order_id=$1::uuid ORDER BY i.created_at,i.id LIMIT 501`,
    [order["id"]],
  );
  return orderAccessDetailSchema.parse({
    schemaVersion: 1,
    publicOrderId: order["public_order_id"],
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
    items: rows.map((row, index) => orderAccessItem(row, index + 1, baseUrl)),
    createdAt: order["created_at"],
    updatedAt: order["updated_at"],
  });
}
