import {
  STOREFRONT_SEO_LIMITS,
  catalogVersionSchema,
  storefrontSeoCursorPayloadSchema,
  storefrontSeoSnapshotSchema,
  type StorefrontSeoCursorPayload,
  type StorefrontSeoSnapshot,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

// Only compact identities/heads and mutable proof status are enumerated. Content/media hydration is separate.
const candidates = `candidates AS (
 SELECT '0:homepage'::text COLLATE "C" key,jsonb_build_object('kind','HOMEPAGE') locator,
  jsonb_build_array(h.publication_id,h.homepage_revision_id,h.version) state
 FROM public.homepage_publication_heads h
 JOIN public.content_publications p ON p.id=h.publication_id AND p.content_type='HOMEPAGE' AND p.homepage_revision_id=h.homepage_revision_id
 JOIN public.homepage_revisions r ON r.id=h.homepage_revision_id AND r.lifecycle=CASE p.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
 WHERE p.proof_version IN(2,3) AND NOT EXISTS(SELECT 1 FROM public.content_publications s WHERE s.replaces_publication_id=p.id)
 UNION ALL
 SELECT '1:'||b.id::text,jsonb_build_object('kind','IDOL','handle',b.handle),
  jsonb_build_array(h.publication_id,h.idol_revision_id,h.version,b.version,b.status,b.accepting_gifts)
 FROM public.idols b JOIN public.idol_publication_heads h ON h.idol_id=b.id AND h.idol_revision_id=b.published_revision_id
 JOIN public.content_publications p ON p.id=h.publication_id AND p.content_type='IDOL' AND p.idol_id=b.id AND p.idol_revision_id=h.idol_revision_id
 JOIN public.idol_revisions r ON r.id=h.idol_revision_id AND r.idol_id=b.id AND r.lifecycle=CASE p.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
 WHERE b.status IN ('active','paused') AND p.proof_version IN(2,3) AND NOT EXISTS(SELECT 1 FROM public.content_publications s WHERE s.replaces_publication_id=p.id)
 UNION ALL
 SELECT '2:'||b.id::text,jsonb_build_object('kind','GIFT','handle',b.handle),
  jsonb_build_array(h.publication_id,h.gift_revision_id,h.version,b.version,b.status)
 FROM public.gifts b JOIN public.gift_publication_heads h ON h.gift_id=b.id AND h.gift_revision_id=b.published_revision_id
 JOIN public.content_publications p ON p.id=h.publication_id AND p.content_type='GIFT' AND p.gift_id=b.id AND p.gift_revision_id=h.gift_revision_id
 JOIN public.gift_revisions r ON r.id=h.gift_revision_id AND r.gift_id=b.id AND r.lifecycle=CASE p.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
 WHERE b.status IN ('active','paused') AND p.proof_version IN(2,3) AND NOT EXISTS(SELECT 1 FROM public.content_publications s WHERE s.replaces_publication_id=p.id)
 UNION ALL
 SELECT '3:'||h.policy_key,jsonb_build_object('kind','POLICY','policyKey',h.policy_key),
  jsonb_build_array(h.publication_id,h.policy_revision_id,h.version)
 FROM public.policy_publication_heads h
 JOIN public.content_publications p ON p.id=h.publication_id AND p.content_type='POLICY' AND p.policy_key=h.policy_key AND p.policy_revision_id=h.policy_revision_id
 JOIN public.policy_revisions r ON r.id=h.policy_revision_id AND r.policy_key=h.policy_key AND r.lifecycle=CASE p.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
 WHERE p.proof_version=2 AND r.effective_at<=transaction_timestamp() AND NOT EXISTS(SELECT 1 FROM public.content_publications s WHERE s.replaces_publication_id=p.id)
)`;
const version = `version_state AS (
 SELECT encode(sha256(convert_to(jsonb_build_array(
  (SELECT coalesce(jsonb_agg(jsonb_build_array(key,locator,state) ORDER BY key COLLATE "C"),'[]'::jsonb) FROM candidates),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,manifest_hash) ORDER BY id),'[]'::jsonb) FROM public.content_publication_manifests),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(publication_id,manifest_hash) ORDER BY publication_id),'[]'::jsonb) FROM public.daily_publication_manifests),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(revision_id,document_hash) ORDER BY revision_id),'[]'::jsonb) FROM public.daily_publication_revisions),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,processing_status,rights_status) ORDER BY id),'[]'::jsonb) FROM public.media_assets),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,status) ORDER BY id),'[]'::jsonb) FROM public.media_variants),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,lifecycle) ORDER BY id),'[]'::jsonb) FROM public.media_metadata_revisions),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,publication_id,media_metadata_revision_id,version) ORDER BY id),'[]'::jsonb) FROM public.media_metadata_publication_heads),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,status,source_asset_id,output_asset_id) ORDER BY id),'[]'::jsonb) FROM public.media_processing_jobs),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,gift_id,status,version) ORDER BY id),'[]'::jsonb) FROM public.gift_variants)
 )::text,'UTF8')),'hex') catalog_version
)`;

export function storefrontSeoIndexQuery(
  operation: "INDEX" | "CATALOG",
  afterKey: string | null,
) {
  const common = `WITH ${candidates}, ${version}`;
  if (operation === "INDEX")
    return {
      text: `${common}, page_window AS (
     SELECT key,locator FROM candidates WHERE $1::text IS NULL OR key>$1::text COLLATE "C" ORDER BY key COLLATE "C" LIMIT $2
    ) SELECT catalog_version,($1::text IS NULL OR EXISTS(SELECT 1 FROM candidates WHERE key=$1)) cursor_found,
     (SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'locator',locator) ORDER BY key COLLATE "C"),'[]'::jsonb) FROM page_window) entries FROM version_state`,
      values: [afterKey, STOREFRONT_SEO_LIMITS.index + 1],
    };
  return {
    text: `${common}, numbered AS (SELECT key,row_number() OVER(ORDER BY key COLLATE "C") ordinal FROM candidates),
     grouped AS (SELECT (ordinal-1)/${STOREFRONT_SEO_LIMITS.index} bucket,min(key COLLATE "C") first_key,max(key COLLATE "C") last_key,count(*)::integer item_count FROM numbered GROUP BY bucket),
     boundaries AS (SELECT first_key,last_key,item_count,lag(last_key) OVER(ORDER BY first_key COLLATE "C") after_key FROM grouped),
     page_window AS (SELECT * FROM boundaries WHERE $1::text IS NULL OR first_key>$1::text COLLATE "C" ORDER BY first_key COLLATE "C" LIMIT $2)
     SELECT catalog_version,($1::text IS NULL OR EXISTS(SELECT 1 FROM boundaries WHERE first_key=$1)) cursor_found,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('firstKey',first_key,'lastKey',last_key,'afterKey',after_key,'itemCount',item_count) ORDER BY first_key COLLATE "C"),'[]'::jsonb) FROM page_window) entries FROM version_state`,
    values: [afterKey, STOREFRONT_SEO_LIMITS.catalog + 1],
  };
}
export async function readStorefrontSeoSnapshot(
  client: TransactionClient,
  operation: "INDEX" | "CATALOG",
  input: StorefrontSeoCursorPayload | undefined,
): Promise<StorefrontSeoSnapshot> {
  const cursor =
    input === undefined
      ? undefined
      : storefrontSeoCursorPayloadSchema.parse(input);
  if (cursor && cursor.operation !== operation)
    return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_CURSOR" };
  const statement = storefrontSeoIndexQuery(
    operation,
    cursor?.afterKey ?? null,
  );
  const rows = await draftRows(client, statement.text, statement.values);
  if (rows.length !== 1) throw new Error("SEO_INDEX_ROW_UNAVAILABLE");
  const row = rows[0]!;
  const catalogVersion = catalogVersionSchema.parse(row["catalog_version"]);
  if (cursor && cursor.catalogVersion !== catalogVersion)
    return { schemaVersion: 1, outcome: "FAILURE", code: "CATALOG_CHANGED" };
  if (row["cursor_found"] === false)
    return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_CURSOR" };
  const entries = row["entries"];
  const maximum =
    operation === "INDEX"
      ? STOREFRONT_SEO_LIMITS.index
      : STOREFRONT_SEO_LIMITS.catalog;
  if (
    row["cursor_found"] !== true ||
    !Array.isArray(entries) ||
    entries.length > maximum + 1
  )
    throw new Error("SEO_INDEX_ROWS_INVALID");
  return storefrontSeoSnapshotSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    operation,
    catalogVersion,
    [operation === "INDEX" ? "candidates" : "boundaries"]: entries.slice(
      0,
      maximum,
    ),
    hasNextPage: entries.length > maximum,
  });
}
