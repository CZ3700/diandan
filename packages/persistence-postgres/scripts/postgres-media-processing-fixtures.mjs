import { createHash, randomUUID } from "node:crypto";
import {
  mediaProcessingEnqueueCommandSchema,
  mediaImageProcessingSuccessSchema,
  MEDIA_IMAGE_PROFILE,
} from "@fan-support/contracts";
import {
  hashMediaProcessingCommand,
  mediaProcessingObjectKey,
  planMediaFraming,
} from "@fan-support/content";
const hash = (value) => createHash("sha256").update(value).digest("hex");

/** Normal-trigger source registration; callers may supply identities from actual uploaded bytes. */
export async function seedMediaProcessingSource(client, input = {}) {
  const sourceAssetId = input.sourceAssetId ?? randomUUID();
  const metadataRevisionId = input.metadataRevisionId ?? randomUUID();
  const requestedBy = input.requestedBy ?? randomUUID();
  const checksumSha256 = input.checksumSha256 ?? hash(sourceAssetId);
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO public.admin_identities(id,issuer,external_subject_hash,status,mfa_required)
      VALUES($1,'media-processing-fixture',decode($2,'hex'),'ACTIVE',true) ON CONFLICT DO NOTHING`,
      [requestedBy, hash(requestedBy)],
    );
    await client.query(
      `INSERT INTO public.media_assets(id,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'media-processing-fixture')`,
      [
        sourceAssetId,
        checksumSha256,
        input.mimeType ?? "image/jpeg",
        input.width ?? 3000,
        input.height ?? 4000,
        input.byteSize ?? 1024,
        input.objectKey ?? `sources/${checksumSha256}.jpg`,
        input.processingStatus ?? "PENDING",
        input.rightsStatus ?? "PENDING",
      ],
    );
    await client.query(
      `INSERT INTO public.media_metadata_revisions(id,media_asset_id,revision,lifecycle,presentation_kind,focal_x,focal_y,created_by)
      VALUES($1,$2,1,'DRAFT','INFORMATIVE',$3,$4,$5)`,
      [
        metadataRevisionId,
        sourceAssetId,
        input.focalX ?? 0.5,
        input.focalY ?? 0.5,
        requestedBy,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const enqueue = mediaProcessingEnqueueCommandSchema.parse({
    schemaVersion: 1,
    jobId: input.jobId ?? randomUUID(),
    sourceAssetId,
    metadataRevisionId,
    requestedBy,
    reason: "Prepare an image role for editorial review",
    role: input.role ?? "PORTRAIT",
    fit: input.fit ?? "COVER",
  });
  return { sourceAssetId, metadataRevisionId, requestedBy, enqueue };
}

/** Synthetic receipts test database invariants only; TLS S3/image tests supply real decoder receipts. */
export function createMediaProcessingDatabaseReceipt(command, options = {}) {
  const orientation = options.orientation ?? 1;
  const swapped = orientation >= 5;
  const framing = planMediaFraming({
    schemaVersion: 1,
    assetId: command.source.assetId,
    metadataRevisionId: command.source.metadataRevisionId,
    sourceChecksum: command.source.checksumSha256,
    sourceWidth: swapped ? command.source.height : command.source.width,
    sourceHeight: swapped ? command.source.width : command.source.height,
    role: command.role,
    fit: command.fit,
    focalPoint: command.focalPoint,
  });
  if (framing.outcome !== "SUCCESS")
    throw new Error("Synthetic receipt requires qualified source dimensions");
  const key = options.outputIdentity ?? command.source.checksumSha256;
  const artifact = (format, width, height, masterChecksum) => {
    const checksumSha256 = hash(`${key}:${format}:${width}:${height}`);
    return {
      objectKey: mediaProcessingObjectKey(
        checksumSha256,
        format,
        masterChecksum,
      ),
      checksumSha256,
      byteSize: 1024,
      width,
      height,
    };
  };
  const { width, height } = framing.plan.target;
  const master = { ...artifact("PNG", width, height), mimeType: "image/png" };
  return mediaImageProcessingSuccessSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    commandHash: hashMediaProcessingCommand(command),
    profileVersion: 1,
    orientation,
    plan: framing.plan,
    metadataPolicy: "STRIP_ALL_SRGB",
    master,
    variants: MEDIA_IMAGE_PROFILE.formats.flatMap((format) =>
      [...MEDIA_IMAGE_PROFILE.responsiveWidths, width].map((variantWidth) => ({
        ...artifact(
          format,
          variantWidth,
          (variantWidth * height) / width,
          master.checksumSha256,
        ),
        format,
      })),
    ),
  });
}
