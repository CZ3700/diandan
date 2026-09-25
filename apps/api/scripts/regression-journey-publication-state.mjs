import assert from "node:assert/strict";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";

/** Counts are safe evidence; operation, session and request identifiers stay in PostgreSQL. */
export function assertGiftPublicationAtomicity(evidence) {
  for (const value of Object.values(evidence))
    assert(
      Number.isSafeInteger(value) && value >= 0,
      "Publication evidence is complete",
    );
  for (const field of [
    "operations",
    "headBindings",
    "variants",
    "giftRevisions",
    "priceRevisions",
    "pricePublications",
    "priceReceiptBindings",
    "priceHeads",
    "priceEvents",
  ])
    assert.equal(evidence[field], 1, `Exactly one committed ${field}`);
  assert(evidence.expectedMetadata > 0, "The real upload has prepared media");
  assert.equal(
    evidence.metadataRevisions,
    evidence.expectedMetadata,
    "Media preparation was not duplicated",
  );
  assert.equal(
    evidence.unexpectedRevisions,
    0,
    "No revision exists outside the gift and its exact media checkpoint",
  );
  for (const field of ["revisions", "manifests", "contentPublications"])
    assert.equal(
      evidence[field],
      evidence.expectedMetadata + 1,
      `One gift and its exact prepared media ${field}`,
    );
  assert.equal(
    evidence.invalidContentEventGroups,
    0,
    "Each publication has exactly one event per locale",
  );
  assert.equal(
    evidence.invalidPurgeGroups,
    0,
    "Each publication has exactly one purge job per locale",
  );
  return evidence;
}

/** Resolve the operation from the current gift head, then count only its authoritative effects. */
export async function verifyGiftPublicationAtomicity(pool, giftId) {
  const {
    rows: [evidence],
  } = await pool.query(
    `WITH operation AS (
      SELECT o.* FROM public.gift_publication_heads h
      JOIN public.daily_publication_manifests m ON m.publication_id=h.publication_id
      JOIN public.management_operations o ON o.id=m.operation_id
      WHERE h.gift_id=$1 AND o.target_id=$1 AND o.intent->>'kind'='SAVE_GIFT'
        AND o.status='SUCCEEDED'
    ), all_revisions AS (
      SELECT r.* FROM public.daily_publication_revisions r JOIN operation o ON o.id=r.operation_id
    ), revisions AS (
      SELECT r.* FROM all_revisions r JOIN operation o ON o.id=r.operation_id
      WHERE r.object_kind='GIFT' OR r.revision_id IN (
        SELECT (asset->>'metadataRevisionId')::uuid
        FROM jsonb_array_elements(o.checkpoint#>'{preparedMedia,assets}') asset
      )
    ), source_drafts AS (
      SELECT r.* FROM all_revisions r JOIN operation o ON o.id=r.operation_id
      JOIN public.media_metadata_revisions metadata ON metadata.id=r.revision_id AND metadata.lifecycle='DRAFT'
      WHERE r.object_kind='MEDIA_METADATA' AND r.object_id::text=o.checkpoint->>'sourceAssetId'
        AND r.revision_id IN (SELECT (job->>'metadataRevisionId')::uuid
          FROM jsonb_array_elements(o.checkpoint->'jobs') job)
    ), manifests AS (
      SELECT m.* FROM public.daily_publication_manifests m JOIN operation o ON o.id=m.operation_id
    ), price_revisions AS (
      SELECT r.* FROM public.gift_price_revision_receipts r JOIN operation o
        ON r.request_id=o.request_id AND r.actor_id=o.actor_id AND r.session_id=o.session_id
      WHERE r.reason_code='MANAGEMENT_GIFT_PRICE'
    ), price_publications AS (
      SELECT p.* FROM public.gift_price_publication_receipts p JOIN operation o
        ON p.request_id=o.request_id AND p.actor_id=o.actor_id AND p.session_id=o.session_id
      WHERE p.reason_code='MANAGEMENT_GIFT_PRICE' AND p.action='PUBLISH_PRICE_BOOK'
    ), content_events AS (
      SELECT m.publication_id,count(e.id) events,count(DISTINCT e.locale) locales,
        coalesce(bool_and(e.locale::text=ANY($2::text[])),false) supported
      FROM manifests m LEFT JOIN public.outbox_events e
        ON e.aggregate_id=m.publication_id AND e.event_type='CONTENT_PUBLICATION_CHANGED'
      GROUP BY m.publication_id
    ), purge_jobs AS (
      SELECT m.publication_id,count(j.id) jobs,count(DISTINCT j.locale) locales,
        coalesce(bool_and(j.locale::text=ANY($2::text[])),false) supported
      FROM manifests m LEFT JOIN public.content_purge_jobs j ON j.publication_id=m.publication_id
      GROUP BY m.publication_id
    ) SELECT
      (SELECT count(*)::integer FROM operation) AS operations,
      (SELECT count(*)::integer FROM operation o JOIN public.gift_publication_heads h
        ON h.gift_id=o.target_id AND h.publication_id::text=o.result->>'publicationId'
        AND h.gift_revision_id::text=o.result->>'revisionId'
        JOIN public.gifts g ON g.id=h.gift_id AND g.published_revision_id=h.gift_revision_id
        AND g.status='active' AND g.version=(o.result->>'version')::bigint) AS "headBindings",
      (SELECT count(*)::integer FROM public.gift_variants WHERE gift_id=$1) AS variants,
      (SELECT count(*)::integer FROM revisions WHERE object_kind='GIFT' AND object_id=$1) AS "giftRevisions",
      (SELECT count(DISTINCT asset->>'metadataRevisionId')::integer FROM operation o
        CROSS JOIN LATERAL jsonb_array_elements(o.checkpoint#>'{preparedMedia,assets}') asset) AS "expectedMetadata",
      (SELECT count(*)::integer FROM revisions WHERE object_kind='MEDIA_METADATA') AS "metadataRevisions",
      (SELECT count(*)::integer FROM source_drafts) AS "priorMediaDrafts",
      (SELECT count(*)::integer FROM all_revisions r
        WHERE NOT EXISTS(SELECT 1 FROM revisions selected WHERE selected.revision_id=r.revision_id)
        AND NOT EXISTS(SELECT 1 FROM source_drafts source WHERE source.revision_id=r.revision_id)) AS "unexpectedRevisions",
      (SELECT count(*)::integer FROM revisions) AS revisions,
      (SELECT count(*)::integer FROM manifests) AS manifests,
      (SELECT count(*)::integer FROM public.content_publications p JOIN manifests m ON m.publication_id=p.id) AS "contentPublications",
      (SELECT count(*)::integer FROM price_revisions) AS "priceRevisions",
      (SELECT count(*)::integer FROM price_publications) AS "pricePublications",
      (SELECT count(*)::integer FROM price_revisions r JOIN price_publications p
        ON p.price_book_id=r.price_book_id AND p.revision=r.revision AND p.content_hash=r.content_hash
        JOIN public.gift_variants v ON v.gift_id=$1 AND r.changed_variant_ids=ARRAY[v.id]) AS "priceReceiptBindings",
      (SELECT count(*)::integer FROM public.price_book_publication_heads h JOIN price_publications p
        ON h.publication_id=p.publication_id AND h.price_book_id=p.price_book_id
        AND h.price_book_revision=p.revision AND h.version=p.result_head_version) AS "priceHeads",
      (SELECT count(*)::integer FROM public.outbox_events e JOIN price_publications p
        ON e.primary_subject_id=p.publication_id AND e.aggregate_id=p.price_book_id
        AND e.aggregate_version=p.revision WHERE e.event_type='PRICE_BOOK_PUBLISHED') AS "priceEvents",
      (SELECT count(*)::integer FROM content_events WHERE events<>cardinality($2::text[])
        OR locales<>cardinality($2::text[]) OR NOT supported) AS "invalidContentEventGroups",
      (SELECT count(*)::integer FROM purge_jobs WHERE jobs<>cardinality($2::text[])
        OR locales<>cardinality($2::text[]) OR NOT supported) AS "invalidPurgeGroups"`,
    [giftId, SUPPORTED_LOCALES],
  );
  assert(evidence, "Canonical gift publication evidence exists");
  return assertGiftPublicationAtomicity(evidence);
}
