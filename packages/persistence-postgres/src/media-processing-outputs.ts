import type { MediaImageProcessingSuccess } from "@fan-support/contracts";
import { mediaRows, type MediaRow } from "./media-processing-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export class MediaOutputConflict extends Error {}
function identityMatches(
  row: MediaRow,
  output:
    | MediaImageProcessingSuccess["master"]
    | MediaImageProcessingSuccess["variants"][number],
): boolean {
  return (
    row["checksum_sha256"] === output.checksumSha256 &&
    row["object_key"] === output.objectKey &&
    Number(row["byte_size"]) === output.byteSize &&
    row["width"] === output.width &&
    row["height"] === output.height
  );
}
/** Existing identities and approval states are never overwritten during deduplication. */
export async function persistMediaOutputs(
  client: TransactionClient,
  jobId: string,
  sourceId: string,
  result: MediaImageProcessingSuccess,
): Promise<string> {
  const master = result.master;
  await mediaRows(
    client,
    `/* media-processing:insert-master */
    INSERT INTO public.media_assets (id,identity_kind,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference)
    VALUES (gen_random_uuid(),'PROCESSED_MASTER',$1,'image/png',$2,$3,$4,$5,'READY','PENDING',$6)
    ON CONFLICT DO NOTHING RETURNING id`,
    [
      master.checksumSha256,
      master.width,
      master.height,
      master.byteSize,
      master.objectKey,
      `derived-source:${sourceId}`,
    ],
  );
  const asset = (
    await mediaRows(
      client,
      `/* media-processing:load-master */
    SELECT * FROM public.media_assets WHERE checksum_sha256=$1 AND identity_kind='PROCESSED_MASTER' FOR SHARE`,
      [master.checksumSha256],
    )
  )[0];
  if (
    asset === undefined ||
    !identityMatches(asset, master) ||
    asset["mime_type"] !== "image/png" ||
    asset["processing_status"] !== "READY" ||
    !["PENDING", "APPROVED"].includes(String(asset["rights_status"]))
  )
    throw new MediaOutputConflict("Master identity conflict");
  const assetId = asset["id"];
  if (typeof assetId !== "string")
    throw new MediaOutputConflict("Master identity unavailable");
  await mediaRows(
    client,
    `/* media-processing:record-master */ INSERT INTO public.media_processing_outputs
    (job_id,kind,format,media_asset_id,width,height,byte_size,checksum_sha256,object_key)
    VALUES ($1,'MASTER','PNG',$2,$3,$4,$5,$6,$7) RETURNING job_id`,
    [
      jobId,
      assetId,
      master.width,
      master.height,
      master.byteSize,
      master.checksumSha256,
      master.objectKey,
    ],
  );
  for (const variant of result.variants) {
    await mediaRows(
      client,
      `/* media-processing:insert-variant */
      INSERT INTO public.media_variants (id,media_asset_id,format,width,height,byte_size,checksum_sha256,object_key,status)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,'READY') ON CONFLICT DO NOTHING RETURNING id`,
      [
        assetId,
        variant.format,
        variant.width,
        variant.height,
        variant.byteSize,
        variant.checksumSha256,
        variant.objectKey,
      ],
    );
    const row = (
      await mediaRows(
        client,
        `/* media-processing:load-variant */ SELECT * FROM public.media_variants
      WHERE media_asset_id=$1 AND format=$2 AND width=$3 AND height=$4 FOR SHARE`,
        [assetId, variant.format, variant.width, variant.height],
      )
    )[0];
    if (
      row === undefined ||
      !identityMatches(row, variant) ||
      row["status"] !== "READY"
    )
      throw new MediaOutputConflict("Variant identity conflict");
    await mediaRows(
      client,
      `/* media-processing:record-variant */ INSERT INTO public.media_processing_outputs
      (job_id,kind,format,media_asset_id,media_variant_id,width,height,byte_size,checksum_sha256,object_key)
      VALUES ($1,'VARIANT',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING job_id`,
      [
        jobId,
        variant.format,
        assetId,
        row["id"],
        variant.width,
        variant.height,
        variant.byteSize,
        variant.checksumSha256,
        variant.objectKey,
      ],
    );
  }
  return assetId;
}
