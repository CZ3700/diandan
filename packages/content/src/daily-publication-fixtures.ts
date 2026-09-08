import {
  dailyPublicationContextSchema,
  type DailyPublicationContext,
  sourceHashSchema,
  mediaAssetSchema,
  mediaImageProcessingCommandSchema,
  MEDIA_FRAMING_MASTER_SIZES,
} from "@fan-support/contracts";
import {
  publicationPreflightFixture,
  preflightFixtureId as id,
} from "./publication-preflight-fixtures.js";
import {
  buildDailyPublicationManifest,
  computeDailyPublicationManifestHash,
  computeDailySourceHash,
} from "./daily-publication.js";
import {
  hashMediaProcessingCommand,
  mediaProcessingObjectKey,
} from "./media-processing.js";

export function createDailyPublicationFixture(): DailyPublicationContext {
  const legacy = publicationPreflightFixture("IDOL");
  if (
    legacy.candidate.objectKind !== "IDOL" ||
    legacy.snapshot.content.kind !== "IDOL"
  )
    throw new Error("fixture");
  const candidate = legacy.candidate;
  const original = mediaAssetSchema.parse({
    ...candidate.mediaAssets[0],
    id: id(9800),
    width: 4000,
    height: 5000,
    objectKey: "original/source.jpg",
  });
  legacy.mediaLineage = candidate.mediaAssets.map((old, index) => {
    const role =
      legacy.snapshot.content.kind === "IDOL"
        ? legacy.snapshot.content.media.find(
            (row) => row.mediaAssetId === old.id,
          )!.role
        : "PORTRAIT";
    if (role === "GALLERY") throw new Error("fixture");
    const dimensions = MEDIA_FRAMING_MASTER_SIZES[role];
    const asset = mediaAssetSchema.parse({
      ...old,
      ...dimensions,
      mimeType: "image/png",
      objectKey: mediaProcessingObjectKey(old.checksumSha256, "PNG"),
    });
    candidate.mediaAssets[index] = asset;
    const command = mediaImageProcessingCommandSchema.parse({
      schemaVersion: 1,
      profileVersion: 1,
      role,
      fit: "CONTAIN",
      focalPoint: { x: 0.5, y: 0.5 },
      source: {
        assetId: original.id,
        metadataRevisionId: id(9801),
        checksumSha256: original.checksumSha256,
        objectKey: original.objectKey,
        width: original.width,
        height: original.height,
        byteSize: original.byteSize,
        mimeType: original.mimeType,
      },
    });
    return {
      assetId: asset.id,
      identityKind: "PROCESSED_MASTER",
      processing: [
        {
          jobId: id(9820 + index),
          status: "SUCCEEDED",
          command,
          commandHash: sourceHashSchema.parse(
            hashMediaProcessingCommand(command),
          ),
          sourceAsset: original,
          sourceIdentityKind: "SOURCE",
          outputAssetId: asset.id,
          output: {
            mediaAssetId: asset.id,
            checksumSha256: asset.checksumSha256,
            objectKey: asset.objectKey,
            width: asset.width,
            height: asset.height,
            byteSize: asset.byteSize,
          },
        },
      ],
    };
  });
  const source = (kind: string, fields: unknown, translationId: string) => ({
    id: translationId,
    locale: "zh-CN",
    fields,
    sourceHash: computeDailySourceHash(kind, "zh-CN", fields),
    editorId: legacy.snapshot.createdBy,
    editedAt: legacy.snapshot.createdAt,
  });
  const document = {
    schemaVersion: 3,
    kind: "IDOL",
    ownerId: legacy.candidate.base.id,
    revisionId: legacy.snapshot.revisionId,
    revisionNumber: legacy.snapshot.revisionNumber,
    createdBy: legacy.snapshot.createdBy,
    createdAt: legacy.snapshot.createdAt,
    source: source(
      "IDOL",
      legacy.snapshot.content.translations.find(
        (row) => row.locale === "zh-CN",
      )!.fields,
      id(9850),
    ),
    structure: legacy.snapshot.content.structure,
    media: legacy.snapshot.content.media.map(
      ({ role, mediaAssetId, mediaMetadataRevisionId, sortOrder }) => ({
        role,
        mediaAssetId,
        mediaMetadataRevisionId,
        sortOrder,
      }),
    ),
  };
  const media = legacy.mediaSnapshots.map((snapshot) => {
    if (
      snapshot.target.kind !== "MEDIA_METADATA" ||
      snapshot.content.kind !== "MEDIA_METADATA"
    )
      throw new Error("fixture");
    const assetId = snapshot.target.mediaAssetId;
    const asset = candidate.mediaAssets.find((row) => row.id === assetId)!;
    if (!asset) throw new Error("fixture");
    const variants =
      legacy.candidate.objectKind === "IDOL"
        ? legacy.candidate.mediaVariants.filter(
            (row) => row.mediaAssetId === asset.id,
          )
        : [];
    const variant = variants.toSorted((a, b) => b.width - a.width)[0]!;
    return {
      metadata: {
        schemaVersion: 3,
        kind: "MEDIA_METADATA",
        ownerId: asset.id,
        revisionId: snapshot.revisionId,
        revisionNumber: snapshot.revisionNumber,
        createdBy: snapshot.createdBy,
        createdAt: snapshot.createdAt,
        source: source(
          "MEDIA_METADATA",
          { alt: "真实图像说明" },
          id(9860 + legacy.mediaSnapshots.indexOf(snapshot)),
        ),
        structure: snapshot.content.structure,
      },
      lifecycle: "PUBLISHED",
      asset,
      variants,
      lineage: legacy.mediaLineage.find((row) => row.assetId === asset.id),
      selectedVariantId: variant.id,
      url: `https://media.example.test/${variant.objectKey}`,
    };
  });
  const manifest = buildDailyPublicationManifest({
    operationId: id(9870),
    actorId: legacy.snapshot.createdBy,
    document,
    media,
  });
  return dailyPublicationContextSchema.parse({
    schemaVersion: 3,
    publicationMode: "DIRECT_OPERATOR_V1",
    locale: "en",
    manifest,
    publication: {
      publicationId: id(9880),
      revisionId: document.revisionId,
      headVersion: 1,
      publishedAt: legacy.evaluatedAt,
      manifestHash: computeDailyPublicationManifestHash(manifest),
    },
    current: {
      publicationId: id(9880),
      revisionId: document.revisionId,
      headVersion: 1,
      evaluatedAt: legacy.evaluatedAt,
      lifecycle: "PUBLISHED",
      status: "active",
      handle: legacy.candidate.base.handle,
      acceptingGifts: true,
      document,
      media,
      prices: [],
      priceBooks: [],
      variants: [],
    },
  });
}
