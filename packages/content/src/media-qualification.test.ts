import { expect, test } from "vitest";

import {
  giftRevisionMediaSchema,
  giftRevisionIdSchema,
  idolRevisionIdSchema,
  idolRevisionMediaSchema,
  mediaAssetSchema,
  mediaMetadataRevisionSchema,
  mediaVariantIdSchema,
  mediaVariantSchema,
} from "@fan-support/contracts";

import { fictionalGiftPublicationCandidate } from "./fixtures.js";
import {
  validateGiftMediaQualification,
  validateIdolMediaQualification,
} from "./media-qualification.js";

function cloneGiftMedia() {
  const fixture = structuredClone(fictionalGiftPublicationCandidate);
  return {
    revisionId: fixture.revision.id,
    references: fixture.mediaReferences,
    assets: fixture.mediaAssets,
    variants: fixture.mediaVariants,
    metadataRevisions: fixture.mediaMetadataRevisions,
  };
}

function issueCodes(
  issues: readonly Readonly<{ code: string }>[],
): ReadonlySet<string> {
  return new Set(issues.map((entry) => entry.code));
}

test("qualifies the fictional gift PRIMARY media profile", () => {
  expect(validateGiftMediaQualification(cloneGiftMedia())).toEqual([]);
});

test("fails closed on duplicate media identities independent of record order", () => {
  const input = cloneGiftMedia();
  const duplicate = {
    ...input.assets[0]!,
    processingStatus: "FAILED" as const,
    processingErrorCode: "DUPLICATE_CONFLICT",
  };
  input.assets.push(duplicate);

  const forward = validateGiftMediaQualification(input);
  const reversed = validateGiftMediaQualification({
    ...input,
    assets: [...input.assets].reverse(),
  });

  expect(issueCodes(forward)).toContain("MEDIA_ASSET_DUPLICATE");
  expect(issueCodes(reversed)).toContain("MEDIA_ASSET_DUPLICATE");
  expect(
    forward
      .filter((entry) => entry.code === "MEDIA_ASSET_DUPLICATE")
      .map((entry) => entry.path),
  ).toEqual([
    ["mediaAssets", 0, "id"],
    ["mediaAssets", 1, "id"],
  ]);
  expect(issueCodes(forward)).not.toContain("MEDIA_ASSET_CHECKSUM_DUPLICATE");
  expect(
    reversed
      .filter((entry) => entry.code === "MEDIA_ASSET_DUPLICATE")
      .map((entry) => entry.path),
  ).toEqual([
    ["mediaAssets", 0, "id"],
    ["mediaAssets", 1, "id"],
  ]);

  const duplicateMetadata = cloneGiftMedia();
  duplicateMetadata.metadataRevisions.push({
    ...duplicateMetadata.metadataRevisions[0]!,
  });
  expect(
    issueCodes(validateGiftMediaQualification(duplicateMetadata)),
  ).toContain("MEDIA_METADATA_DUPLICATE");

  const duplicateVariantId = cloneGiftMedia();
  duplicateVariantId.variants.push({
    ...duplicateVariantId.variants[0]!,
    format: "WEBP",
  });
  expect(
    issueCodes(validateGiftMediaQualification(duplicateVariantId)),
  ).toContain("MEDIA_VARIANT_ID_DUPLICATE");

  const duplicateDerivative = cloneGiftMedia();
  duplicateDerivative.variants.push({
    ...duplicateDerivative.variants[0]!,
    id: mediaVariantIdSchema.parse("00000000-0000-4000-8000-000000008888"),
  });
  expect(
    issueCodes(validateGiftMediaQualification(duplicateDerivative)),
  ).toContain("MEDIA_DERIVATIVE_DUPLICATE");
});

test("allows responsive derivatives while requiring one READY variant per format", () => {
  const responsive = cloneGiftMedia();
  responsive.variants.push({
    ...responsive.variants[0]!,
    id: mediaVariantIdSchema.parse("00000000-0000-4000-8000-000000008881"),
    width: 600,
    height: 600,
    status: "READY",
  });

  expect(validateGiftMediaQualification(responsive)).toEqual([]);

  const noReadyAvif = structuredClone(responsive);
  noReadyAvif.variants = noReadyAvif.variants.map((variant) =>
    variant.format === "AVIF"
      ? { ...variant, status: "PROCESSING" as const }
      : variant,
  );
  expect(issueCodes(validateGiftMediaQualification(noReadyAvif))).toContain(
    "MEDIA_DERIVATIVE_NOT_READY",
  );

  const onlyUndersizedReady = cloneGiftMedia();
  onlyUndersizedReady.variants = onlyUndersizedReady.variants.map(
    (variant) => ({ ...variant, width: 600, height: 600 }),
  );
  expect(
    issueCodes(validateGiftMediaQualification(onlyUndersizedReady)),
  ).toContain("MEDIA_DERIVATIVE_USABLE_SIZE_MISSING");

  const invalidResponsive = cloneGiftMedia();
  invalidResponsive.variants.push({
    ...invalidResponsive.variants[0]!,
    id: mediaVariantIdSchema.parse("00000000-0000-4000-8000-000000008882"),
    width: 600,
    height: 400,
  });
  expect(
    issueCodes(validateGiftMediaQualification(invalidResponsive)),
  ).toContain("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID");

  const invalidProcessingResponsive = cloneGiftMedia();
  invalidProcessingResponsive.variants.push({
    ...invalidProcessingResponsive.variants[0]!,
    id: mediaVariantIdSchema.parse("00000000-0000-4000-8000-000000008885"),
    width: 600,
    height: 400,
    status: "PROCESSING",
  });
  expect(
    issueCodes(validateGiftMediaQualification(invalidProcessingResponsive)),
  ).toContain("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID");

  const oversizedResponsive = cloneGiftMedia();
  oversizedResponsive.variants.push({
    ...oversizedResponsive.variants[0]!,
    id: mediaVariantIdSchema.parse("00000000-0000-4000-8000-000000008883"),
    width: 2400,
    height: 2400,
  });
  expect(
    issueCodes(validateGiftMediaQualification(oversizedResponsive)),
  ).toContain("MEDIA_DERIVATIVE_DIMENSIONS_INVALID");
});

test("rejects distinct media assets that reuse the same checksum", () => {
  const input = cloneGiftMedia();
  input.assets.push(
    mediaAssetSchema.parse({
      ...input.assets[0]!,
      id: "00000000-0000-4000-8000-000000008891",
      objectKey: "fixtures/media/checksum-collision.jpg",
    }),
  );

  expect(issueCodes(validateGiftMediaQualification(input))).toContain(
    "MEDIA_ASSET_CHECKSUM_DUPLICATE",
  );
});

test("matches logically identical UUIDs regardless of letter case", () => {
  const input = cloneGiftMedia();
  input.revisionId = giftRevisionIdSchema.parse(input.revisionId.toUpperCase());
  input.assets[0] = mediaAssetSchema.parse({
    ...input.assets[0]!,
    id: input.assets[0]!.id.toUpperCase(),
  });
  input.metadataRevisions[0] = mediaMetadataRevisionSchema.parse({
    ...input.metadataRevisions[0]!,
    id: input.metadataRevisions[0]!.id.toUpperCase(),
    mediaAssetId: input.metadataRevisions[0]!.mediaAssetId.toUpperCase(),
  });
  input.variants = input.variants.map((variant) =>
    mediaVariantSchema.parse({
      ...variant,
      mediaAssetId: variant.mediaAssetId.toUpperCase(),
    }),
  );

  expect(validateGiftMediaQualification(input)).toEqual([]);
});

test("detects UUID-keyed duplicates across letter-case variants", () => {
  const duplicateAsset = cloneGiftMedia();
  duplicateAsset.assets.push(
    mediaAssetSchema.parse({
      ...duplicateAsset.assets[0]!,
      id: duplicateAsset.assets[0]!.id.toUpperCase(),
    }),
  );
  const duplicateAssetCodes = issueCodes(
    validateGiftMediaQualification(duplicateAsset),
  );
  expect(duplicateAssetCodes).toContain("MEDIA_ASSET_DUPLICATE");
  expect(duplicateAssetCodes).not.toContain("MEDIA_ASSET_CHECKSUM_DUPLICATE");

  const duplicateMetadata = cloneGiftMedia();
  duplicateMetadata.metadataRevisions.push(
    mediaMetadataRevisionSchema.parse({
      ...duplicateMetadata.metadataRevisions[0]!,
      id: duplicateMetadata.metadataRevisions[0]!.id.toUpperCase(),
    }),
  );
  expect(
    issueCodes(validateGiftMediaQualification(duplicateMetadata)),
  ).toContain("MEDIA_METADATA_DUPLICATE");

  const duplicateVariantId = cloneGiftMedia();
  duplicateVariantId.variants.push(
    mediaVariantSchema.parse({
      ...duplicateVariantId.variants[0]!,
      id: duplicateVariantId.variants[0]!.id.toUpperCase(),
      width: 600,
      height: 600,
    }),
  );
  expect(
    issueCodes(validateGiftMediaQualification(duplicateVariantId)),
  ).toContain("MEDIA_VARIANT_ID_DUPLICATE");

  const duplicateDerivative = cloneGiftMedia();
  duplicateDerivative.variants.push(
    mediaVariantSchema.parse({
      ...duplicateDerivative.variants[0]!,
      id: "00000000-0000-4000-8000-000000008884",
      mediaAssetId: duplicateDerivative.variants[0]!.mediaAssetId.toUpperCase(),
    }),
  );
  expect(
    issueCodes(validateGiftMediaQualification(duplicateDerivative)),
  ).toContain("MEDIA_DERIVATIVE_DUPLICATE");

  const duplicateReference = cloneGiftMedia();
  duplicateReference.references.push(
    giftRevisionMediaSchema.parse({
      ...duplicateReference.references[0]!,
      giftRevisionId:
        duplicateReference.references[0]!.giftRevisionId.toUpperCase(),
      mediaAssetId:
        duplicateReference.references[0]!.mediaAssetId.toUpperCase(),
      mediaMetadataRevisionId:
        duplicateReference.references[0]!.mediaMetadataRevisionId.toUpperCase(),
      sortOrder: 1,
    }),
  );
  expect(
    issueCodes(validateGiftMediaQualification(duplicateReference)),
  ).toContain("MEDIA_REFERENCE_DUPLICATE");
});

test("enforces an informative square gift PRIMARY with qualified derivatives", () => {
  const duplicatePrimary = cloneGiftMedia();
  duplicatePrimary.references.push({
    ...duplicatePrimary.references[0]!,
    sortOrder: 1,
  });
  expect(
    issueCodes(validateGiftMediaQualification(duplicatePrimary)),
  ).toContain("MEDIA_REQUIRED_ROLE_DUPLICATE");
  expect(
    issueCodes(validateGiftMediaQualification(duplicatePrimary)),
  ).toContain("MEDIA_REFERENCE_DUPLICATE");

  const decorative = cloneGiftMedia();
  decorative.metadataRevisions[0] = {
    ...decorative.metadataRevisions[0]!,
    presentationKind: "DECORATIVE",
  };
  expect(issueCodes(validateGiftMediaQualification(decorative))).toContain(
    "MEDIA_PRESENTATION_KIND_INVALID",
  );

  const tiny = cloneGiftMedia();
  tiny.assets[0] = { ...tiny.assets[0]!, width: 1, height: 1 };
  expect(issueCodes(validateGiftMediaQualification(tiny))).toContain(
    "MEDIA_SOURCE_DIMENSIONS_INVALID",
  );

  const wrongAspect = cloneGiftMedia();
  wrongAspect.assets[0] = {
    ...wrongAspect.assets[0]!,
    width: 1600,
    height: 1200,
  };
  expect(issueCodes(validateGiftMediaQualification(wrongAspect))).toContain(
    "MEDIA_SOURCE_ASPECT_RATIO_INVALID",
  );

  const missingFormat = cloneGiftMedia();
  missingFormat.variants = missingFormat.variants.filter(
    (variant) => variant.format !== "AVIF",
  );
  expect(issueCodes(validateGiftMediaQualification(missingFormat))).toContain(
    "MEDIA_DERIVATIVE_MISSING",
  );

  const invalidDerivative = cloneGiftMedia();
  invalidDerivative.variants[0] = {
    ...invalidDerivative.variants[0]!,
    width: 1200,
    height: 800,
  };
  expect(
    issueCodes(validateGiftMediaQualification(invalidDerivative)),
  ).toContain("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID");
});

test("rejects duplicate sort orders within the same parent and media role", () => {
  const input = cloneGiftMedia();
  input.references.push(
    giftRevisionMediaSchema.parse({
      schemaVersion: 1,
      giftRevisionId: input.revisionId,
      role: "GALLERY",
      mediaAssetId: "00000000-0000-4000-8000-000000008901",
      mediaMetadataRevisionId: "00000000-0000-4000-8000-000000008911",
      sortOrder: 7,
    }),
    giftRevisionMediaSchema.parse({
      schemaVersion: 1,
      giftRevisionId: input.revisionId,
      role: "GALLERY",
      mediaAssetId: "00000000-0000-4000-8000-000000008902",
      mediaMetadataRevisionId: "00000000-0000-4000-8000-000000008912",
      sortOrder: 7,
    }),
  );

  expect(issueCodes(validateGiftMediaQualification(input))).toContain(
    "MEDIA_SORT_ORDER_DUPLICATE",
  );
  expect(issueCodes(validateGiftMediaQualification(input))).not.toContain(
    "MEDIA_REFERENCE_DUPLICATE",
  );
});

test("limits a Gift revision to twelve GALLERY references", () => {
  const input = cloneGiftMedia();
  input.references.push(
    ...Array.from({ length: 13 }, (_, index) =>
      giftRevisionMediaSchema.parse({
        schemaVersion: 1,
        giftRevisionId: input.revisionId,
        role: "GALLERY",
        mediaAssetId: `00000000-0000-4000-8000-${(9_200 + index)
          .toString()
          .padStart(12, "0")}`,
        mediaMetadataRevisionId: `00000000-0000-4000-8000-${(9_300 + index)
          .toString()
          .padStart(12, "0")}`,
        sortOrder: index + 1,
      }),
    ),
  );

  expect(issueCodes(validateGiftMediaQualification(input))).toContain(
    "MEDIA_GALLERY_LIMIT_EXCEEDED",
  );
});

function createIdolMediaFixture() {
  const revisionId = idolRevisionIdSchema.parse(
    "ea191a79-df54-410d-a32e-f966451976fb",
  );
  const roles = [
    {
      role: "PORTRAIT" as const,
      assetId: "00000000-0000-4000-8000-000000001001",
      metadataId: "00000000-0000-4000-8000-000000001101",
      width: 1600,
      height: 2000,
      derivativeWidth: 800,
      derivativeHeight: 1000,
    },
    {
      role: "HERO_DESKTOP" as const,
      assetId: "00000000-0000-4000-8000-000000001002",
      metadataId: "00000000-0000-4000-8000-000000001102",
      width: 2400,
      height: 1350,
      derivativeWidth: 1600,
      derivativeHeight: 900,
    },
    {
      role: "HERO_MOBILE" as const,
      assetId: "00000000-0000-4000-8000-000000001003",
      metadataId: "00000000-0000-4000-8000-000000001103",
      width: 1080,
      height: 1350,
      derivativeWidth: 720,
      derivativeHeight: 900,
    },
  ];

  return {
    revisionId,
    references: roles.map((entry, index) =>
      idolRevisionMediaSchema.parse({
        schemaVersion: 1,
        idolRevisionId: revisionId,
        role: entry.role,
        mediaAssetId: entry.assetId,
        mediaMetadataRevisionId: entry.metadataId,
        sortOrder: index,
      }),
    ),
    assets: roles.map((entry, index) =>
      mediaAssetSchema.parse({
        schemaVersion: 1,
        id: entry.assetId,
        checksumSha256: (index + 1).toString(16).repeat(64),
        mimeType: "image/jpeg",
        width: entry.width,
        height: entry.height,
        byteSize: 500_000,
        objectKey: `fixtures/idol/${entry.role.toLowerCase()}.jpg`,
        processingStatus: "READY",
        rightsStatus: "APPROVED",
        rightsReference: `fixture-rights-${index + 1}`,
        createdAt: "2026-09-03T00:00:00Z",
      }),
    ),
    metadataRevisions: roles.map((entry) =>
      mediaMetadataRevisionSchema.parse({
        schemaVersion: 1,
        id: entry.metadataId,
        mediaAssetId: entry.assetId,
        revision: 1,
        lifecycle: {
          status: "PUBLISHED",
          validatedAt: "2026-09-03T01:00:00Z",
          publishedAt: "2026-09-03T02:00:00Z",
        },
        presentationKind: "INFORMATIVE",
        focalPoint: { x: 0.5, y: 0.5 },
        createdBy: "34d657b6-93b2-470f-a777-4ce1f98914e0",
        createdAt: "2026-09-03T00:00:00Z",
      }),
    ),
    variants: roles.flatMap((entry, roleIndex) =>
      (["AVIF", "WEBP", "JPEG"] as const).map((format, formatIndex) =>
        mediaVariantSchema.parse({
          schemaVersion: 1,
          id: `00000000-0000-4000-8000-${(2_000 + roleIndex * 10 + formatIndex)
            .toString(16)
            .padStart(12, "0")}`,
          mediaAssetId: entry.assetId,
          format,
          width: entry.derivativeWidth,
          height: entry.derivativeHeight,
          byteSize: 100_000,
          checksumSha256: (roleIndex + formatIndex + 4).toString(16).repeat(64),
          objectKey: `fixtures/idol/${entry.role.toLowerCase()}-${format.toLowerCase()}`,
          status: "READY",
        }),
      ),
    ),
  };
}

test("requires the three unique idol media roles with their role-specific profiles", () => {
  const fixture = createIdolMediaFixture();
  expect(validateIdolMediaQualification(fixture)).toEqual([]);

  const missingPortrait = createIdolMediaFixture();
  missingPortrait.references = missingPortrait.references.filter(
    (reference) => reference.role !== "PORTRAIT",
  );
  expect(issueCodes(validateIdolMediaQualification(missingPortrait))).toContain(
    "MEDIA_REQUIRED_ROLE_MISSING",
  );

  const duplicateDesktop = createIdolMediaFixture();
  duplicateDesktop.references.push({
    ...duplicateDesktop.references.find(
      (reference) => reference.role === "HERO_DESKTOP",
    )!,
    sortOrder: 99,
  });
  expect(
    issueCodes(validateIdolMediaQualification(duplicateDesktop)),
  ).toContain("MEDIA_REQUIRED_ROLE_DUPLICATE");

  const undersizedMobile = createIdolMediaFixture();
  const mobileAsset = undersizedMobile.assets.findIndex(
    (asset) => asset.width === 1080 && asset.height === 1350,
  );
  undersizedMobile.assets[mobileAsset] = {
    ...undersizedMobile.assets[mobileAsset]!,
    width: 800,
    height: 1000,
  };
  expect(
    issueCodes(validateIdolMediaQualification(undersizedMobile)),
  ).toContain("MEDIA_SOURCE_DIMENSIONS_INVALID");

  const undersizedDesktopDerivatives = createIdolMediaFixture();
  const desktopAssetId = undersizedDesktopDerivatives.references.find(
    (reference) => reference.role === "HERO_DESKTOP",
  )!.mediaAssetId;
  undersizedDesktopDerivatives.variants =
    undersizedDesktopDerivatives.variants.map((variant) =>
      variant.mediaAssetId === desktopAssetId
        ? { ...variant, width: 800, height: 450 }
        : variant,
    );
  expect(
    issueCodes(validateIdolMediaQualification(undersizedDesktopDerivatives)),
  ).toContain("MEDIA_DERIVATIVE_USABLE_SIZE_MISSING");
});

test("limits an Idol revision to twelve GALLERY references", () => {
  const input = createIdolMediaFixture();
  const galleryReferences = Array.from({ length: 13 }, (_, index) =>
    idolRevisionMediaSchema.parse({
      schemaVersion: 1,
      idolRevisionId: input.revisionId,
      role: "GALLERY",
      mediaAssetId: `00000000-0000-4000-8000-${(9_000 + index)
        .toString()
        .padStart(12, "0")}`,
      mediaMetadataRevisionId: `00000000-0000-4000-8000-${(9_100 + index)
        .toString()
        .padStart(12, "0")}`,
      sortOrder: index + 3,
    }),
  );
  input.references.push(...galleryReferences.slice(0, 12));

  expect(issueCodes(validateIdolMediaQualification(input))).not.toContain(
    "MEDIA_GALLERY_LIMIT_EXCEEDED",
  );

  input.references.push(galleryReferences[12]!);

  expect(issueCodes(validateIdolMediaQualification(input))).toContain(
    "MEDIA_GALLERY_LIMIT_EXCEEDED",
  );
});

test("keeps qualification issue paths on original reference indexes", () => {
  const input = cloneGiftMedia();
  input.references.unshift({
    ...input.references[0]!,
    giftRevisionId: giftRevisionIdSchema.parse(
      "48790406-b59b-47bc-84e1-80b0094157a4",
    ),
    role: "GALLERY",
  });

  expect(validateGiftMediaQualification(input)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "MEDIA_REFERENCE_PARENT_MISMATCH",
        path: ["mediaReferences", 0, "giftRevisionId"],
      }),
    ]),
  );
});
