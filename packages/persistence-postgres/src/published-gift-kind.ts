import {
  giftKindSchema,
  type GiftDirectoryRecord,
  type GiftKind,
} from "@fan-support/contracts";

/**
 * The published classification of a gift revision (ADR-019): its daily publication document first,
 * then its revision profile. Legacy revisions have neither and read as NULL. Both joins are on unique
 * revision keys, so they never multiply catalog rows. `order-line-gift-kind.ts` applies the same rule.
 */
export const publishedGiftKindJoins = `LEFT JOIN public.daily_publication_revisions kind_document ON kind_document.gift_revision_id = revision.id
      LEFT JOIN public.gift_revision_profiles kind_profile ON kind_profile.gift_revision_id = revision.id AND kind_profile.gift_id = gift.id`;

export const publishedGiftKindColumn = `coalesce(kind_document.document->>'giftKind', kind_profile.gift_kind) AS gift_kind`;

export function parsePublishedGiftKind(value: unknown): GiftKind | null {
  return giftKindSchema.nullable().parse(value);
}

/** A daily record proves its own kind; a legacy record's kind comes only from its revision profile. */
export function recordConfirmsGiftKind(
  record: GiftDirectoryRecord,
  giftKind: GiftKind | null,
): boolean {
  if (record.schemaVersion !== 3) return true;
  const document = record.context.current.document;
  return document.kind === "GIFT" && document.giftKind === giftKind;
}
