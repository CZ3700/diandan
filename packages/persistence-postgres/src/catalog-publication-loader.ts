import {
  CATALOG_DISCOVERY_LIMITS,
  giftDirectoryRecordSchema,
  giftIdSchema,
  idolDirectoryRecordSchema,
  idolIdSchema,
  publicMediaUrlSchema,
  supportedLocaleSchema,
  publishedContentReadCommandSchema,
  type GiftDirectoryRecord,
  type IdolDirectoryRecord,
  type SupportedLocale,
} from "@fan-support/contracts";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
import { projectPublishedContent } from "@fan-support/content";
import { loadPublishedContentContext } from "./published-content-repository.js";
import { mediaProvenanceEligibilitySql } from "./resource-media-eligibility-sql.js";
import {
  catalogRecord,
  catalogRows,
  mapCatalogPublication,
  type CatalogObjectKind,
} from "./catalog-publication-mapper.js";

const TABLES = {
  IDOL: {
    base: "idols",
    revisions: "idol_revisions",
    heads: "idol_publication_heads",
    owner: "idol_id",
    parent: "idol_revision_id",
    translations: "idol_revision_translations",
    reviews: "idol_translation_reviews",
    translation: "idol_translation_id",
    media: "idol_revision_media",
  },
  GIFT: {
    base: "gifts",
    revisions: "gift_revisions",
    heads: "gift_publication_heads",
    owner: "gift_id",
    parent: "gift_revision_id",
    translations: "gift_revision_translations",
    reviews: "gift_translation_reviews",
    translation: "gift_translation_id",
    media: "gift_revision_media",
  },
} as const;

function mainQuery(kind: CatalogObjectKind): string {
  const table = TABLES[kind];
  // Explicit whole rows avoid PostgreSQL resolving aliases such as revision or label as same-named scalar columns.
  const giftFields =
    kind === "GIFT"
      ? `,
    (SELECT coalesce(jsonb_agg(to_jsonb(component.*) ORDER BY component.component_code), '[]'::jsonb) FROM public.gift_revision_contents component WHERE component.gift_revision_id = revision.id) AS contents,
    (SELECT coalesce(jsonb_agg(to_jsonb(variant.*) ORDER BY variant.id), '[]'::jsonb) FROM public.gift_variants variant WHERE variant.gift_id = base.id) AS variants`
      : "";
  const labels =
    kind === "GIFT"
      ? ` || jsonb_build_object('variant_labels', (SELECT coalesce(jsonb_agg(to_jsonb(label.*) ORDER BY label.gift_variant_id), '[]'::jsonb) FROM public.gift_variant_labels label WHERE label.gift_translation_id = translation.id))`
      : "";
  return `SELECT to_jsonb(base.*) AS base, to_jsonb(revision.*) AS revision,
    to_jsonb(publication.*) AS publication,
    (SELECT coalesce(jsonb_agg(to_jsonb(translation.*) || jsonb_build_object('review', to_jsonb(review.*)) ${labels} ORDER BY translation.locale), '[]'::jsonb)
     FROM public.${table.translations} translation
     JOIN public.${table.reviews} review ON review.${table.translation} = translation.id AND review.status = 'APPROVED'
     WHERE translation.${table.parent} = revision.id) AS translations ${giftFields}
    FROM public.${table.base} base
    JOIN public.${table.heads} head ON head.${table.owner} = base.id
    JOIN public.${table.revisions} revision ON revision.id = head.${table.parent} AND revision.${table.owner} = base.id AND revision.id = base.published_revision_id
    JOIN public.content_publications publication ON publication.id = head.publication_id AND publication.${table.owner} = base.id AND publication.${table.parent} = revision.id AND publication.content_type = '${kind}'
    WHERE base.id = ANY($1::uuid[]) AND base.status IN ('active','paused')
      AND ((publication.action = 'PUBLISH' AND revision.lifecycle = 'PUBLISHED') OR (publication.action = 'ROLLBACK' AND revision.lifecycle = 'SUPERSEDED'))`;
}
function mediaQuery(kind: CatalogObjectKind): string {
  const table = TABLES[kind];
  return `SELECT to_jsonb(reference.*) AS reference, to_jsonb(asset.*) AS asset,
    ${mediaProvenanceEligibilitySql} AS provenance_eligible,
    to_jsonb(metadata.*) AS metadata, to_jsonb(variant.*) AS variant,
    (SELECT coalesce(jsonb_agg(to_jsonb(translation.*) || jsonb_build_object('review', to_jsonb(review.*)) ORDER BY translation.locale), '[]'::jsonb)
      FROM public.media_metadata_revision_translations translation
      JOIN public.media_metadata_translation_reviews review ON review.media_metadata_translation_id = translation.id AND review.status = 'APPROVED'
      WHERE translation.media_metadata_revision_id = metadata.id) AS translations
    FROM public.${table.media} reference
    JOIN public.media_assets asset ON asset.id = reference.media_asset_id
    JOIN public.media_metadata_revisions metadata ON metadata.id = reference.media_metadata_revision_id AND metadata.media_asset_id = asset.id
    LEFT JOIN LATERAL (
      SELECT candidate.* FROM public.media_variants candidate
      WHERE candidate.media_asset_id = asset.id AND candidate.status = 'READY'
        AND candidate.width <= asset.width AND candidate.height <= asset.height
        AND (reference.role = 'GALLERY' OR candidate.width::bigint * asset.height = candidate.height::bigint * asset.width)
      ORDER BY candidate.width DESC, candidate.height DESC,
        CASE candidate.format WHEN 'WEBP' THEN 0 WHEN 'AVIF' THEN 1 ELSE 2 END, candidate.id
      LIMIT 1
    ) variant ON true
    WHERE reference.${table.parent} = ANY($1::uuid[])
    ORDER BY reference.${table.parent}, reference.role, reference.sort_order`;
}

function normalizedInput(
  kind: CatalogObjectKind,
  ids: readonly string[],
  locale: SupportedLocale,
  baseInput: string,
) {
  supportedLocaleSchema.parse(locale);
  const idSchema = kind === "IDOL" ? idolIdSchema : giftIdSchema;
  const maximum =
    kind === "IDOL"
      ? CATALOG_DISCOVERY_LIMITS.artistWindowMaximum
      : CATALOG_DISCOVERY_LIMITS.giftPageMaximum;
  const canonicalIds = ids.map((id) => idSchema.parse(id).toLowerCase());
  const base = new URL(publicMediaUrlSchema.parse(baseInput));
  if (
    ids.length > maximum ||
    new Set(canonicalIds).size !== ids.length ||
    base.search !== "" ||
    base.hash !== ""
  )
    throw new Error("CATALOG_PUBLICATION_INVALID");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return { ids: canonicalIds, baseUrl: base.href };
}

/** The caller owns the SERIALIZABLE snapshot covering discovery and hydration. */
async function loadRecords(
  client: Pick<TransactionClient, "query">,
  inputIds: readonly string[],
  locale: SupportedLocale,
  publicMediaBaseUrl: string,
  kind: CatalogObjectKind,
  scope?: TransactionScopeControl,
) {
  const { ids, baseUrl } = normalizedInput(
    kind,
    inputIds,
    locale,
    publicMediaBaseUrl,
  );
  if (ids.length === 0) return [];
  const rows = catalogRows(
    catalogRecord(await client.query(mainQuery(kind), [ids]))["rows"],
  );
  const byId = new Map(
    rows.map((row) => [
      String(catalogRecord(row["base"])["id"]).toLowerCase(),
      row,
    ]),
  );
  if (
    rows.length !== ids.length ||
    byId.size !== ids.length ||
    ids.some((id) => !byId.has(id))
  )
    throw new Error("CATALOG_PUBLICATION_INVALID");
  const revisionIds = ids.map(
    (id) => catalogRecord(byId.get(id)!["revision"])["id"],
  );
  const mediaRows = catalogRows(
    catalogRecord(await client.query(mediaQuery(kind), [revisionIds]))["rows"],
  );
  const parent = TABLES[kind].parent;
  if (
    mediaRows.some(
      (row) => !revisionIds.includes(catalogRecord(row["reference"])[parent]),
    )
  )
    throw new Error("CATALOG_PUBLICATION_INVALID");
  if (mediaRows.some((row) => row["provenance_eligible"] !== true))
    throw new Error("CATALOG_PUBLICATION_INVALID");
  const dailyRecords = new Map<
    string,
    Extract<IdolDirectoryRecord | GiftDirectoryRecord, { schemaVersion: 3 }>
  >();
  // Only explicitly migrated legacy events use the old decoder. New events are
  // verified with their complete persisted proof before projecting the v1 list subset.
  for (const id of ids) {
    const row = byId.get(id)!,
      publication = catalogRecord(row["publication"]);
    if (publication["proof_version"] === 1) continue;
    if (
      (publication["proof_version"] !== 2 &&
        publication["proof_version"] !== 3) ||
      scope === undefined
    )
      throw new Error("CATALOG_PUBLICATION_INVALID");
    const command = publishedContentReadCommandSchema.parse({
      schemaVersion: 1,
      locator: { kind, handle: catalogRecord(row["base"])["handle"] },
      locale,
    });
    const loaded = await loadPublishedContentContext(
      client as TransactionClient,
      scope,
      command,
      baseUrl,
    );
    if (
      loaded.outcome !== "SUCCESS" ||
      loaded.context.publication.publicationId !== publication["id"] ||
      projectPublishedContent(loaded.context).outcome !== "SUCCESS"
    )
      throw new Error("CATALOG_PUBLICATION_INVALID");
    if (publication["proof_version"] === 3) {
      if (
        loaded.context.schemaVersion !== 3 ||
        loaded.context.current.document.kind !== kind ||
        loaded.context.current.document.ownerId.toLowerCase() !== id ||
        loaded.context.current.document.revisionId !==
          catalogRecord(row["revision"])["id"] ||
        loaded.context.current.handle !== catalogRecord(row["base"])["handle"]
      )
        throw new Error("CATALOG_PUBLICATION_INVALID");
      dailyRecords.set(id, { schemaVersion: 3, context: loaded.context });
    } else if (loaded.context.schemaVersion === 3)
      throw new Error("CATALOG_PUBLICATION_INVALID");
  }
  return ids.map((id) => {
    const daily = dailyRecords.get(id);
    if (daily) return daily;
    const row = byId.get(id)!;
    const revisionId = catalogRecord(row["revision"])["id"];
    return mapCatalogPublication(
      row,
      mediaRows.filter(
        (media) => catalogRecord(media["reference"])[parent] === revisionId,
      ),
      kind,
      locale,
      baseUrl,
    );
  });
}
export async function loadIdolDirectoryRecords(
  client: Pick<TransactionClient, "query">,
  ids: readonly string[],
  locale: SupportedLocale,
  publicMediaBaseUrl: string,
  scope?: TransactionScopeControl,
): Promise<IdolDirectoryRecord[]> {
  return (
    await loadRecords(client, ids, locale, publicMediaBaseUrl, "IDOL", scope)
  ).map((record) => idolDirectoryRecordSchema.parse(record));
}
export async function loadGiftDirectoryRecords(
  client: Pick<TransactionClient, "query">,
  ids: readonly string[],
  locale: SupportedLocale,
  publicMediaBaseUrl: string,
  scope?: TransactionScopeControl,
): Promise<GiftDirectoryRecord[]> {
  return (
    await loadRecords(client, ids, locale, publicMediaBaseUrl, "GIFT", scope)
  ).map((record) => giftDirectoryRecordSchema.parse(record));
}
