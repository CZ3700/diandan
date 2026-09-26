import type { GiftBrowseQuery } from "@fan-support/contracts";
import {
  publishedGiftKindColumn,
  publishedGiftKindJoins,
} from "./published-gift-kind.js";

/** Compact publication metadata only: prices, markets and stock never affect browsing. */
function versionState(): string {
  const states = [
    "SELECT jsonb_build_array(id,handle,status,published_revision_id,version) value FROM public.gifts",
    "SELECT jsonb_build_array(gift_id,publication_id,gift_revision_id,version) value FROM public.gift_publication_heads",
    "SELECT jsonb_build_array(id,gift_revision_id,locale,source_hash,translated_from_source_hash) value FROM public.gift_revision_translations",
    "SELECT jsonb_build_array(id,gift_translation_id,status,reviewed_content_hash,reviewed_source_hash) value FROM public.gift_translation_reviews",
    "SELECT jsonb_build_array(id,gift_id,status,version) value FROM public.gift_variants",
    "SELECT jsonb_build_array(gift_variant_id,idol_id) value FROM public.gift_variant_idol_eligibility",
    "SELECT jsonb_build_array(gift_variant_id,rule,operation_id) value FROM public.gift_variant_recipient_rules",
    "SELECT jsonb_build_array(id,status,accepting_gifts,published_revision_id,version) value FROM public.idols",
    "SELECT jsonb_build_array(idol_id,publication_id,idol_revision_id,version) value FROM public.idol_publication_heads",
    "SELECT jsonb_build_array(id,content_type,action,replaces_publication_id,proof_version) value FROM public.content_publications",
    "SELECT jsonb_build_array(id,publication_id,manifest_hash) value FROM public.content_publication_manifests",
    "SELECT jsonb_build_array(revision_id,document_hash) value FROM public.daily_publication_revisions",
    "SELECT jsonb_build_array(publication_id,manifest_hash) value FROM public.daily_publication_manifests",
    "SELECT jsonb_build_array(id,source_asset_id,output_asset_id,status) value FROM public.media_processing_jobs",
    "SELECT jsonb_build_array(id,processing_status,rights_status) value FROM public.media_assets",
    "SELECT jsonb_build_array(id,status) value FROM public.media_variants",
    "SELECT jsonb_build_array(id,lifecycle) value FROM public.media_metadata_revisions",
    "SELECT jsonb_build_array(id,media_metadata_revision_id,locale,source_hash,translated_from_source_hash) value FROM public.media_metadata_revision_translations",
    "SELECT jsonb_build_array(id,media_metadata_translation_id,status,reviewed_content_hash,reviewed_source_hash) value FROM public.media_metadata_translation_reviews",
  ];
  const aggregates = states.map(
    (statement) =>
      `(SELECT coalesce(jsonb_agg(state.value ORDER BY state.value::text),'[]'::jsonb) FROM (${statement}) state)`,
  );
  return `version_state AS (SELECT encode(sha256(convert_to(jsonb_build_array(${aggregates.join(",")})::text,'UTF8')),'hex') catalog_version)`;
}

export function buildGiftBrowseQuery(
  input: GiftBrowseQuery,
): Readonly<{ text: string; values: unknown[] }> {
  return {
    values: [
      input.locale,
      input.category ?? null,
      input.idolId ?? null,
      input.pageSize,
      (input.page - 1) * input.pageSize,
      input.kind ?? null,
    ],
    text: `WITH ${versionState()}, published AS (
      SELECT gift.id, publication.published_at, ${publishedGiftKindColumn}
      FROM public.gifts gift
      JOIN public.gift_publication_heads head ON head.gift_id = gift.id
        AND head.gift_revision_id = gift.published_revision_id
      JOIN public.content_publications publication ON publication.id = head.publication_id
        AND publication.content_type = 'GIFT' AND publication.gift_id = gift.id
        AND publication.gift_revision_id = head.gift_revision_id
      JOIN public.gift_revisions revision ON revision.id = head.gift_revision_id
        AND revision.gift_id = gift.id
        AND revision.lifecycle = CASE publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
      ${publishedGiftKindJoins}
      WHERE gift.status IN ('active','paused')
        AND NOT EXISTS (SELECT 1 FROM public.content_publications successor WHERE successor.replaces_publication_id = publication.id)
        AND (publication.proof_version IN (2,3) OR (publication.proof_version = 1 AND EXISTS (
          SELECT 1 FROM public.gift_revision_translations translation
          WHERE translation.gift_revision_id = revision.id AND translation.locale = $1::text)))
        AND ($2::text IS NULL OR revision.category = $2::text)
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM public.gift_variants variant
          WHERE variant.gift_id = gift.id AND variant.status IN ('active','paused')
            AND (EXISTS (SELECT 1 FROM public.gift_variant_idol_eligibility eligibility
              WHERE eligibility.gift_variant_id = variant.id AND eligibility.idol_id = $3::uuid)
            OR EXISTS (SELECT 1 FROM public.gift_variant_recipient_rules rule
              JOIN public.idols recipient ON recipient.id = $3::uuid AND recipient.status = 'active' AND recipient.accepting_gifts
              JOIN public.idol_publication_heads recipient_head ON recipient_head.idol_id = recipient.id
                AND recipient_head.idol_revision_id = recipient.published_revision_id
              JOIN public.content_publications recipient_publication ON recipient_publication.id = recipient_head.publication_id
                AND recipient_publication.content_type = 'IDOL' AND recipient_publication.idol_id = recipient.id
                AND recipient_publication.idol_revision_id = recipient_head.idol_revision_id
              JOIN public.idol_revisions recipient_revision ON recipient_revision.id = recipient_head.idol_revision_id
                AND recipient_revision.idol_id = recipient.id
                AND recipient_revision.lifecycle = CASE recipient_publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
              WHERE rule.gift_variant_id = variant.id AND rule.rule = 'ALL_ACTIVE_ARTISTS'
                AND NOT EXISTS (SELECT 1 FROM public.content_publications successor WHERE successor.replaces_publication_id = recipient_publication.id)))
        ))
    ), visible AS (
      SELECT * FROM published WHERE ($6::text IS NULL OR gift_kind = $6::text)
    ), page_window AS (
      SELECT id,published_at,gift_kind FROM visible ORDER BY published_at DESC, id ASC LIMIT $4::integer OFFSET $5::integer
    )
    SELECT version_state.catalog_version,(SELECT count(*)::text FROM visible) total_items,
      (SELECT coalesce(jsonb_agg(jsonb_build_array(id, gift_kind) ORDER BY published_at DESC,id ASC),'[]'::jsonb) FROM page_window) ids
    FROM version_state`,
  };
}
