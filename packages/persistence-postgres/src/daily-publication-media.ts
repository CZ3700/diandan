import {
  dailyMediaMetadataDocumentSchema,
  dailyPublicationCurrentMediaSchema,
  mediaImageProcessingCommandSchema,
  publicationPreflightMediaLineageSchema,
  type DailyPublicationCurrentMedia,
  type DailyPublicationDocument,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { preflightRows } from "./publication-preflight-data.js";
import {
  preflightAsset,
  preflightVariant,
} from "./publication-preflight-mapping.js";
import type { TransactionClient } from "./transaction-runner.js";

export function dailyMediaReferences(document: DailyPublicationDocument) {
  const references =
    document.kind === "MEDIA_METADATA"
      ? [
          {
            mediaAssetId: document.ownerId,
            mediaMetadataRevisionId: document.revisionId,
          },
        ]
      : document.kind === "HOMEPAGE"
        ? document.slots.flatMap((slot) =>
            slot.kind === "HERO_IDOL"
              ? [
                  {
                    mediaAssetId: slot.desktopMediaAssetId,
                    mediaMetadataRevisionId:
                      slot.desktopMediaMetadataRevisionId,
                  },
                  {
                    mediaAssetId: slot.mobileMediaAssetId,
                    mediaMetadataRevisionId: slot.mobileMediaMetadataRevisionId,
                  },
                ]
              : [],
          )
        : document.media;
  return [
    ...new Map(
      references.map((ref) => [
        ref.mediaMetadataRevisionId.toLowerCase(),
        {
          mediaAssetId: ref.mediaAssetId,
          mediaMetadataRevisionId: ref.mediaMetadataRevisionId,
        },
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      a.mediaAssetId.localeCompare(b.mediaAssetId) ||
      a.mediaMetadataRevisionId.localeCompare(b.mediaMetadataRevisionId),
  );
}
/** Locks every recorded source before loading metadata; deduplicated masters retain all original rights checks. */
export async function loadDailyMedia(
  client: TransactionClient,
  document: DailyPublicationDocument,
  publicMediaBaseUrl: string,
): Promise<DailyPublicationCurrentMedia[]> {
  const references = dailyMediaReferences(document);
  const assetIds = [
    ...new Set(references.map((ref) => ref.mediaAssetId)),
  ].sort();
  const jobs = await preflightRows(
    client,
    "media_processing_jobs",
    "r.output_asset_id=ANY($1::uuid[]) ORDER BY r.id",
    [assetIds],
  );
  const allIds = [
    ...new Set([
      ...assetIds,
      ...jobs.map((row) => String(row["source_asset_id"])),
    ]),
  ].sort();
  const assets = await preflightRows(
    client,
    "media_assets",
    "r.id=ANY($1::uuid[]) ORDER BY r.id",
    [allIds],
  );
  const byId = new Map(assets.map((row) => [String(row["id"]), row]));
  const variants = await preflightRows(
    client,
    "media_variants",
    "r.media_asset_id=ANY($1::uuid[]) ORDER BY r.media_asset_id,r.id",
    [assetIds],
  );
  const outputs = await preflightRows(
    client,
    "media_processing_outputs",
    "r.media_asset_id=ANY($1::uuid[]) AND r.kind='MASTER' ORDER BY r.job_id",
    [assetIds],
  );
  const base = new URL(publicMediaBaseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const result = [];
  for (const ref of references) {
    const asset = byId.get(ref.mediaAssetId);
    if (!asset) throw new Error("Daily media asset unavailable");
    const [metadata] = await draftRows(
      client,
      `SELECT d.document,r.lifecycle FROM public.daily_publication_revisions d JOIN public.media_metadata_revisions r ON r.id=d.revision_id AND r.media_asset_id=d.object_id WHERE d.revision_id=$1 AND d.object_kind='MEDIA_METADATA' AND d.object_id=$2 FOR SHARE OF d,r`,
      [ref.mediaMetadataRevisionId, ref.mediaAssetId],
    );
    if (!metadata) throw new Error("Daily original metadata unavailable");
    const lineage = publicationPreflightMediaLineageSchema.parse({
      assetId: ref.mediaAssetId,
      identityKind: asset["identity_kind"],
      processing: jobs
        .filter((job) => job["output_asset_id"] === ref.mediaAssetId)
        .map((job) => {
          const source = byId.get(String(job["source_asset_id"]));
          const output = outputs.find((row) => row["job_id"] === job["id"]);
          if (!source || !output)
            throw new Error("Daily processing receipt unavailable");
          return {
            jobId: job["id"],
            status: job["status"],
            commandHash: job["command_hash"],
            command: mediaImageProcessingCommandSchema.parse({
              schemaVersion: 1,
              profileVersion: job["profile_version"],
              source: {
                assetId: source["id"],
                metadataRevisionId: job["source_metadata_revision_id"],
                checksumSha256: job["source_checksum_sha256"],
                objectKey: source["object_key"],
                mimeType: source["mime_type"],
                byteSize: Number(source["byte_size"]),
                width: source["width"],
                height: source["height"],
              },
              role: job["role"],
              fit: job["fit"],
              focalPoint: {
                x: Number(job["focal_x"]),
                y: Number(job["focal_y"]),
              },
            }),
            sourceAsset: preflightAsset(source),
            sourceIdentityKind: source["identity_kind"],
            outputAssetId: job["output_asset_id"],
            output: {
              mediaAssetId: output["media_asset_id"],
              checksumSha256: output["checksum_sha256"],
              objectKey: output["object_key"],
              width: output["width"],
              height: output["height"],
              byteSize: Number(output["byte_size"]),
            },
          };
        }),
    });
    const choices = variants
      .filter((row) => row["media_asset_id"] === ref.mediaAssetId)
      .map(preflightVariant);
    const selected = choices
      .filter((row) => row.status === "READY")
      .toSorted(
        (a, b) =>
          b.width - a.width ||
          b.height - a.height ||
          (a.format === "WEBP"
            ? -1
            : b.format === "WEBP"
              ? 1
              : a.id.localeCompare(b.id)),
      )[0];
    if (!selected) throw new Error("Daily ready variant unavailable");
    result.push(
      dailyPublicationCurrentMediaSchema.parse({
        metadata: dailyMediaMetadataDocumentSchema.parse(metadata["document"]),
        lifecycle: metadata["lifecycle"],
        asset: preflightAsset(asset),
        variants: choices,
        lineage,
        selectedVariantId: selected.id,
        url: new URL(selected.objectKey, base).href,
      }),
    );
  }
  return result;
}
