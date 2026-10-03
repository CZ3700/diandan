import { giftKindSchema, type GiftKind } from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/**
 * The purchase-time gift kind of an order line, read from the immutable gift revision the line
 * references: the daily publication document first, then the gift revision profile. Legacy
 * revisions without a profile have no kind. Migration 0038 backfills with the same rule.
 */
export const orderLineGiftKindSql = `SELECT COALESCE(
  (SELECT d.document->>'giftKind' FROM public.daily_publication_revisions d WHERE d.source_translation_id=$3::uuid AND d.document->>'kind'='GIFT'),
  (SELECT p.gift_kind FROM public.gift_revision_translations t JOIN public.gift_revision_profiles p ON p.gift_revision_id=t.gift_revision_id AND p.gift_id=$1::uuid WHERE t.id=$2::uuid)
) gift_kind`;

export async function resolveOrderLineGiftKind(
  client: TransactionClient,
  line: Readonly<{
    giftId: string;
    giftTranslationRevisionId: string | null;
    giftDailyTranslationId: string | null;
  }>,
): Promise<GiftKind | null> {
  const [row] = await draftRows(client, orderLineGiftKindSql, [
    line.giftId,
    line.giftTranslationRevisionId,
    line.giftDailyTranslationId,
  ]);
  return giftKindSchema.nullable().parse(row?.["gift_kind"] ?? null);
}
