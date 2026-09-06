import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** A rollback selects immutable SUPERSEDED rows through the current typed publication head. */
const currentPriceBookJoin = `FROM public.price_book_publication_heads h
 JOIN public.price_book_publications p ON p.id=h.publication_id
  AND p.price_book_id=h.price_book_id AND p.price_book_revision=h.price_book_revision
  AND p.market_id=h.market_id AND p.market=h.market AND p.currency=h.currency
 JOIN public.price_books b ON b.id=h.price_book_id AND b.revision=h.price_book_revision
  AND b.market_id=h.market_id AND b.market=h.market AND b.currency=h.currency
  AND b.lifecycle=CASE p.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END`;
const isLeaf = `NOT EXISTS(SELECT 1 FROM public.price_book_publications successor WHERE successor.replaces_publication_id=p.id)`;

export async function loadGiftCurrentPriceEvidence(
  client: TransactionClient,
  variantIds: readonly unknown[],
): Promise<{ bookRows: DraftRow[]; priceRows: DraftRow[] }> {
  const books = await draftRows(
    client,
    `SELECT to_jsonb(b.*)||jsonb_build_object('lifecycle','PUBLISHED') AS value
     ${currentPriceBookJoin}
     WHERE ${isLeaf} AND EXISTS(SELECT 1 FROM public.prices r WHERE r.price_book_id=b.id AND r.price_book_revision=b.revision AND r.gift_variant_id=ANY($1::uuid[]))
     ORDER BY h.market,h.currency FOR SHARE OF h,p,b`,
    [variantIds],
  );
  const prices = await draftRows(
    client,
    `SELECT to_jsonb(r.*) AS value ${currentPriceBookJoin}
     JOIN public.prices r ON r.price_book_id=b.id AND r.price_book_revision=b.revision
      AND r.market=h.market AND r.currency=h.currency
      AND ((p.action='PUBLISH' AND r.status='PUBLISHED') OR (p.action='ROLLBACK' AND r.status IN('PUBLISHED','SUPERSEDED')))
     WHERE ${isLeaf} AND r.gift_variant_id=ANY($1::uuid[])
     ORDER BY r.id FOR SHARE OF h,p,b,r`,
    [variantIds],
  );
  return {
    bookRows: books.map((row) => row["value"] as DraftRow),
    priceRows: prices.map((row) => row["value"] as DraftRow),
  };
}
