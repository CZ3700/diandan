import { resolveManagementClaimImageSource } from "./management-image-source.js";
import { randomUUID } from "node:crypto";
import {
  dailyMediaMetadataDocumentSchema,
  mediaFocalPointSchema,
  supportedLocaleSchema,
  type ManagementCenterClaim,
  type ManagementCenterFailure,
} from "@fan-support/contracts";
import { computeDailySourceHash } from "@fan-support/content";
import type { ManagementCenterPublicationRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  insertDailyDocument,
  loadDailyClaim,
} from "./daily-publication-data.js";
import { managementFailure } from "./management-center-operation-data.js";
import type { TransactionClient } from "./transaction-runner.js";

type Input = Parameters<
  ManagementCenterPublicationRepository["prepareMediaMetadata"]
>[0];
async function originalAlt(
  client: TransactionClient,
  claim: ManagementCenterClaim,
) {
  if ("name" in claim.intent)
    return { locale: claim.intent.sourceLocale, alt: claim.intent.name };
  const [daily] = await draftRows(
    client,
    `SELECT d.document#>>'{source,locale}' locale,d.document#>>'{source,fields,heroTitle}' alt FROM public.homepage_publication_heads h JOIN public.daily_publication_revisions d ON d.revision_id=h.homepage_revision_id`,
  );
  if (daily)
    return {
      locale: supportedLocaleSchema.parse(daily["locale"]),
      alt: String(daily["alt"]),
    };
  const [legacy] = await draftRows(
    client,
    `SELECT t.locale,t.hero_title alt FROM public.homepage_publication_heads h JOIN public.homepage_revision_translations t ON t.homepage_revision_id=h.homepage_revision_id JOIN public.homepage_translation_reviews r ON r.homepage_translation_id=t.id AND r.status='APPROVED' WHERE t.locale=$1 ORDER BY r.sequence DESC LIMIT 1`,
    [claim.intent.sourceLocale],
  );
  if (!legacy) throw new Error("Actual homepage source alt unavailable");
  return {
    locale: supportedLocaleSchema.parse(legacy["locale"]),
    alt: String(legacy["alt"]),
  };
}
export async function prepareDailyMediaMetadata(
  client: TransactionClient,
  input: Input,
): Promise<
  | ManagementCenterFailure
  | { schemaVersion: 1; outcome: "SUCCESS"; metadataRevisionId: string }
> {
  const focal = mediaFocalPointSchema.safeParse(input.focalPoint);
  if (!focal.success) return managementFailure("INVALID_COMMAND");
  const claim = await loadDailyClaim(client, input);
  if (!claim) return managementFailure("NEEDS_AUTHORIZATION");
  if (!("image" in claim.intent) || claim.intent.image === null)
    return managementFailure("INVALID_COMMAND");
  let sourceAssetId: string;
  if ("currentImage" in claim.intent.image) {
    const resolved = await resolveManagementClaimImageSource(client, claim);
    if (resolved.outcome === "FAILURE") return resolved;
    sourceAssetId = resolved.source.assetId;
  } else {
    const [source] = await draftRows(
      client,
      `SELECT u.registered_asset_id FROM public.media_upload_reservations u JOIN public.media_assets a ON a.id=u.registered_asset_id WHERE u.id=$1 AND u.actor_id=$2 AND u.status='REGISTERED' AND a.identity_kind='SOURCE' AND a.processing_status<>'ARCHIVED' AND a.rights_status='APPROVED' FOR SHARE OF u,a`,
      [claim.intent.image.uploadId, claim.actorId],
    );
    if (!source) return managementFailure("UPLOAD_NOT_READY");
    sourceAssetId = String(source["registered_asset_id"]);
  }
  if (input.processingJobId === null) {
    if (sourceAssetId !== input.assetId)
      return managementFailure("INVALID_COMMAND");
  } else {
    const checkpoint = claim.checkpoint.jobs.find(
      (row) => row.jobId === input.processingJobId,
    );
    if (!checkpoint) return managementFailure("INVALID_COMMAND");
    const [job] = await draftRows(
      client,
      `SELECT j.id FROM public.media_processing_jobs j JOIN public.media_assets a ON a.id=j.output_asset_id WHERE j.id=$1 AND j.source_asset_id=$2 AND j.output_asset_id=$3 AND j.source_metadata_revision_id=$4 AND j.role=$5 AND j.status='SUCCEEDED' AND a.identity_kind='PROCESSED_MASTER' AND a.processing_status='READY' AND a.rights_status='APPROVED' FOR SHARE OF j,a`,
      [
        input.processingJobId,
        sourceAssetId,
        input.assetId,
        checkpoint.metadataRevisionId,
        checkpoint.role,
      ],
    );
    if (!job) return managementFailure("MEDIA_FAILED");
  }
  const [existing] = await draftRows(
    client,
    `SELECT revision_id FROM public.daily_publication_revisions WHERE operation_id=$1 AND object_kind='MEDIA_METADATA' AND object_id=$2 AND processing_job_id IS NOT DISTINCT FROM $3::uuid AND copied_from_metadata_revision_id IS NULL`,
    [input.operationId, input.assetId, input.processingJobId],
  );
  if (existing)
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      metadataRevisionId: String(existing["revision_id"]),
    };
  await client.query(
    "SELECT id FROM public.media_assets WHERE id=$1 FOR UPDATE",
    [input.assetId],
  );
  const [clock] = await draftRows(
    client,
    `SELECT coalesce(max(revision),0)+1 revision,public.publication_utc(GREATEST(clock_timestamp(),coalesce(max(created_at),clock_timestamp()))) at FROM public.media_metadata_revisions WHERE media_asset_id=$1`,
    [input.assetId],
  );
  if (!clock) throw new Error("Daily metadata clock unavailable");
  const { locale, alt } = await originalAlt(client, claim);
  const fields = { alt };
  const revisionId = randomUUID();
  const at = String(clock["at"]);
  const document = dailyMediaMetadataDocumentSchema.parse({
    schemaVersion: 3,
    kind: "MEDIA_METADATA",
    ownerId: input.assetId,
    revisionId,
    revisionNumber: Number(clock["revision"]),
    createdBy: claim.actorId,
    createdAt: at,
    source: {
      id: randomUUID(),
      locale,
      sourceHash: computeDailySourceHash("MEDIA_METADATA", locale, fields),
      editorId: claim.actorId,
      editedAt: at,
      fields,
    },
    structure: {
      presentationKind: "INFORMATIVE",
      focalPoint: focal.data,
    },
  });
  await insertDailyDocument(client, claim, document, input.processingJobId);
  await client.query(
    `INSERT INTO public.media_metadata_revisions(id,media_asset_id,revision,lifecycle,presentation_kind,focal_x,focal_y,created_by,created_at) VALUES($1,$2,$3,'DRAFT','INFORMATIVE',$6,$7,$4,$5)`,
    [
      revisionId,
      input.assetId,
      document.revisionNumber,
      claim.actorId,
      at,
      focal.data.x,
      focal.data.y,
    ],
  );
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    metadataRevisionId: revisionId,
  };
}
