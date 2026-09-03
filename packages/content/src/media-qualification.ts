import type {
  GiftRevisionMedia,
  IdolRevisionMedia,
  MediaAsset,
  MediaMetadataRevision,
  MediaVariant,
} from "@fan-support/contracts";

import { canonicalUuid, sameUuid } from "./uuid-identity.js";

export type MediaQualificationIssueCode =
  | "MEDIA_REFERENCE_PARENT_MISMATCH"
  | "MEDIA_REQUIRED_ROLE_MISSING"
  | "MEDIA_REQUIRED_ROLE_DUPLICATE"
  | "MEDIA_REFERENCE_DUPLICATE"
  | "MEDIA_SORT_ORDER_DUPLICATE"
  | "MEDIA_GALLERY_LIMIT_EXCEEDED"
  | "MEDIA_ASSET_DUPLICATE"
  | "MEDIA_ASSET_CHECKSUM_DUPLICATE"
  | "MEDIA_ASSET_MISSING"
  | "MEDIA_ASSET_NOT_READY"
  | "MEDIA_RIGHTS_NOT_APPROVED"
  | "MEDIA_METADATA_DUPLICATE"
  | "MEDIA_METADATA_MISSING"
  | "MEDIA_METADATA_MISMATCH"
  | "MEDIA_METADATA_NOT_PUBLISHABLE"
  | "MEDIA_PRESENTATION_KIND_INVALID"
  | "MEDIA_SOURCE_DIMENSIONS_INVALID"
  | "MEDIA_SOURCE_ASPECT_RATIO_INVALID"
  | "MEDIA_VARIANT_ID_DUPLICATE"
  | "MEDIA_DERIVATIVE_DUPLICATE"
  | "MEDIA_DERIVATIVE_MISSING"
  | "MEDIA_DERIVATIVE_NOT_READY"
  | "MEDIA_DERIVATIVE_USABLE_SIZE_MISSING"
  | "MEDIA_DERIVATIVE_DIMENSIONS_INVALID"
  | "MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID";

export type MediaQualificationIssue = Readonly<{
  code: MediaQualificationIssueCode;
  path: readonly (string | number)[];
}>;

type CommonMediaQualificationInput<Reference> = Readonly<{
  revisionId: string;
  references: readonly Reference[];
  assets: readonly MediaAsset[];
  variants: readonly MediaVariant[];
  metadataRevisions: readonly MediaMetadataRevision[];
}>;

export type GiftMediaQualificationInput =
  CommonMediaQualificationInput<GiftRevisionMedia>;
export type IdolMediaQualificationInput =
  CommonMediaQualificationInput<IdolRevisionMedia>;

type NormalizedReference = Readonly<{
  sourceIndex: number;
  parentRevisionId: string;
  parentField: "giftRevisionId" | "idolRevisionId";
  role: string;
  mediaAssetId: string;
  mediaMetadataRevisionId: string;
  sortOrder: number;
}>;

type RoleProfile = Readonly<{
  role: string;
  minimumWidth: number;
  minimumHeight: number;
  minimumDerivativeWidth: number;
  minimumDerivativeHeight: number;
  aspectWidth: number;
  aspectHeight: number;
  presentationKind: "INFORMATIVE";
}>;

const REQUIRED_DERIVATIVE_FORMATS = ["AVIF", "WEBP", "JPEG"] as const;

const GIFT_ROLE_PROFILES: readonly RoleProfile[] = [
  {
    role: "PRIMARY",
    minimumWidth: 1_200,
    minimumHeight: 1_200,
    minimumDerivativeWidth: 1_200,
    minimumDerivativeHeight: 1_200,
    aspectWidth: 1,
    aspectHeight: 1,
    presentationKind: "INFORMATIVE",
  },
];

const IDOL_ROLE_PROFILES: readonly RoleProfile[] = [
  {
    role: "PORTRAIT",
    minimumWidth: 1_600,
    minimumHeight: 2_000,
    minimumDerivativeWidth: 800,
    minimumDerivativeHeight: 1_000,
    aspectWidth: 4,
    aspectHeight: 5,
    presentationKind: "INFORMATIVE",
  },
  {
    role: "HERO_DESKTOP",
    minimumWidth: 2_400,
    minimumHeight: 1_350,
    minimumDerivativeWidth: 1_600,
    minimumDerivativeHeight: 900,
    aspectWidth: 16,
    aspectHeight: 9,
    presentationKind: "INFORMATIVE",
  },
  {
    role: "HERO_MOBILE",
    minimumWidth: 1_080,
    minimumHeight: 1_350,
    minimumDerivativeWidth: 720,
    minimumDerivativeHeight: 900,
    aspectWidth: 4,
    aspectHeight: 5,
    presentationKind: "INFORMATIVE",
  },
];

const MEDIA_ROLE_PROFILES: readonly RoleProfile[] = [
  ...GIFT_ROLE_PROFILES,
  ...IDOL_ROLE_PROFILES,
];

function mediaRoleProfile(role: string): RoleProfile | undefined {
  const normalizedRole = role === "HERO" ? "HERO_DESKTOP" : role;
  return MEDIA_ROLE_PROFILES.find(
    (candidate) => candidate.role === normalizedRole,
  );
}

export function meetsMediaRoleSourceMinimum(
  role: string,
  width: number,
  height: number,
): boolean {
  const profile = mediaRoleProfile(role);
  return (
    profile === undefined ||
    (width >= profile.minimumWidth && height >= profile.minimumHeight)
  );
}

export function meetsMediaRoleDerivativeMinimum(
  role: string,
  width: number,
  height: number,
): boolean {
  const profile = mediaRoleProfile(role);
  return (
    profile === undefined ||
    (width >= profile.minimumDerivativeWidth &&
      height >= profile.minimumDerivativeHeight)
  );
}

function issue(
  code: MediaQualificationIssueCode,
  path: readonly (string | number)[],
): MediaQualificationIssue {
  return { code, path: [...path] };
}

type UniqueIndex<T> = Readonly<{
  unique: ReadonlyMap<string, T>;
  present: ReadonlySet<string>;
}>;

function buildUniqueIndex<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  collectionPath: string,
  fieldPath: string,
  duplicateCode: MediaQualificationIssueCode,
  issues: MediaQualificationIssue[],
): UniqueIndex<T> {
  const groups = new Map<string, { value: T; index: number }[]>();
  for (const [index, value] of values.entries()) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push({ value, index });
    groups.set(key, group);
  }

  const unique = new Map<string, T>();
  for (const [key, group] of groups) {
    if (group.length === 1) {
      const only = group[0];
      if (only !== undefined) {
        unique.set(key, only.value);
      }
      continue;
    }
    for (const duplicate of group) {
      issues.push(
        issue(duplicateCode, [collectionPath, duplicate.index, fieldPath]),
      );
    }
  }

  return { unique, present: new Set(groups.keys()) };
}

function hasAspectRatio(
  width: number,
  height: number,
  aspectWidth: number,
  aspectHeight: number,
): boolean {
  return (
    BigInt(width) * BigInt(aspectHeight) ===
    BigInt(height) * BigInt(aspectWidth)
  );
}

function validateRequiredRoles(
  references: readonly NormalizedReference[],
  revisionId: string,
  profiles: readonly RoleProfile[],
  issues: MediaQualificationIssue[],
): void {
  for (const profile of profiles) {
    const matches = references.filter(
      (reference) =>
        sameUuid(reference.parentRevisionId, revisionId) &&
        reference.role === profile.role,
    );
    if (matches.length === 0) {
      issues.push(
        issue("MEDIA_REQUIRED_ROLE_MISSING", ["mediaReferences", profile.role]),
      );
    } else if (matches.length > 1) {
      for (const match of matches) {
        issues.push(
          issue("MEDIA_REQUIRED_ROLE_DUPLICATE", [
            "mediaReferences",
            match.sourceIndex,
            "role",
          ]),
        );
      }
    }
  }
}

function validateReferenceProfile(
  reference: NormalizedReference,
  profile: RoleProfile | undefined,
  asset: MediaAsset,
  metadata: MediaMetadataRevision,
  variantsByAssetAndFormat: ReadonlyMap<string, readonly MediaVariant[]>,
  variantIndexes: ReadonlyMap<MediaVariant, number>,
  issues: MediaQualificationIssue[],
): void {
  const referencePath = ["mediaReferences", reference.sourceIndex] as const;
  if (
    profile !== undefined &&
    metadata.presentationKind !== profile.presentationKind
  ) {
    issues.push(
      issue("MEDIA_PRESENTATION_KIND_INVALID", [
        ...referencePath,
        "mediaMetadataRevisionId",
      ]),
    );
  }
  if (profile !== undefined) {
    if (
      asset.width < profile.minimumWidth ||
      asset.height < profile.minimumHeight
    ) {
      issues.push(
        issue("MEDIA_SOURCE_DIMENSIONS_INVALID", [
          ...referencePath,
          "mediaAssetId",
        ]),
      );
    }
    if (
      !hasAspectRatio(
        asset.width,
        asset.height,
        profile.aspectWidth,
        profile.aspectHeight,
      )
    ) {
      issues.push(
        issue("MEDIA_SOURCE_ASPECT_RATIO_INVALID", [
          ...referencePath,
          "mediaAssetId",
        ]),
      );
    }
  }

  for (const format of REQUIRED_DERIVATIVE_FORMATS) {
    const key = `${canonicalUuid(asset.id)}:${format}`;
    const variants = variantsByAssetAndFormat.get(key) ?? [];
    if (variants.length === 0) {
      issues.push(
        issue("MEDIA_DERIVATIVE_MISSING", [
          ...referencePath,
          "mediaAssetId",
          format,
        ]),
      );
      continue;
    }

    const readyVariants = variants.filter(
      (variant) => variant.status === "READY",
    );
    if (readyVariants.length === 0) {
      for (const variant of variants) {
        const variantIndex = variantIndexes.get(variant);
        if (variantIndex !== undefined) {
          issues.push(
            issue("MEDIA_DERIVATIVE_NOT_READY", [
              "mediaVariants",
              variantIndex,
              "status",
            ]),
          );
        }
      }
    }
    if (
      profile !== undefined &&
      !readyVariants.some((variant) =>
        meetsMediaRoleDerivativeMinimum(
          reference.role,
          variant.width,
          variant.height,
        ),
      )
    ) {
      issues.push(
        issue("MEDIA_DERIVATIVE_USABLE_SIZE_MISSING", [
          ...referencePath,
          "mediaAssetId",
          format,
        ]),
      );
    }

    for (const variant of variants) {
      if (variant.status !== "READY" && variant.status !== "PROCESSING") {
        continue;
      }
      const variantIndex = variantIndexes.get(variant);
      if (variantIndex === undefined) {
        continue;
      }
      const variantPath = ["mediaVariants", variantIndex] as const;
      if (variant.width > asset.width || variant.height > asset.height) {
        issues.push(
          issue("MEDIA_DERIVATIVE_DIMENSIONS_INVALID", [
            ...variantPath,
            "width",
          ]),
        );
      }
      if (
        profile !== undefined &&
        !hasAspectRatio(
          variant.width,
          variant.height,
          profile.aspectWidth,
          profile.aspectHeight,
        )
      ) {
        issues.push(
          issue("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID", [
            ...variantPath,
            "width",
          ]),
        );
      }
    }
  }
}

function validateAssetChecksums(
  assets: readonly MediaAsset[],
  issues: MediaQualificationIssue[],
): void {
  const byChecksum = new Map<
    string,
    { assetId: string; sourceIndex: number }[]
  >();
  for (const [sourceIndex, asset] of assets.entries()) {
    const matches = byChecksum.get(asset.checksumSha256) ?? [];
    matches.push({ assetId: asset.id, sourceIndex });
    byChecksum.set(asset.checksumSha256, matches);
  }

  for (const matches of byChecksum.values()) {
    if (
      new Set(matches.map((match) => canonicalUuid(match.assetId))).size < 2
    ) {
      continue;
    }
    for (const match of matches) {
      issues.push(
        issue("MEDIA_ASSET_CHECKSUM_DUPLICATE", [
          "mediaAssets",
          match.sourceIndex,
          "checksumSha256",
        ]),
      );
    }
  }
}

function groupVariantsByAssetAndFormat(
  variants: readonly MediaVariant[],
): ReadonlyMap<string, readonly MediaVariant[]> {
  const groups = new Map<string, MediaVariant[]>();
  for (const variant of variants) {
    const key = `${canonicalUuid(variant.mediaAssetId)}:${variant.format}`;
    const matches = groups.get(key) ?? [];
    matches.push(variant);
    groups.set(key, matches);
  }
  return groups;
}

function validateMediaQualification(
  input: Readonly<{
    revisionId: string;
    references: readonly NormalizedReference[];
    assets: readonly MediaAsset[];
    variants: readonly MediaVariant[];
    metadataRevisions: readonly MediaMetadataRevision[];
  }>,
  roleProfiles: readonly RoleProfile[],
): readonly MediaQualificationIssue[] {
  const issues: MediaQualificationIssue[] = [];
  const assets = buildUniqueIndex(
    input.assets,
    (asset) => canonicalUuid(asset.id),
    "mediaAssets",
    "id",
    "MEDIA_ASSET_DUPLICATE",
    issues,
  );
  validateAssetChecksums(input.assets, issues);
  const metadata = buildUniqueIndex(
    input.metadataRevisions,
    (revision) => canonicalUuid(revision.id),
    "mediaMetadataRevisions",
    "id",
    "MEDIA_METADATA_DUPLICATE",
    issues,
  );
  buildUniqueIndex(
    input.variants,
    (variant) => canonicalUuid(variant.id),
    "mediaVariants",
    "id",
    "MEDIA_VARIANT_ID_DUPLICATE",
    issues,
  );
  buildUniqueIndex(
    input.variants,
    (variant) =>
      `${canonicalUuid(variant.mediaAssetId)}:${variant.format}:${variant.width}:${variant.height}`,
    "mediaVariants",
    "width",
    "MEDIA_DERIVATIVE_DUPLICATE",
    issues,
  );
  const variantsByAssetAndFormat = groupVariantsByAssetAndFormat(
    input.variants,
  );
  const variantIndexes = new Map(
    input.variants.map((variant, index) => [variant, index]),
  );
  const profileByRole = new Map(
    roleProfiles.map((profile) => [profile.role, profile]),
  );

  validateRequiredRoles(
    input.references,
    input.revisionId,
    roleProfiles,
    issues,
  );
  buildUniqueIndex(
    input.references,
    (reference) =>
      `${canonicalUuid(reference.parentRevisionId)}:${reference.role}:${canonicalUuid(reference.mediaAssetId)}`,
    "mediaReferences",
    "mediaAssetId",
    "MEDIA_REFERENCE_DUPLICATE",
    issues,
  );
  buildUniqueIndex(
    input.references,
    (reference) =>
      `${canonicalUuid(reference.parentRevisionId)}:${reference.role}:${reference.sortOrder}`,
    "mediaReferences",
    "sortOrder",
    "MEDIA_SORT_ORDER_DUPLICATE",
    issues,
  );
  if (
    input.references.filter(
      (reference) =>
        sameUuid(reference.parentRevisionId, input.revisionId) &&
        reference.role === "GALLERY",
    ).length > 12
  ) {
    issues.push(
      issue("MEDIA_GALLERY_LIMIT_EXCEEDED", ["mediaReferences", "GALLERY"]),
    );
  }

  for (const reference of input.references) {
    const referencePath = ["mediaReferences", reference.sourceIndex] as const;
    if (!sameUuid(reference.parentRevisionId, input.revisionId)) {
      issues.push(
        issue("MEDIA_REFERENCE_PARENT_MISMATCH", [
          ...referencePath,
          reference.parentField,
        ]),
      );
      continue;
    }

    const assetId = canonicalUuid(reference.mediaAssetId);
    const asset = assets.unique.get(assetId);
    if (asset === undefined) {
      if (!assets.present.has(assetId)) {
        issues.push(
          issue("MEDIA_ASSET_MISSING", [...referencePath, "mediaAssetId"]),
        );
      }
      continue;
    }
    if (asset.processingStatus !== "READY") {
      issues.push(
        issue("MEDIA_ASSET_NOT_READY", [...referencePath, "mediaAssetId"]),
      );
    }
    if (asset.rightsStatus !== "APPROVED") {
      issues.push(
        issue("MEDIA_RIGHTS_NOT_APPROVED", [...referencePath, "mediaAssetId"]),
      );
    }

    const metadataRevisionId = canonicalUuid(reference.mediaMetadataRevisionId);
    const metadataRevision = metadata.unique.get(metadataRevisionId);
    if (metadataRevision === undefined) {
      if (!metadata.present.has(metadataRevisionId)) {
        issues.push(
          issue("MEDIA_METADATA_MISSING", [
            ...referencePath,
            "mediaMetadataRevisionId",
          ]),
        );
      }
      continue;
    }
    if (!sameUuid(metadataRevision.mediaAssetId, asset.id)) {
      issues.push(
        issue("MEDIA_METADATA_MISMATCH", [
          ...referencePath,
          "mediaMetadataRevisionId",
        ]),
      );
    }
    if (
      metadataRevision.lifecycle.status === "DRAFT" ||
      metadataRevision.lifecycle.status === "ARCHIVED"
    ) {
      issues.push(
        issue("MEDIA_METADATA_NOT_PUBLISHABLE", [
          ...referencePath,
          "mediaMetadataRevisionId",
        ]),
      );
    }

    validateReferenceProfile(
      reference,
      profileByRole.get(reference.role),
      asset,
      metadataRevision,
      variantsByAssetAndFormat,
      variantIndexes,
      issues,
    );
  }

  return issues;
}

export function validateGiftMediaQualification(
  input: GiftMediaQualificationInput,
): readonly MediaQualificationIssue[] {
  return validateMediaQualification(
    {
      ...input,
      references: input.references.map((reference, sourceIndex) => ({
        sourceIndex,
        parentRevisionId: reference.giftRevisionId,
        parentField: "giftRevisionId",
        role: reference.role,
        mediaAssetId: reference.mediaAssetId,
        mediaMetadataRevisionId: reference.mediaMetadataRevisionId,
        sortOrder: reference.sortOrder,
      })),
    },
    GIFT_ROLE_PROFILES,
  );
}

export function validateIdolMediaQualification(
  input: IdolMediaQualificationInput,
): readonly MediaQualificationIssue[] {
  const normalizedReferences = input.references.map(
    (reference, sourceIndex) => ({
      sourceIndex,
      parentRevisionId: reference.idolRevisionId,
      parentField: "idolRevisionId" as const,
      role: reference.role,
      mediaAssetId: reference.mediaAssetId,
      mediaMetadataRevisionId: reference.mediaMetadataRevisionId,
      sortOrder: reference.sortOrder,
    }),
  );
  return validateMediaQualification(
    {
      ...input,
      references: normalizedReferences,
    },
    IDOL_ROLE_PROFILES,
  );
}
