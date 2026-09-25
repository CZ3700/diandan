import { createHash } from "node:crypto";
import {
  mediaImageProcessingCommandSchema,
  mediaProcessingSnapshotResponseSchema,
  type MediaImageProcessingCommand,
  type MediaImageProcessingSuccess,
  type MediaProcessingSnapshotResponse,
} from "@fan-support/contracts";
import type { TransactionClient } from "./transaction-runner.js";

export type MediaRow = Readonly<Record<string, unknown>>;
function record(value: unknown): MediaRow {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid media database record");
  return value as MediaRow;
}
export async function mediaRows(
  client: TransactionClient,
  sql: string,
  values: unknown[] = [],
): Promise<MediaRow[]> {
  const result = record(await client.query(sql, values));
  if (!Array.isArray(result["rows"]))
    throw new Error("Invalid media database rows");
  return result["rows"].map(record);
}
export function mediaTimestamp(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string")
    throw new Error("Invalid media timestamp");
  return new Date(value).toISOString();
}
export function mediaSnapshot(row: MediaRow): MediaProcessingSnapshotResponse {
  return mediaProcessingSnapshotResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    value: {
      schemaVersion: 1,
      jobId: row["id"],
      status: row["status"],
      attemptCount: row["attempt_count"],
      outputAssetId: row["output_asset_id"],
      error:
        row["error_code"] === null
          ? null
          : { code: row["error_code"], retryable: row["error_retryable"] },
      nextAttemptAt:
        row["next_attempt_at"] === null
          ? null
          : mediaTimestamp(row["next_attempt_at"]),
    },
  });
}
export async function loadMediaJob(
  client: TransactionClient,
  id: string,
  lock = false,
): Promise<MediaRow | undefined> {
  return (
    await mediaRows(
      client,
      `/* media-processing:read-job */ SELECT * FROM public.media_processing_jobs WHERE id=$1::uuid${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  )[0];
}
export async function loadMediaCommand(
  client: TransactionClient,
  input: Readonly<{
    sourceAssetId: unknown;
    metadataRevisionId: unknown;
    role: unknown;
    fit: unknown;
  }>,
): Promise<MediaImageProcessingCommand | undefined> {
  const row = (
    await mediaRows(
      client,
      `/* media-processing:canonical-source */
    SELECT asset.id,asset.checksum_sha256,asset.object_key,asset.mime_type,asset.byte_size,asset.width,asset.height,
      metadata.id AS metadata_id,metadata.focal_x,metadata.focal_y
    FROM public.media_assets asset JOIN public.media_metadata_revisions metadata ON metadata.media_asset_id=asset.id
    WHERE asset.id=$1::uuid AND metadata.id=$2::uuid AND asset.identity_kind='SOURCE' AND asset.processing_status <> 'ARCHIVED'
      AND asset.rights_status IN ('PENDING','APPROVED') AND metadata.lifecycle <> 'ARCHIVED'
      AND asset.width::bigint*asset.height<=40000000
    FOR SHARE OF asset,metadata`,
      [input.sourceAssetId, input.metadataRevisionId],
    )
  )[0];
  if (row === undefined) return undefined;
  const parsed = mediaImageProcessingCommandSchema.safeParse({
    schemaVersion: 1,
    profileVersion: 1,
    source: {
      assetId: row["id"],
      metadataRevisionId: row["metadata_id"],
      checksumSha256: row["checksum_sha256"],
      objectKey: row["object_key"],
      mimeType: row["mime_type"],
      byteSize: Number(row["byte_size"]),
      width: row["width"],
      height: row["height"],
    },
    role: input.role,
    fit: input.fit,
    focalPoint: { x: Number(row["focal_x"]), y: Number(row["focal_y"]) },
  });
  return parsed.success ? parsed.data : undefined;
}
export function mediaReceiptHash(result: MediaImageProcessingSuccess): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...result,
        variants: [...result.variants].sort(
          (a, b) => a.format.localeCompare(b.format) || a.width - b.width,
        ),
      }),
    )
    .digest("hex");
}
