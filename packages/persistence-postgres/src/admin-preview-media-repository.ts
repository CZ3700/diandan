import {
  readBaseContentPreviewCommandSchema,
  adminPreviewMediaContextResponseSchema,
  baseContentTextSchema,
  type BaseContentPreviewResponse,
} from "@fan-support/contracts";
import { computeBaseContentTextHash } from "@fan-support/content";
import type { AdminPreviewMediaRepository } from "@fan-support/persistence-port";
import { createBaseContentPreviewRepository } from "./base-content-preview-repository.js";
import { AUTHORING_TABLES } from "./content-authoring-model.js";
import { mediaProvenanceEligibilitySql } from "./resource-media-eligibility-sql.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { baseContentFailure, baseContentRun } from "./base-content-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
type Preview = Extract<BaseContentPreviewResponse, { outcome: "SUCCESS" }>;
function mediaReferences(
  preview: Preview,
): { assetId: string; metadataRevisionId: string }[] {
  const references: { assetId: string; metadataRevisionId: string }[] = [];
  const add = (assetId: string, metadataRevisionId: string) =>
    references.push({ assetId, metadataRevisionId });
  const content = preview.content;
  if (content.kind === "IDOL" || content.kind === "GIFT")
    for (const reference of content.media)
      add(reference.mediaAssetId, reference.mediaMetadataRevisionId);
  if (content.kind === "HOMEPAGE")
    for (const slot of content.structure.slots)
      if (slot.kind === "HERO_IDOL") {
        add(slot.desktopMediaAssetId, slot.desktopMediaMetadataRevisionId);
        add(slot.mobileMediaAssetId, slot.mobileMediaMetadataRevisionId);
      }
  if (content.kind === "GIFT" && content.details)
    for (const block of content.details.document.blocks)
      if (block.kind === "MEDIA")
        add(block.mediaAssetId, block.mediaMetadataRevisionId);
  if (
    content.kind === "MEDIA_METADATA" &&
    preview.target.owner.kind === "MEDIA_METADATA"
  )
    add(preview.target.owner.mediaAssetId, preview.target.revisionId);
  return [
    ...new Map(
      references.map((reference) => [
        `${reference.assetId.toLowerCase()}:${reference.metadataRevisionId.toLowerCase()}`,
        reference,
      ]),
    ).values(),
  ];
}
export function createAdminPreviewMediaRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminPreviewMediaRepository {
  return {
    read: (input) =>
      baseContentRun(scope, async () => {
        const parsed = readBaseContentPreviewCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        const preview = await createBaseContentPreviewRepository(
          client,
          scope,
        ).read(command);
        if (preview.outcome !== "SUCCESS")
          return baseContentFailure("PREVIEW_UNAVAILABLE");
        const table = AUTHORING_TABLES[command.target.owner.kind];
        const [grant] = await draftRows(
          client,
          `SELECT id,actor_id,session_id,to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at_text,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS evaluated_at FROM public.base_content_preview_grants WHERE token_digest=decode($1,'hex') AND ${table.parent}=$2 AND locale=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
          [
            command.tokenDigest,
            command.target.revisionId,
            command.target.locale,
          ],
        );
        if (!grant) return baseContentFailure("PREVIEW_UNAVAILABLE");
        const images = [];
        for (const reference of mediaReferences(preview)) {
          const [row] = await draftRows(
            client,
            `SELECT to_jsonb(asset.*) AS asset,to_jsonb(metadata.*) AS metadata,to_jsonb(translation.*) AS translation,to_jsonb(variant.*) AS variant,${mediaProvenanceEligibilitySql} AS provenance_eligible
        FROM public.media_assets asset JOIN public.media_metadata_revisions metadata ON metadata.media_asset_id=asset.id AND metadata.id=$2
        LEFT JOIN public.media_metadata_revision_translations translation ON translation.media_metadata_revision_id=metadata.id AND translation.locale=$3
        LEFT JOIN LATERAL(SELECT v.* FROM public.media_variants v WHERE v.media_asset_id=asset.id AND v.status='READY' AND v.width<=asset.width AND v.height<=asset.height AND v.width::bigint*asset.height=v.height::bigint*asset.width ORDER BY v.width DESC,CASE v.format WHEN 'WEBP' THEN 0 WHEN 'AVIF' THEN 1 ELSE 2 END,v.id LIMIT 1) variant ON true
        WHERE asset.id=$1 FOR SHARE OF asset,metadata`,
            [
              reference.assetId,
              reference.metadataRevisionId,
              command.target.locale,
            ],
          );
          const asset = row?.["asset"] as DraftRow | undefined,
            metadata = row?.["metadata"] as DraftRow | undefined,
            translation = row?.["translation"] as DraftRow | null | undefined,
            variant = row?.["variant"] as DraftRow | null | undefined;
          const unavailable = (
            code:
              | "MEDIA_UNAVAILABLE"
              | "RIGHTS_UNAVAILABLE"
              | "PROCESSING"
              | "TRANSLATION_MISSING",
          ) => ({ ...reference, status: "UNAVAILABLE" as const, code });
          if (
            !asset ||
            !metadata ||
            asset["processing_status"] === "ARCHIVED"
          ) {
            images.push(unavailable("MEDIA_UNAVAILABLE"));
            continue;
          }
          if (
            asset["rights_status"] !== "APPROVED" ||
            row?.["provenance_eligible"] !== true
          ) {
            images.push(unavailable("RIGHTS_UNAVAILABLE"));
            continue;
          }
          if (asset["processing_status"] !== "READY" || !variant) {
            images.push(unavailable("PROCESSING"));
            continue;
          }
          if (!translation) {
            images.push(unavailable("TRANSLATION_MISSING"));
            continue;
          }
          const text = baseContentTextSchema.safeParse({
            kind: "MEDIA_METADATA",
            fields: {
              alt: translation["alt"],
              ...(translation["title"] == null
                ? {}
                : { title: translation["title"] }),
              ...(translation["caption"] == null
                ? {}
                : { caption: translation["caption"] }),
            },
          });
          if (
            !text.success ||
            computeBaseContentTextHash(text.data) !== translation["source_hash"]
          )
            return baseContentFailure("PREVIEW_UNAVAILABLE");
          images.push({
            ...reference,
            status: "AVAILABLE",
            alt: translation["alt"],
            presentationKind: metadata["presentation_kind"],
            focalPoint: {
              x: Number(metadata["focal_x"]),
              y: Number(metadata["focal_y"]),
            },
            width: variant["width"],
            height: variant["height"],
            mimeType:
              variant["format"] === "AVIF"
                ? "image/avif"
                : variant["format"] === "WEBP"
                  ? "image/webp"
                  : "image/jpeg",
            storageClass: "DERIVATIVE",
            objectKey: variant["object_key"],
            checksumSha256: variant["checksum_sha256"],
          });
        }
        return adminPreviewMediaContextResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          context: {
            schemaVersion: 1,
            target: command.target,
            grantId: grant["id"],
            actorId: grant["actor_id"],
            sessionId: grant["session_id"],
            expiresAt: grant["expires_at_text"],
            evaluatedAt: grant["evaluated_at"],
            images,
          },
        });
      }),
  };
}
