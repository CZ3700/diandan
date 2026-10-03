import {
  managementImageSourceSchema,
  managementImageTargetSchema,
  mediaImageProcessingCommandSchema,
  type ManagementCenterClaim,
  type ManagementCenterFailure,
  type ManagementImageSource,
  type ManagementImageTarget,
} from "@fan-support/contracts";
import { hashMediaProcessingCommand } from "@fan-support/content";
import { draftRows } from "./content-draft-data.js";
import { managementFailure } from "./management-center-operation-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export function managementClaimImageTarget(
  claim: ManagementCenterClaim,
): ManagementImageTarget | null {
  const intent = claim.intent;
  if (
    intent.kind === "RESTORE_POSTER" ||
    !intent.image ||
    !("currentImage" in intent.image)
  )
    return null;
  const id =
    intent.kind === "REPLACE_POSTER" ? claim.operation.targetId : intent.id;
  if (!id) return null;
  return managementImageTargetSchema.parse({
    kind:
      intent.kind === "SAVE_ARTIST"
        ? "ARTIST"
        : intent.kind === "SAVE_GIFT"
          ? "GIFT"
          : "POSTER",
    id,
    expectedVersion: intent.expectedVersion,
  });
}
/** Resolves only the exact current reference, never an arbitrary processing job sharing its pixels. */
export async function readManagementImageSource(
  client: TransactionClient,
  input: ManagementImageTarget,
): Promise<ManagementImageSource | ManagementCenterFailure> {
  const target = managementImageTargetSchema.parse(input);
  let reference: Record<string, unknown> | undefined;
  const role =
    target.kind === "ARTIST"
      ? "PORTRAIT"
      : target.kind === "GIFT"
        ? "GIFT_PRIMARY"
        : "HERO_DESKTOP";
  if (target.kind === "POSTER") {
    const [head] = await draftRows(
      client,
      "SELECT homepage_revision_id,version FROM public.homepage_publication_heads FOR SHARE",
    );
    if (
      !head ||
      head["homepage_revision_id"] !== target.id ||
      Number(head["version"]) !== target.expectedVersion
    )
      return managementFailure("TARGET_CONFLICT");
    [reference] = await draftRows(
      client,
      "SELECT desktop_media_asset_id media_asset_id,desktop_media_metadata_revision_id media_metadata_revision_id FROM public.homepage_slots WHERE homepage_revision_id=$1 AND kind='HERO_IDOL' ORDER BY sort_order LIMIT 1 FOR SHARE",
      [target.id],
    );
  } else {
    const table = target.kind === "ARTIST" ? "idols" : "gifts",
      kind = target.kind === "ARTIST" ? "idol" : "gift";
    const [row] = await draftRows(
      client,
      `SELECT id,version,status,published_revision_id FROM public.${table} WHERE id=$1 FOR SHARE`,
      [target.id],
    );
    if (
      !row ||
      Number(row["version"]) !== target.expectedVersion ||
      row["status"] === "archived"
    )
      return managementFailure("TARGET_CONFLICT");
    [reference] = await draftRows(
      client,
      `SELECT media_asset_id,media_metadata_revision_id FROM public.${kind}_revision_media WHERE ${kind}_revision_id=$1 AND role=$2 ORDER BY sort_order LIMIT 1 FOR SHARE`,
      [
        row["published_revision_id"],
        target.kind === "ARTIST" ? "PORTRAIT" : "PRIMARY",
      ],
    );
  }
  if (!reference) return managementFailure("REUPLOAD_REQUIRED");
  const currentImage = {
    assetId: String(reference["media_asset_id"]),
    metadataRevisionId: String(reference["media_metadata_revision_id"]),
  };
  let metadataId = currentImage.metadataRevisionId;
  const seen = new Set<string>();
  let jobId: string | undefined;
  // Copies form immutable ancestry. Bound traversal and reject cycles rather than guessing provenance.
  while (seen.size < 256 && !seen.has(metadataId)) {
    seen.add(metadataId);
    const [metadata] = await draftRows(
      client,
      `SELECT d.processing_job_id,d.copied_from_metadata_revision_id FROM public.daily_publication_revisions d JOIN public.media_metadata_revisions m ON m.id=d.revision_id AND m.media_asset_id=d.object_id WHERE d.revision_id=$1 AND d.object_id=$2 AND d.object_kind='MEDIA_METADATA' AND m.lifecycle IN('PUBLISHED','SUPERSEDED') AND EXISTS(SELECT 1 FROM public.content_publications p WHERE p.media_metadata_revision_id=m.id AND p.media_asset_id=m.media_asset_id AND p.proof_version=3) FOR SHARE OF d,m`,
      [metadataId, currentImage.assetId],
    );
    if (!metadata) break;
    if (typeof metadata["processing_job_id"] === "string") {
      jobId = metadata["processing_job_id"];
      break;
    }
    if (typeof metadata["copied_from_metadata_revision_id"] !== "string") break;
    metadataId = metadata["copied_from_metadata_revision_id"];
  }
  if (!jobId) return managementFailure("REUPLOAD_REQUIRED");
  const [job] = await draftRows(
    client,
    `SELECT j.*,s.object_key source_object_key,s.mime_type source_mime_type,s.byte_size source_byte_size,s.width source_width,s.height source_height,s.checksum_sha256 actual_source_checksum,m.focal_x metadata_focal_x,m.focal_y metadata_focal_y
 FROM public.media_processing_jobs j JOIN public.media_assets s ON s.id=j.source_asset_id JOIN public.media_metadata_revisions m ON m.id=j.source_metadata_revision_id AND m.media_asset_id=s.id
 JOIN public.media_assets a ON a.id=j.output_asset_id JOIN public.media_processing_outputs o ON o.job_id=j.id AND o.kind='MASTER' AND o.media_asset_id=a.id AND o.checksum_sha256=a.checksum_sha256 AND o.object_key=a.object_key AND o.width=a.width AND o.height=a.height AND o.byte_size=a.byte_size
 WHERE j.id=$1 AND j.output_asset_id=$2 AND j.role=$3 AND j.status='SUCCEEDED' AND j.fit='COVER_ALLOW_ENLARGE' AND s.identity_kind='SOURCE' AND s.processing_status<>'ARCHIVED' AND s.rights_status='APPROVED' AND m.lifecycle<>'ARCHIVED' AND a.identity_kind='PROCESSED_MASTER' AND a.processing_status='READY' AND a.rights_status='APPROVED' FOR SHARE OF j,s,m,a,o`,
    [jobId, currentImage.assetId, role],
  );
  if (
    !job ||
    job["source_checksum_sha256"] !== job["actual_source_checksum"] ||
    Number(job["metadata_focal_x"]) !== Number(job["focal_x"]) ||
    Number(job["metadata_focal_y"]) !== Number(job["focal_y"])
  )
    return managementFailure("REUPLOAD_REQUIRED");
  const command = mediaImageProcessingCommandSchema.safeParse({
    schemaVersion: 1,
    profileVersion: job["profile_version"],
    source: {
      assetId: job["source_asset_id"],
      metadataRevisionId: job["source_metadata_revision_id"],
      checksumSha256: job["source_checksum_sha256"],
      objectKey: job["source_object_key"],
      mimeType: job["source_mime_type"],
      byteSize: Number(job["source_byte_size"]),
      width: job["source_width"],
      height: job["source_height"],
    },
    role: job["role"],
    fit: job["fit"],
    focalPoint: { x: Number(job["focal_x"]), y: Number(job["focal_y"]) },
  });
  if (
    !command.success ||
    hashMediaProcessingCommand(command.data) !== job["command_hash"]
  )
    return managementFailure("REUPLOAD_REQUIRED");
  const result = managementImageSourceSchema.safeParse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    target,
    currentImage,
    focalPoint: command.data.focalPoint,
    source: command.data.source,
    orientation: job["orientation"],
  });
  return result.success ? result.data : managementFailure("REUPLOAD_REQUIRED");
}

/** A reused image is a target-bound compare-and-swap hint, never source authority supplied by the caller. */
export async function resolveManagementClaimImageSource(
  client: TransactionClient,
  claim: ManagementCenterClaim,
): Promise<ManagementImageSource | ManagementCenterFailure> {
  const target = managementClaimImageTarget(claim);
  if (
    !target ||
    !("image" in claim.intent) ||
    !claim.intent.image ||
    !("currentImage" in claim.intent.image)
  )
    return managementFailure("INVALID_COMMAND");
  const resolved = await readManagementImageSource(client, target);
  if (resolved.outcome === "FAILURE") return resolved;
  const ref = claim.intent.image.currentImage;
  if (
    resolved.currentImage.assetId !== ref.assetId ||
    resolved.currentImage.metadataRevisionId !== ref.metadataRevisionId ||
    (claim.checkpoint.sourceAssetId !== null &&
      claim.checkpoint.sourceAssetId !== resolved.source.assetId)
  )
    return managementFailure("TARGET_CONFLICT");
  return resolved;
}
