import {
  mediaObjectKeySchema,
  publicMediaUrlSchema,
  wishGalleryEntrySchema,
  wishGalleryCursorSchema,
} from "@fan-support/contracts";
import { WishGalleryRepositoryError } from "@fan-support/persistence-port";
import type { DraftRow } from "./content-draft-data.js";

export function galleryCursor(supportedAt: string, entryId: string) {
  return Buffer.from(
    JSON.stringify(wishGalleryCursorSchema.parse({ supportedAt, entryId })),
  ).toString("base64url");
}
export function parseGalleryCursor(cursor?: string) {
  if (cursor === undefined) return null;
  try {
    return wishGalleryCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new WishGalleryRepositoryError("INVALID_REQUEST");
  }
}
function media(row: DraftRow, prefix: string, baseUrl: string) {
  const key = mediaObjectKeySchema.parse(row[`${prefix}_public_object_key`]);
  const base = new URL(publicMediaUrlSchema.parse(baseUrl));
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const url = new URL(key, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    throw new WishGalleryRepositoryError("TEMPORARY_UNAVAILABLE");
  return {
    url: publicMediaUrlSchema.parse(url.href),
    alt: row[`${prefix}_alt`],
    locale: row[`${prefix}_alt_resolved_locale`],
  };
}
export function galleryEntry(row: DraftRow, baseUrl: string) {
  if (!["PUBLIC_ANONYMOUS", "PUBLIC_NAMED"].includes(String(row["visibility"])))
    throw new WishGalleryRepositoryError("TEMPORARY_UNAVAILABLE");
  return wishGalleryEntrySchema.parse({
    entryId: row["entry_id"],
    supportedAt: row["supported_at"],
    idol: {
      handle: row["idol_handle"],
      displayName: row["idol_display_name"],
      locale: row["idol_translation_resolved_locale"],
      portrait: media(row, "idol_portrait", baseUrl),
    },
    gift: {
      title: row["gift_title"],
      locale: row["gift_translation_resolved_locale"],
      image: media(row, "gift_image", baseUrl),
    },
    supporter:
      row["visibility"] === "PUBLIC_NAMED"
        ? { kind: "NAMED", alias: row["public_alias"] }
        : { kind: "ANONYMOUS" },
  });
}

/** Shared per-line refund rule with ADR-019: only succeeded allocated refunds count. */
export const wishRefundedInFullSql = `(i.line_total_minor>0 AND coalesce((SELECT sum(ri.amount_minor) FROM public.refund_items ri
 JOIN public.refunds refund ON refund.id=ri.refund_id AND refund.order_id=i.order_id
 WHERE ri.order_item_id=i.id AND refund.status='SUCCEEDED'),0)>=i.line_total_minor)`;
