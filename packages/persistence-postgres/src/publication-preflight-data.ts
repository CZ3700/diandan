import {
  type ContentAuthoringSnapshot,
  type ContentAuthoringTarget,
  mediaImageProcessingCommandSchema,
  publicationPreflightMediaLineageSchema,
  contentTimestampSchema,
  sourceHashSchema,
} from "@fan-support/contracts";
import { computeContentAuthoringSnapshotHash } from "@fan-support/content";
import {
  authoringHeadVersion,
  loadAuthoringSnapshot,
} from "./content-authoring-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  preflightAsset,
  preflightVariant,
} from "./publication-preflight-mapping.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Only fixed internal table/predicate identifiers are passed here. Whole-row JSON retains UTC microseconds. */
export async function preflightRows(
  client: TransactionClient,
  table: string,
  predicate: string,
  values: unknown[] = [],
  lock = true,
): Promise<DraftRow[]> {
  return (
    await draftRows(
      client,
      `SELECT to_jsonb(r.*) AS value FROM public.${table} r WHERE ${predicate}${lock ? " FOR SHARE" : ""}`,
      values,
    )
  ).map((row) => row["value"] as DraftRow);
}
export async function preflightSnapshot(
  client: TransactionClient,
  target: ContentAuthoringTarget,
  id: string,
) {
  const snapshot = await loadAuthoringSnapshot(
    client,
    target,
    id,
    await authoringHeadVersion(client, target),
  );
  if (!snapshot) return undefined;
  // The older draft DTO loader uses JavaScript Date. Restore the exact PostgreSQL
  // instants for this evidence boundary, without changing older draft contracts.
  const timestamp = (column: string) =>
    `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  if (snapshot.extensions.aliases) {
    const [row] = await draftRows(
      client,
      `SELECT ${timestamp("s.edited_at")} AS edited_at,${timestamp("r.submitted_at")} AS submitted_at,${timestamp("r.reviewed_at")} AS reviewed_at
      FROM public.idol_revision_alias_sets s JOIN LATERAL(SELECT * FROM public.idol_revision_alias_reviews WHERE alias_set_id=s.id ORDER BY sequence DESC LIMIT 1) r ON true WHERE s.id=$1`,
      [snapshot.extensions.aliases.id],
    );
    if (!row) throw new Error("Missing exact alias time");
    snapshot.extensions.aliases.editedAt = contentTimestampSchema.parse(
      row["edited_at"],
    );
    const review = snapshot.extensions.aliases.review;
    if (review.status === "APPROVED")
      review.reviewedAt = contentTimestampSchema.parse(row["reviewed_at"]);
    else if (review.status === "IN_REVIEW")
      review.submittedAt = contentTimestampSchema.parse(row["submitted_at"]);
  }
  if (snapshot.extensions.details) {
    const rows = await draftRows(
      client,
      `SELECT t.id,${timestamp("t.edited_at")} AS edited_at,${timestamp("r.submitted_at")} AS submitted_at,${timestamp("r.reviewed_at")} AS reviewed_at
      FROM public.gift_detail_translations t JOIN LATERAL(SELECT * FROM public.gift_detail_translation_reviews WHERE gift_detail_translation_id=t.id ORDER BY sequence DESC LIMIT 1) r ON true WHERE t.document_id=$1`,
      [snapshot.extensions.details.document.id],
    );
    for (const translation of snapshot.extensions.details.translations) {
      const row = rows.find((entry) => entry["id"] === translation.id);
      if (!row) throw new Error("Missing exact detail time");
      translation.editedAt = contentTimestampSchema.parse(row["edited_at"]);
      if (translation.review.status === "APPROVED")
        translation.review.reviewedAt = contentTimestampSchema.parse(
          row["reviewed_at"],
        );
      else if (translation.review.status === "IN_REVIEW")
        translation.review.submittedAt = contentTimestampSchema.parse(
          row["submitted_at"],
        );
    }
  }
  snapshot.contentHash = sourceHashSchema.parse(
    computeContentAuthoringSnapshotHash(snapshot),
  );
  return snapshot;
}

export function preflightMediaReferences(snapshot: ContentAuthoringSnapshot) {
  const references: {
    mediaAssetId: string;
    mediaMetadataRevisionId: string;
  }[] = [];
  switch (snapshot.content.kind) {
    case "IDOL":
    case "GIFT":
      references.push(...snapshot.content.media);
      break;
    case "HOMEPAGE":
      for (const slot of snapshot.content.structure.slots)
        if (slot.kind === "HERO_IDOL")
          references.push(
            {
              mediaAssetId: slot.desktopMediaAssetId,
              mediaMetadataRevisionId: slot.desktopMediaMetadataRevisionId,
            },
            {
              mediaAssetId: slot.mobileMediaAssetId,
              mediaMetadataRevisionId: slot.mobileMediaMetadataRevisionId,
            },
          );
      break;
    case "MEDIA_METADATA":
      if (snapshot.target.kind === "MEDIA_METADATA")
        references.push({
          mediaAssetId: snapshot.target.mediaAssetId,
          mediaMetadataRevisionId: snapshot.revisionId,
        });
      break;
    case "POLICY":
      break;
  }
  if (snapshot.extensions.details)
    for (const block of snapshot.extensions.details.document.blocks)
      if (block.kind === "MEDIA") references.push(block);
  return [
    ...new Map(
      references.map((entry) => [
        `${entry.mediaAssetId}:${entry.mediaMetadataRevisionId}`,
        entry,
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      a.mediaAssetId.localeCompare(b.mediaAssetId) ||
      a.mediaMetadataRevisionId.localeCompare(b.mediaMetadataRevisionId),
  );
}

export async function loadPreflightMedia(
  client: TransactionClient,
  snapshot: ContentAuthoringSnapshot,
) {
  const references = preflightMediaReferences(snapshot);
  const assetIds = [
    ...new Set(references.map((entry) => entry.mediaAssetId)),
  ].sort();
  // Match media authoring's asset-before-metadata lock order. Include every provenance source.
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
  const assetRows = await preflightRows(
    client,
    "media_assets",
    "r.id=ANY($1::uuid[]) ORDER BY r.id",
    [allIds],
  );
  const byId = new Map(assetRows.map((row) => [String(row["id"]), row]));
  const variantRows = await preflightRows(
    client,
    "media_variants",
    "r.media_asset_id=ANY($1::uuid[]) ORDER BY r.media_asset_id,r.id",
    [assetIds],
  );
  const mediaSnapshots: ContentAuthoringSnapshot[] = [];
  for (const reference of references) {
    if (
      reference.mediaMetadataRevisionId === snapshot.revisionId &&
      snapshot.target.kind === "MEDIA_METADATA"
    )
      continue;
    const value = await preflightSnapshot(
      client,
      {
        kind: "MEDIA_METADATA",
        mediaAssetId: reference.mediaAssetId,
      } as ContentAuthoringTarget,
      reference.mediaMetadataRevisionId,
    );
    if (!value) throw new Error("Missing canonical media metadata");
    mediaSnapshots.push(value);
  }
  const outputs = await preflightRows(
    client,
    "media_processing_outputs",
    "r.media_asset_id=ANY($1::uuid[]) AND r.kind='MASTER' ORDER BY r.job_id",
    [assetIds],
  );
  const mediaLineage = assetIds.map((assetId) => {
    const asset = byId.get(assetId);
    if (!asset) throw new Error("Missing canonical media asset");
    return publicationPreflightMediaLineageSchema.parse({
      assetId,
      identityKind: asset["identity_kind"],
      processing: jobs
        .filter((job) => job["output_asset_id"] === assetId)
        .map((job) => {
          const original = byId.get(String(job["source_asset_id"]));
          const output = outputs.find((entry) => entry["job_id"] === job["id"]);
          if (!original || !output)
            throw new Error("Missing canonical processing evidence");
          return {
            jobId: job["id"],
            status: job["status"],
            commandHash: job["command_hash"],
            command: mediaImageProcessingCommandSchema.parse({
              schemaVersion: 1,
              profileVersion: job["profile_version"],
              source: {
                assetId: original["id"],
                metadataRevisionId: job["source_metadata_revision_id"],
                checksumSha256: job["source_checksum_sha256"],
                objectKey: original["object_key"],
                mimeType: original["mime_type"],
                byteSize: Number(original["byte_size"]),
                width: original["width"],
                height: original["height"],
              },
              role: job["role"],
              fit: job["fit"],
              focalPoint: {
                x: Number(job["focal_x"]),
                y: Number(job["focal_y"]),
              },
            }),
            sourceAsset: preflightAsset(original),
            sourceIdentityKind: original["identity_kind"],
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
  });
  return {
    mediaSnapshots,
    mediaLineage,
    mediaAssets: assetIds.map((id) => preflightAsset(byId.get(id)!)),
    mediaVariants: variantRows.map(preflightVariant),
  };
}
