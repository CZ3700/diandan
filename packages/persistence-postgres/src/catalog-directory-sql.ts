import type {
  GiftDiscoveryQuery,
  SupportedLocale,
} from "@fan-support/contracts";

type DirectoryQuery = Readonly<{ text: string; values: unknown[] }>;

function aggregateState(query: string): string {
  return `(SELECT coalesce(jsonb_agg(state.value ORDER BY state.value::text), '[]'::jsonb) FROM (${query}) state)`;
}

/** Only compact canonical metadata is hashed in PostgreSQL; no catalog hydration. */
function versionState(includeCommerce: boolean): string {
  const states = [
    aggregateState(
      `SELECT jsonb_build_array(id, handle, status, accepting_gifts, published_revision_id, version) value FROM public.idols`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(idol_id, publication_id, idol_revision_id, version) value FROM public.idol_publication_heads`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id, idol_revision_id, locale, source_hash, translated_from_source_hash) value FROM public.idol_revision_translations`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(idol_translation_id, source_hash, algorithm_version, normalized_name) value FROM public.idol_translation_search_projections`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(alias_set_id,alias_id,content_hash,algorithm_version,normalized_name) value FROM public.idol_alias_search_projections`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id,idol_revision_id,content_hash,alias_count) value FROM public.idol_revision_alias_sets`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id,alias_set_id,sequence,status,reviewed_content_hash) value FROM public.idol_revision_alias_reviews`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id,publication_id,manifest_hash) value FROM public.content_publication_manifests`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(revision_id,document_hash) value FROM public.daily_publication_revisions`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(publication_id,manifest_hash) value FROM public.daily_publication_manifests`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(revision_id,source_translation_id,source_hash,document_hash,algorithm_version,normalized_name) value FROM public.idol_daily_search_projections`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id,source_asset_id,output_asset_id,status) value FROM public.media_processing_jobs`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id, processing_status, rights_status) value FROM public.media_assets`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id, status) value FROM public.media_variants`,
    ),
    aggregateState(
      `SELECT jsonb_build_array(id, lifecycle) value FROM public.media_metadata_revisions`,
    ),
  ];
  if (includeCommerce)
    states.push(
      aggregateState(
        `SELECT jsonb_build_array(id, handle, status, published_revision_id, version) value FROM public.gifts`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(gift_id, publication_id, gift_revision_id, version) value FROM public.gift_publication_heads`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(id, gift_revision_id, locale, source_hash, translated_from_source_hash) value FROM public.gift_revision_translations`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(id, gift_id, status, inventory_policy, version) value FROM public.gift_variants`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(gift_variant_id, idol_id) value FROM public.gift_variant_idol_eligibility`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(gift_variant_id,rule,operation_id) value FROM public.gift_variant_recipient_rules`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(id, market, status, version) value FROM public.markets WHERE market = $2`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(publication_id, price_book_id, price_book_revision, version) value FROM public.price_book_publication_heads WHERE market = $2 AND currency = $3`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(id, revision, lifecycle, valid_from <= transaction_timestamp() AND (valid_until IS NULL OR transaction_timestamp() < valid_until)) value FROM public.price_books WHERE market = $2 AND currency = $3`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(id, status, valid_from <= transaction_timestamp() AND (valid_to IS NULL OR transaction_timestamp() < valid_to)) value FROM public.prices WHERE market = $2 AND currency = $3`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(id, gift_variant_id, policy, status) value FROM public.inventory_items`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(id, status) value FROM public.inventory_locations`,
      ),
      aggregateState(
        `SELECT jsonb_build_array(inventory_item_id, location_id, on_hand, reserved, version) value FROM public.inventory_balances`,
      ),
    );
  return `version_state AS (SELECT encode(sha256(convert_to(jsonb_build_array(${states.join(",\n")})::text, 'UTF8')), 'hex') AS catalog_version)`;
}

const visibleIdols = `public_idol_revisions AS (
  SELECT idol.id,idol.handle,revision.id revision_id,revision.display_order,publication.proof_version
  FROM public.idols idol
  JOIN public.idol_publication_heads head ON head.idol_id = idol.id
    AND head.idol_revision_id = idol.published_revision_id
  JOIN public.content_publications publication ON publication.id = head.publication_id
    AND publication.content_type = 'IDOL' AND publication.idol_id = idol.id
    AND publication.idol_revision_id = head.idol_revision_id
  JOIN public.idol_revisions revision ON revision.id = head.idol_revision_id
    AND revision.idol_id = idol.id
    AND revision.lifecycle = CASE publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
  WHERE idol.status IN ('active', 'paused')
    AND NOT EXISTS (SELECT 1 FROM public.content_publications successor WHERE successor.replaces_publication_id = publication.id)
), visible_idols AS (
  SELECT revision.id,revision.handle,revision.display_order,requested_translation.id translation_id,
    projection.normalized_name,projection.idol_translation_id projection_id
  FROM public_idol_revisions revision
  LEFT JOIN public.idol_revision_translations requested_translation ON requested_translation.idol_revision_id = revision.revision_id AND requested_translation.locale = $1
  LEFT JOIN public.idol_revision_translations translation ON translation.idol_revision_id = revision.revision_id
  LEFT JOIN public.idol_translation_search_projections projection ON projection.idol_translation_id = translation.id
    AND projection.source_hash = translation.source_hash AND projection.algorithm_version = 1
  WHERE revision.proof_version IN(1,2)
  UNION ALL
  SELECT revision.id,revision.handle,revision.display_order,daily.source_translation_id translation_id,
    daily_projection.normalized_name,daily_projection.revision_id projection_id
  FROM public_idol_revisions revision
  LEFT JOIN public.daily_publication_revisions daily ON daily.revision_id = revision.revision_id
    AND daily.object_kind='IDOL' AND daily.object_id=revision.id
  LEFT JOIN public.idol_daily_search_projections daily_projection ON daily_projection.revision_id = daily.revision_id
    AND daily_projection.source_translation_id = daily.source_translation_id
    AND daily_projection.source_hash = daily.document#>>'{source,sourceHash}'
    AND daily_projection.document_hash = daily.document_hash AND daily_projection.algorithm_version=1
  WHERE revision.proof_version=3
  UNION ALL
  SELECT revision.id,revision.handle,revision.display_order,requested_translation.id translation_id,
    alias_projection.normalized_name,alias_projection.alias_set_id projection_id
  FROM public_idol_revisions revision
  JOIN public.idol_revision_alias_sets alias_set ON alias_set.idol_revision_id=revision.revision_id
  JOIN public.idol_revision_aliases alias ON alias.alias_set_id=alias_set.id
  LEFT JOIN public.idol_revision_translations requested_translation ON requested_translation.idol_revision_id=revision.revision_id AND requested_translation.locale = $1
  LEFT JOIN public.idol_revision_alias_reviews alias_review ON alias_review.alias_set_id=alias_set.id
    AND alias_review.sequence=3 AND alias_review.status = 'APPROVED' AND alias_review.reviewed_content_hash = alias_set.content_hash
  LEFT JOIN public.idol_alias_search_projections alias_projection ON alias_projection.alias_set_id=alias_set.id
    AND alias_projection.alias_id=alias.alias_id AND alias_projection.content_hash = alias_set.content_hash
    AND alias_projection.algorithm_version=1 AND alias_review.id IS NOT NULL
  WHERE revision.proof_version=2
)`;

export function buildIdolDirectoryQuery(
  input: Readonly<{
    locale: SupportedLocale;
    searchTerm: string | null;
    take: number;
    anchorId: string | null;
    afterId: string | null;
  }>,
): DirectoryQuery {
  return {
    values: [
      input.locale,
      input.searchTerm,
      input.anchorId,
      input.afterId,
      input.take,
    ],
    text: `WITH ${versionState(false)}, ${visibleIdols},
    ranked AS (
      SELECT id, display_order,
        min(CASE WHEN $2::text IS NULL OR normalized_name = $2 OR handle = $2 THEN 0
             WHEN strpos(normalized_name, $2) = 1 OR strpos(handle, $2) = 1 THEN 1 ELSE 2 END) match_rank
      FROM visible_idols
      WHERE $2::text IS NULL OR strpos(normalized_name, $2) > 0 OR strpos(handle, $2) > 0
      GROUP BY id, display_order
    ), ordered AS (
      SELECT id, row_number() OVER (ORDER BY match_rank, display_order, id) ordinal FROM ranked
    ), window_rows AS (
      SELECT id, ordinal FROM ordered
      WHERE ($3::uuid IS NULL OR ordinal >= (SELECT ordinal FROM ordered WHERE id = $3))
        AND ($4::uuid IS NULL OR ordinal > (SELECT ordinal FROM ordered WHERE id = $4))
      ORDER BY ordinal LIMIT $5
    )
    SELECT version_state.catalog_version,
      NOT EXISTS (SELECT 1 FROM visible_idols WHERE translation_id IS NULL OR projection_id IS NULL) AS projection_complete,
      ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM ordered WHERE id = $3)) AS anchor_found,
      ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM ordered WHERE id = $4)) AS cursor_found,
      coalesce((SELECT jsonb_agg(id::text ORDER BY ordinal) FROM window_rows), '[]'::jsonb) AS ids
    FROM version_state`,
  };
}

const giftOffer = `LEFT JOIN LATERAL (
  SELECT min(price.amount_minor) AS price_minor
  FROM public.gift_variants variant
  LEFT JOIN public.inventory_items item ON item.gift_variant_id = variant.id
  JOIN public.price_book_publication_heads price_head ON price_head.market = $2 AND price_head.currency = $3
  JOIN public.price_book_publications price_publication ON price_publication.id = price_head.publication_id
    AND price_publication.price_book_id = price_head.price_book_id
    AND price_publication.price_book_revision = price_head.price_book_revision
    AND price_publication.market = price_head.market AND price_publication.currency = price_head.currency
  JOIN public.markets market ON market.id = price_head.market_id AND market.market = $2 AND market.status = 'ACTIVE'
  JOIN public.price_books book ON book.id = price_head.price_book_id AND book.revision = price_head.price_book_revision
    AND book.market = $2 AND book.currency = $3
    AND book.lifecycle = CASE price_publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
    AND book.valid_from <= transaction_timestamp() AND (book.valid_until IS NULL OR transaction_timestamp() < book.valid_until)
  JOIN public.prices price ON price.price_book_id = book.id AND price.price_book_revision = book.revision
    AND price.gift_variant_id = variant.id AND price.market = $2 AND price.currency = $3
    AND ((price_publication.action = 'PUBLISH' AND price.status = 'PUBLISHED')
      OR (price_publication.action = 'ROLLBACK' AND price.status IN ('PUBLISHED', 'SUPERSEDED')))
    AND price.valid_from <= transaction_timestamp() AND (price.valid_to IS NULL OR transaction_timestamp() < price.valid_to)
  WHERE variant.gift_id = gift.id AND variant.status = 'active' AND gift.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.price_book_publications successor WHERE successor.replaces_publication_id = price_publication.id)
    AND EXISTS (
      SELECT 1 FROM public.idols recipient
      JOIN public.idol_publication_heads recipient_head ON recipient_head.idol_id = recipient.id
        AND recipient_head.idol_revision_id = recipient.published_revision_id
      WHERE recipient.status = 'active' AND recipient.accepting_gifts
        AND ($4::uuid IS NULL OR recipient.id = $4)
        AND (EXISTS (SELECT 1 FROM public.gift_variant_idol_eligibility eligibility WHERE eligibility.gift_variant_id=variant.id AND eligibility.idol_id=recipient.id)
          OR EXISTS (SELECT 1 FROM public.gift_variant_recipient_rules eligibility WHERE eligibility.gift_variant_id=variant.id AND eligibility.rule='ALL_ACTIVE_ARTISTS'))
    )
    AND (item.id IS NULL OR (item.status = 'ACTIVE' AND item.policy = variant.inventory_policy))
    AND (variant.inventory_policy IN ('PROCURE_ON_DEMAND', 'PREORDER') OR EXISTS (
      SELECT 1 FROM public.inventory_balances balance
      JOIN public.inventory_locations location ON location.id = balance.location_id AND location.status = 'ACTIVE'
      WHERE balance.inventory_item_id = item.id AND balance.on_hand > balance.reserved
    ))
) offer ON true`;

export function buildGiftDirectoryQuery(
  input: Readonly<{
    locale: SupportedLocale;
    market: string;
    currency: string;
    idolId: string | null;
    category: string | null;
    priceMinMinor: number | null;
    priceMaxMinor: number | null;
    availability: GiftDiscoveryQuery["availability"];
    sort: GiftDiscoveryQuery["sort"];
    take: number;
    offset: number;
  }>,
): DirectoryQuery {
  let order: string;
  switch (input.sort) {
    case "RECOMMENDED":
      order = "published_at DESC, id ASC";
      break;
    case "PRICE_ASC":
      order = "price_minor ASC NULLS LAST, id ASC";
      break;
    case "PRICE_DESC":
      order = "price_minor DESC NULLS LAST, id ASC";
      break;
  }
  return {
    values: [
      input.locale,
      input.market,
      input.currency,
      input.idolId,
      input.category,
      input.priceMinMinor,
      input.priceMaxMinor,
      input.availability,
      input.take,
      input.offset,
    ],
    text: `WITH ${versionState(true)}, candidates AS (
      SELECT gift.id, publication.published_at, revision.category, offer.price_minor
      FROM public.gifts gift
      JOIN public.gift_publication_heads head ON head.gift_id = gift.id AND head.gift_revision_id = gift.published_revision_id
      JOIN public.content_publications publication ON publication.id = head.publication_id
        AND publication.content_type = 'GIFT' AND publication.gift_id = gift.id AND publication.gift_revision_id = head.gift_revision_id
      JOIN public.gift_revisions revision ON revision.id = head.gift_revision_id AND revision.gift_id = gift.id
        AND revision.lifecycle = CASE publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
      LEFT JOIN public.gift_revision_translations translation ON publication.proof_version IN(1,2) AND translation.gift_revision_id = revision.id AND translation.locale = $1
      ${giftOffer}
      WHERE gift.status IN ('active', 'paused')
        AND (publication.proof_version=3 OR translation.id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM public.content_publications successor WHERE successor.replaces_publication_id = publication.id)
        AND ($4::uuid IS NULL OR EXISTS (
          SELECT 1 FROM public.gift_variants variant
          WHERE variant.gift_id = gift.id AND variant.status IN ('active', 'paused')
            AND (EXISTS (SELECT 1 FROM public.gift_variant_idol_eligibility eligibility WHERE eligibility.gift_variant_id=variant.id AND eligibility.idol_id=$4)
              OR EXISTS (SELECT 1 FROM public.gift_variant_recipient_rules eligibility
                JOIN public.idols recipient ON recipient.id=$4 AND recipient.status = 'active' AND recipient.accepting_gifts
                JOIN public.idol_publication_heads recipient_head ON recipient_head.idol_id=recipient.id AND recipient_head.idol_revision_id = recipient.published_revision_id
                WHERE eligibility.gift_variant_id=variant.id AND eligibility.rule='ALL_ACTIVE_ARTISTS'))
        ))
    ), filtered AS (
      SELECT * FROM candidates
      WHERE ($5::text IS NULL OR category = $5)
        AND ($6::bigint IS NULL OR price_minor >= $6) AND ($7::bigint IS NULL OR price_minor <= $7)
        AND ($8 = 'ALL' OR ($8 = 'PURCHASABLE' AND price_minor IS NOT NULL) OR ($8 = 'UNAVAILABLE' AND price_minor IS NULL))
    ), window_rows AS (
      SELECT id, price_minor, row_number() OVER (ORDER BY ${order}) AS ordinal
      FROM filtered ORDER BY ${order} LIMIT $9 OFFSET $10
    )
    SELECT version_state.catalog_version, (SELECT count(*)::text FROM filtered) AS total_items,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', id::text, 'priceMinor', price_minor::text) ORDER BY ordinal) FROM window_rows), '[]'::jsonb) AS items
    FROM version_state`,
  };
}
