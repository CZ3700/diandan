import {
  idolIdSchema,
  slugSchema,
  storefrontContextResponseSchema,
  storefrontGiftVariantFactsSchema,
  type StorefrontGiftVariantFacts,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

// All effective-time predicates use this transaction's PostgreSQL timestamp, retaining microseconds.
const currentBook = `FROM public.price_book_publication_heads h
 JOIN public.price_book_publications p ON p.id=h.publication_id
  AND p.price_book_id=h.price_book_id AND p.price_book_revision=h.price_book_revision
  AND p.market_id=h.market_id AND p.market=h.market AND p.currency=h.currency
 JOIN public.markets market ON market.id=h.market_id AND market.market=h.market AND market.status='ACTIVE'
 JOIN public.price_books b ON b.id=h.price_book_id AND b.revision=h.price_book_revision
  AND b.market_id=h.market_id AND b.market=h.market AND b.currency=h.currency
  AND b.lifecycle=CASE p.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
  AND b.valid_from<=transaction_timestamp() AND (b.valid_until IS NULL OR transaction_timestamp()<b.valid_until)`;
const priceJoin = `JOIN public.prices price ON price.price_book_id=b.id AND price.price_book_revision=b.revision
 AND price.market=h.market AND price.currency=h.currency
 AND ((p.action='PUBLISH' AND price.status='PUBLISHED') OR (p.action='ROLLBACK' AND price.status IN('PUBLISHED','SUPERSEDED')))
 AND price.valid_from<=transaction_timestamp() AND (price.valid_to IS NULL OR transaction_timestamp()<price.valid_to)`;
const leaf = `NOT EXISTS(SELECT 1 FROM public.price_book_publications successor WHERE successor.replaces_publication_id=p.id)`;
const invalid = () => new Error("STOREFRONT_COMMERCE_DATA_INVALID");

export async function readStorefrontMarkets(client: TransactionClient) {
  const rows = await draftRows(
    client,
    `SELECT market,array_agg(currency::text ORDER BY currency COLLATE "C") currencies FROM (
   SELECT DISTINCT h.market,h.currency ${currentBook} ${priceJoin} WHERE ${leaf}
  ) scopes GROUP BY market ORDER BY market COLLATE "C" LIMIT 501`,
  );
  const response = storefrontContextResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_CONTEXT",
    markets: rows,
    policies: [],
  });
  if (response.outcome !== "SUCCESS") throw invalid();
  return response.markets;
}
export async function hasStorefrontMarket(
  client: TransactionClient,
  market: string,
  currency: string,
) {
  const rows = await draftRows(
    client,
    `SELECT h.market ${currentBook} ${priceJoin}
    WHERE ${leaf} AND h.market=$1 AND h.currency=$2 LIMIT 1`,
    [market, currency],
  );
  return rows.length === 1;
}
export type StorefrontRecipientWitness = Readonly<{
  variantId: string;
  idolId: string;
  handle: string;
}>;
export async function readStorefrontVariantFacts(
  client: TransactionClient,
  input: Readonly<{
    giftId: string;
    variantIds: readonly string[];
    market: string;
    currency: string;
    idolId: string | null;
  }>,
): Promise<{
  facts: StorefrontGiftVariantFacts[];
  witnesses: StorefrontRecipientWitness[];
}> {
  if (
    input.variantIds.length < 1 ||
    input.variantIds.length > 64 ||
    new Set(input.variantIds.map((id) => id.toLowerCase())).size !==
      input.variantIds.length
  )
    throw invalid();
  const rows = await draftRows(
    client,
    `SELECT variant.id,item.policy inventory_policy,item.status inventory_status,
   coalesce((SELECT max(balance.on_hand-balance.reserved)::text FROM public.inventory_balances balance
    JOIN public.inventory_locations location ON location.id=balance.location_id AND location.status='ACTIVE'
    WHERE balance.inventory_item_id=item.id),'0') available_quantity,
   coalesce((SELECT jsonb_agg(jsonb_build_object('priceId',price.id,'priceRevision',price.revision,'unitAmountMinor',price.amount_minor))
    ${currentBook} ${priceJoin} WHERE ${leaf} AND h.market=$3 AND h.currency=$4 AND price.gift_variant_id=variant.id),'[]'::jsonb) prices,
   (public.wish_recipient_allowed(variant.id,$5) AND (EXISTS(SELECT 1 FROM public.gift_variant_idol_eligibility eligibility WHERE eligibility.gift_variant_id=variant.id AND eligibility.idol_id=$5)
    OR EXISTS(SELECT 1 FROM public.gift_variant_recipient_rules eligibility
     JOIN public.idols recipient ON recipient.id=$5 AND recipient.status='active' AND recipient.accepting_gifts
     JOIN public.idol_publication_heads recipient_head ON recipient_head.idol_id=recipient.id AND recipient_head.idol_revision_id=recipient.published_revision_id
     WHERE eligibility.gift_variant_id=variant.id AND eligibility.rule='ALL_ACTIVE_ARTISTS'))) eligible_for_selected,
   witness.id witness_id,witness.handle witness_handle
   FROM public.gift_variants variant LEFT JOIN public.inventory_items item ON item.gift_variant_id=variant.id
   LEFT JOIN LATERAL (SELECT idol.id,idol.handle FROM public.idols idol
    JOIN public.idol_publication_heads head ON head.idol_id=idol.id AND head.idol_revision_id=idol.published_revision_id
    JOIN public.content_publications publication ON publication.id=head.publication_id AND publication.content_type='IDOL'
     AND publication.idol_id=idol.id AND publication.idol_revision_id=head.idol_revision_id
    JOIN public.idol_revisions revision ON revision.id=head.idol_revision_id AND revision.idol_id=idol.id
     AND revision.lifecycle=CASE publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
    WHERE idol.status='active' AND idol.accepting_gifts AND public.wish_recipient_allowed(variant.id,idol.id)
     AND (EXISTS(SELECT 1 FROM public.gift_variant_idol_eligibility eligibility WHERE eligibility.gift_variant_id=variant.id AND eligibility.idol_id=idol.id)
      OR EXISTS(SELECT 1 FROM public.gift_variant_recipient_rules eligibility WHERE eligibility.gift_variant_id=variant.id AND eligibility.rule='ALL_ACTIVE_ARTISTS'))
     AND NOT EXISTS(SELECT 1 FROM public.content_publications successor WHERE successor.replaces_publication_id=publication.id)
    ORDER BY idol.id LIMIT 1) witness ON $5::uuid IS NULL
   WHERE variant.gift_id=$1 AND variant.id=ANY($2::uuid[]) AND variant.status IN('active','paused')`,
    [
      input.giftId,
      input.variantIds,
      input.market,
      input.currency,
      input.idolId,
    ],
  );
  if (rows.length !== input.variantIds.length) throw invalid();
  const records = new Map<string, StorefrontGiftVariantFacts>();
  const witnesses: StorefrontRecipientWitness[] = [];
  for (const row of rows) {
    if (
      typeof row["id"] !== "string" ||
      records.has(row["id"].toLowerCase()) ||
      !input.variantIds.some(
        (id) => id.toLowerCase() === String(row["id"]).toLowerCase(),
      ) ||
      !Array.isArray(row["prices"]) ||
      row["prices"].length > 1 ||
      typeof row["available_quantity"] !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(row["available_quantity"])
    )
      throw invalid();
    const parsed = storefrontGiftVariantFactsSchema.safeParse({
      giftVariantId: row["id"],
      price: row["prices"][0] ?? null,
      hasEligibleRecipient: false,
      eligibleForSelectedRecipient: row["eligible_for_selected"],
      inventoryItem:
        row["inventory_policy"] === null && row["inventory_status"] === null
          ? null
          : {
              policy: row["inventory_policy"],
              status: row["inventory_status"],
            },
      maximumLocationAvailableQuantity: Number(row["available_quantity"]),
    });
    if (!parsed.success) throw invalid();
    records.set(parsed.data.giftVariantId.toLowerCase(), parsed.data);
    if (row["witness_id"] !== null || row["witness_handle"] !== null)
      witnesses.push({
        variantId: parsed.data.giftVariantId,
        idolId: idolIdSchema.parse(row["witness_id"]),
        handle: slugSchema.parse(row["witness_handle"]),
      });
  }
  return {
    facts: input.variantIds.map((id) => {
      const row = records.get(id.toLowerCase());
      if (!row) throw invalid();
      return row;
    }),
    witnesses,
  };
}
