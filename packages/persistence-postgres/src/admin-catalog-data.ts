import {
  adminCatalogMutationSchema,
  adminCatalogOwnerSchema,
  contentAuthoringTargetSchema,
  contentTimestampSchema,
  DEFAULT_LOCALE,
  mediaObjectKeySchema,
  publicMediaUrlSchema,
  publicMediaViewSchema,
  type AdminCatalogCommand,
  type AdminCatalogOwner,
  type AdminCatalogWriteCommand,
  type AdminContentFailure,
  type ContentAuthoringTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  AUTHORING_TABLES,
  ownerValue,
  pickFields,
} from "./content-authoring-model.js";
import { PREFLIGHT_TABLES } from "./publication-preflight-mapping.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";
import { mediaProvenanceEligibilitySql } from "./resource-media-eligibility-sql.js";
export const catalogFailure = (
  code: AdminContentFailure["code"],
): AdminContentFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export function catalogTarget(
  kind: ContentAuthoringTarget["kind"],
  value: unknown,
): ContentAuthoringTarget {
  return contentAuthoringTargetSchema.parse({
    kind,
    ...(kind === "IDOL"
      ? { idolId: value }
      : kind === "GIFT"
        ? { giftId: value }
        : kind === "POLICY"
          ? { policyKey: value }
          : kind === "MEDIA_METADATA"
            ? { mediaAssetId: value }
            : {}),
  });
}
/** Artist labels respect daily original-language publication; portrait keys stay inside the adapter. */
export function adminOwnerSql(kind: ContentAuthoringTarget["kind"]) {
  const table = AUTHORING_TABLES[kind],
    head = PREFLIGHT_TABLES[kind];
  const owner =
    table.ownerTable === null
      ? "(SELECT NULL::timestamptz AS created_at)"
      : "public." + table.ownerTable;
  const revisionWhere =
    table.ownerColumn === null
      ? "true"
      : `r.${table.ownerColumn}=o.${table.ownerKey}`;
  const label = {
    IDOL: "display_name",
    GIFT: "title",
    HOMEPAGE: "hero_title",
    POLICY: "title",
    MEDIA_METADATA: "alt",
  }[kind];
  const artistLabel =
    kind === "IDOL"
      ? `coalesce(nullif(btrim(t.display_name),''),nullif(btrim(d.document#>>'{source,fields,displayName}'),''),nullif(btrim(fallback.display_name),''))`
      : `t.${label}`;
  return `SELECT to_jsonb(o.*) AS owner,to_jsonb(latest.*) AS latest,to_jsonb(h.*) AS head,${artistLabel} AS label,
 (SELECT coalesce(max(r.revision),0)::text FROM public.${table.revisions} r WHERE ${revisionWhere}) AS authoring_version,
 (SELECT r.id FROM public.${table.revisions} r WHERE ${revisionWhere} AND r.lifecycle IN('DRAFT','VALIDATED') ORDER BY r.revision DESC LIMIT 1) AS editable_revision_id
 ${kind === "MEDIA_METADATA" ? ", (SELECT j.id FROM public.media_processing_jobs j WHERE j.source_asset_id=o.id OR j.output_asset_id=o.id ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS latest_processing_job_id" : ""}
 ${kind === "IDOL" ? ", portrait.object_key AS portrait_object_key" : ""}
 FROM ${owner} o
 LEFT JOIN LATERAL(SELECT * FROM public.${table.revisions} r WHERE ${revisionWhere} ORDER BY r.revision DESC LIMIT 1) latest ON true
 LEFT JOIN public.${head.heads} h ON ${head.owner === null ? "true" : `h.${head.owner}=o.${table.ownerKey}`}
 LEFT JOIN public.${table.translations} t ON t.${table.parent}=latest.id AND t.locale=$1
 ${
   kind === "IDOL"
     ? `LEFT JOIN public.daily_publication_revisions d ON d.revision_id=latest.id AND d.object_kind='IDOL' AND d.object_id=o.id
 LEFT JOIN public.idol_revision_translations fallback ON fallback.idol_revision_id=latest.id AND fallback.locale='${DEFAULT_LOCALE}'
 LEFT JOIN LATERAL(
   SELECT variant.object_key FROM public.idol_revisions published
   JOIN public.content_publications publication ON publication.id=h.publication_id AND publication.content_type='IDOL' AND publication.idol_id=o.id AND publication.idol_revision_id=published.id
   JOIN public.idol_revision_media reference ON reference.idol_revision_id=published.id AND reference.role='PORTRAIT'
   JOIN public.media_assets asset ON asset.id=reference.media_asset_id AND asset.identity_kind='PROCESSED_MASTER' AND asset.processing_status='READY' AND asset.rights_status='APPROVED'
   JOIN public.media_variants variant ON variant.media_asset_id=asset.id AND variant.status='READY'
   WHERE published.id=h.idol_revision_id AND published.id=o.published_revision_id AND published.idol_id=o.id AND o.status IN('active','paused')
   AND ((publication.action='PUBLISH' AND published.lifecycle='PUBLISHED') OR (publication.action='ROLLBACK' AND published.lifecycle='SUPERSEDED'))
   AND ${mediaProvenanceEligibilitySql}
   ORDER BY reference.sort_order,abs(variant.width-960),variant.width,variant.id LIMIT 1
 ) portrait ON true`
     : ""
 }`;
}
function artistImage(row: DraftRow, publicMediaBaseUrl?: string) {
  const key = mediaObjectKeySchema.safeParse(row["portrait_object_key"]);
  const baseValue = publicMediaUrlSchema.safeParse(publicMediaBaseUrl);
  if (
    !key.success ||
    !baseValue.success ||
    typeof row["label"] !== "string" ||
    !row["label"].trim()
  )
    return null;
  const base = new URL(baseValue.data);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const url = new URL(key.data, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    return null;
  const image = publicMediaViewSchema.safeParse({
    url: url.href,
    alt: row["label"],
  });
  return image.success ? image.data : null;
}
export function mapCatalogOwner(
  kind: ContentAuthoringTarget["kind"],
  row: DraftRow,
  locale: SupportedLocale,
  publicMediaBaseUrl?: string,
): AdminCatalogOwner {
  const table = AUTHORING_TABLES[kind],
    h = PREFLIGHT_TABLES[kind];
  const owner = row["owner"] as DraftRow,
    latest = row["latest"] as DraftRow | null,
    head = row["head"] as DraftRow | null;
  const base = kind === "IDOL" || kind === "GIFT";
  return adminCatalogOwnerSchema.parse({
    schemaVersion: 1,
    target: catalogTarget(
      kind,
      table.ownerKey === null ? undefined : owner[table.ownerKey],
    ),
    locale,
    label: row["label"] ?? null,
    status:
      owner["status"] ??
      owner["processing_status"] ??
      latest?.["lifecycle"] ??
      "draft",
    baseVersion: base ? Number(owner["version"]) : null,
    authoringVersion: Number(row["authoring_version"]),
    publicationHeadVersion: Number(head?.["version"] ?? 0),
    latestRevisionId: latest?.["id"] ?? null,
    draftRevisionId: base
      ? owner["draft_revision_id"]
      : (row["editable_revision_id"] ?? null),
    publishedRevisionId: head?.[h.parent] ?? null,
    handle: base ? owner["handle"] : null,
    acceptingGifts: kind === "IDOL" ? owner["accepting_gifts"] : null,
    createdAt: owner["created_at"] ?? latest?.["created_at"] ?? null,
    ...(kind === "IDOL" ? { image: artistImage(row, publicMediaBaseUrl) } : {}),
    ...(kind === "MEDIA_METADATA"
      ? {
          media: {
            width: owner["width"],
            height: owner["height"],
            mimeType: owner["mime_type"],
            processingStatus: owner["processing_status"],
            rightsStatus: owner["rights_status"],
            identityKind: owner["identity_kind"],
            latestProcessingJobId: row["latest_processing_job_id"] ?? null,
          },
        }
      : {}),
  });
}
export async function readCatalogOwner(
  client: TransactionClient,
  target: ContentAuthoringTarget,
  locale: SupportedLocale,
  publicMediaBaseUrl?: string,
) {
  const table = AUTHORING_TABLES[target.kind];
  const rows = await draftRows(
    client,
    `${adminOwnerSql(target.kind)} ${table.ownerKey === null ? "" : "WHERE o." + table.ownerKey + "=$2"}`,
    table.ownerKey === null ? [locale] : [locale, ownerValue(target)],
  );
  return rows[0]
    ? mapCatalogOwner(target.kind, rows[0], locale, publicMediaBaseUrl)
    : undefined;
}
export const lifecycleOf = (row: DraftRow) => ({
  status: row["lifecycle"],
  ...pickFields(row, [
    "validatedAt",
    "publishedAt",
    "supersededAt",
    "archivedAt",
  ]),
});
export async function identityEventTime(
  client: TransactionClient,
  input: AdminCatalogWriteCommand,
  prior: DraftRow | undefined,
) {
  // Current wall-clock checks authorize the operation; only stable transaction
  // time and the necessary, already effective authority/history order its event.
  const [row] = await draftRows(
    client,
    `SELECT gen_random_uuid() AS id,gen_random_uuid() AS audit_id,gen_random_uuid() AS idol_id,gen_random_uuid() AS redirect_id,
 ${utcTimestampSql("GREATEST(transaction_timestamp(),$2::timestamptz,s.created_at,(SELECT min(GREATEST(ar.granted_at,rp.granted_at)) FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=s.admin_identity_id AND p.permission_key='content.edit' AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()),(SELECT max(granted_at) FROM public.admin_content_locale_grants WHERE admin_identity_id=s.admin_identity_id AND revoked_at IS NULL AND granted_at<=clock_timestamp()))")} AS at
 FROM public.admin_sessions s WHERE s.id=$1`,
    [input.principal.sessionId, prior?.["updated_at"] ?? null],
  );
  if (!row) throw new Error("Missing canonical session");
  return {
    id: String(row["id"]),
    auditId: String(row["audit_id"]),
    idolId: String(row["idol_id"]),
    redirectId: String(row["redirect_id"]),
    at: contentTimestampSchema.parse(row["at"]),
  };
}
export async function readIdentityReceipt(
  client: TransactionClient,
  resultId: string,
  actorId: string,
) {
  const [row] = await draftRows(
    client,
    "SELECT * FROM public.admin_idol_identity_receipts WHERE id=$1 AND actor_id=$2",
    [resultId, actorId],
  );
  if (!row) return catalogFailure("NOT_FOUND");
  return adminCatalogMutationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId: row["id"],
    idolId: row["idol_id"],
    baseVersion: Number(row["result_base_version"]),
    authoringVersion: Number(row["authoring_version"]),
    publicationHeadVersion: Number(row["publication_head_version"]),
    handle: row["new_handle"],
    status: row["new_status"],
    acceptingGifts: row["new_accepting_gifts"],
    draftRevisionId: row["draft_revision_id"],
    publishedRevisionId: row["published_revision_id"],
    replayed: false,
  });
}
export type CatalogRead = Extract<
  AdminCatalogCommand,
  { action: "READ_OWNER" | "READ_HISTORY" | "LIST_OWNERS" }
>;
