import {
  giftPublicProjectionSourceSchema,
  hasVisibleText,
  homepagePublicProjectionSourceSchema,
  idolPublicProjectionSourceSchema,
  policyPublicProjectionSourceSchema,
  publicRevisionSelectionSchema,
  publishedGiftViewSchema,
  publishedHomepageViewSchema,
  publishedIdolViewSchema,
  publishedPolicyViewSchema,
} from "@fan-support/contracts";
import type {
  GiftPublicProjectionSource,
  HomepagePublicProjectionSource,
  IdolPublicProjectionSource,
  PolicyPublicProjectionSource,
  PublicationValidationIssue,
  PublicMediaProjectionSource,
  PublicRevisionSelection,
  PublishedGiftView,
  PublishedHomepageView,
  PublishedIdolView,
  PublishedPolicyView,
  TranslationPublicationManifestEntry,
} from "@fan-support/contracts";

import {
  computeGiftTranslationContentHash,
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";
import {
  meetsMediaRoleDerivativeMinimum,
  meetsMediaRoleSourceMinimum,
} from "./media-qualification.js";
import { canonicalUuid, sameOptionalUuid, sameUuid } from "./uuid-identity.js";

type PublicObjectKind = PublicRevisionSelection["objectKind"];
type SafePath = readonly (string | number)[];
type ProjectionSource =
  | IdolPublicProjectionSource
  | GiftPublicProjectionSource
  | HomepagePublicProjectionSource
  | PolicyPublicProjectionSource;

function selectedPublicationTargetRevisionId(
  publication: PublicRevisionSelection["currentPublication"],
): string {
  switch (publication.objectKind) {
    case "IDOL":
      return publication.idolRevisionId;
    case "GIFT":
      return publication.giftRevisionId;
    case "HOMEPAGE":
      return publication.homepageRevisionId;
    case "POLICY":
      return publication.policyRevisionId;
  }
}

export type PublicProjectionResult<Value> =
  | Readonly<{ success: true; value: Value }>
  | Readonly<{
      success: false;
      issues: readonly PublicationValidationIssue[];
    }>;

type RuntimeSchema<Value> = Readonly<{
  safeParse: (input: unknown) =>
    | Readonly<{ success: true; data: Value }>
    | Readonly<{
        success: false;
        error: Readonly<{
          issues: readonly Readonly<{ path: readonly PropertyKey[] }>[];
        }>;
      }>;
}>;

type TranslationRow = Readonly<{
  id: string;
  locale: string;
  sourceHash: string;
  translatedFromSourceHash: string;
  origin: "HUMAN" | "MACHINE" | "IMPORT";
  importBatchId?: string | undefined;
  review:
    | Readonly<{ status: "DRAFT" }>
    | Readonly<{ status: "IN_REVIEW"; submittedAt: string }>
    | Readonly<{
        status: "APPROVED";
        reviewedSourceHash: string;
        reviewedContentHash: string;
      }>;
}>;

type MediaProjection = Readonly<{
  reference: Readonly<{
    role: string;
    sortOrder: number;
    mediaAssetId: string;
    mediaMetadataRevisionId: string;
  }>;
  media:
    | Readonly<{
        schemaVersion: 1;
        kind: "INFORMATIVE";
        url: string;
        alt: string;
        width: number;
        height: number;
        focalPoint: Readonly<{ x: number; y: number }>;
      }>
    | Readonly<{
        schemaVersion: 1;
        kind: "DECORATIVE";
        url: string;
        alt: "";
        width: number;
        height: number;
        focalPoint: Readonly<{ x: number; y: number }>;
      }>;
}>;

function issue(
  code: PublicationValidationIssue["code"],
  path: SafePath,
): PublicationValidationIssue {
  return { schemaVersion: 1, severity: "BLOCKER", code, path: [...path] };
}

function safeSchemaPath(path: readonly PropertyKey[]): (string | number)[] {
  return path.map((segment) =>
    typeof segment === "number" ? segment : String(segment),
  );
}

function parseInput<Value>(
  schema: RuntimeSchema<Value>,
  input: unknown,
  pathPrefix: string,
  issues: PublicationValidationIssue[],
): Value | undefined {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  issues.push(
    ...parsed.error.issues.map((schemaIssue) =>
      issue("SCHEMA_INVALID", [
        pathPrefix,
        ...safeSchemaPath(schemaIssue.path),
      ]),
    ),
  );
  return undefined;
}

function validateSelection(
  objectKind: PublicObjectKind,
  selection: PublicRevisionSelection,
  issues: PublicationValidationIssue[],
): boolean {
  if (selection.objectKind !== objectKind) {
    issues.push(issue("SCHEMA_INVALID", ["selection", "objectKind"]));
    return false;
  }
  if (
    "operationalStatus" in selection &&
    (selection.operationalStatus === "draft" ||
      selection.operationalStatus === "archived")
  ) {
    issues.push(issue("BASE_NOT_PUBLIC", ["selection", "operationalStatus"]));
  }
  if (
    "publishedRevisionId" in selection &&
    (selection.publishedRevisionId === null ||
      !sameUuid(selection.publishedRevisionId, selection.selectedRevisionId))
  ) {
    issues.push(
      issue("PUBLISHED_POINTER_MISMATCH", ["selection", "publishedRevisionId"]),
    );
  }
  if (
    canonicalUuid(
      selectedPublicationTargetRevisionId(selection.currentPublication),
    ) !== canonicalUuid(selection.selectedRevisionId)
  ) {
    issues.push(
      issue("PUBLISHED_POINTER_MISMATCH", ["selection", "currentPublication"]),
    );
  }

  const expectedLifecycle =
    selection.currentPublication.action === "PUBLISH"
      ? "PUBLISHED"
      : "SUPERSEDED";
  if (selection.selectedRevisionLifecycle !== expectedLifecycle) {
    issues.push(
      issue("PUBLIC_REVISION_NOT_ELIGIBLE", [
        "selection",
        "selectedRevisionLifecycle",
      ]),
    );
  }
  return true;
}

function validateTranslationBinding<Row extends TranslationRow>(
  selection: PublicRevisionSelection,
  row: Row,
  rowParentRevisionId: string,
  localeContext: ProjectionSource["localeContext"],
  computeContentHash: (row: Row) => string,
  issues: PublicationValidationIssue[],
): void {
  const manifest = selection.selectedTranslation;
  if (
    !sameUuid(rowParentRevisionId, selection.selectedRevisionId) ||
    !sameUuid(row.id, manifest.translationRevisionId) ||
    localeContext.translationRevision === undefined ||
    !sameUuid(localeContext.translationRevision, row.id)
  ) {
    issues.push(
      issue("PUBLIC_VIEW_TRANSLATION_MISMATCH", [
        "source",
        "translation",
        "id",
      ]),
    );
  }
  if (
    row.locale !== manifest.locale ||
    localeContext.resolvedLocale !== manifest.locale
  ) {
    issues.push(
      issue("PUBLIC_VIEW_LOCALE_MISMATCH", [
        "source",
        "localeContext",
        "resolvedLocale",
      ]),
    );
  }
  const contentHash = computeContentHash(row);
  if (
    row.review.status !== "APPROVED" ||
    row.sourceHash !== contentHash ||
    row.sourceHash !== manifest.approvedContentHash ||
    row.translatedFromSourceHash !== manifest.approvedSourceHash ||
    row.origin !== manifest.origin ||
    !sameOptionalUuid(row.importBatchId, manifest.importBatchId) ||
    (row.review.status === "APPROVED" &&
      (row.review.reviewedContentHash !== manifest.approvedContentHash ||
        row.review.reviewedSourceHash !== manifest.approvedSourceHash))
  ) {
    issues.push(
      issue("PUBLIC_VIEW_CONTENT_MISMATCH", ["source", "translation"]),
    );
  }
}

function mediaManifestFor(
  media: PublicMediaProjectionSource,
  manifests: readonly TranslationPublicationManifestEntry[],
): TranslationPublicationManifestEntry | undefined {
  const matches = manifests.filter(
    (manifest) =>
      manifest.objectKind === "MEDIA_METADATA" &&
      sameUuid(
        manifest.mediaMetadataRevisionId,
        media.mediaMetadataRevisionId,
      ) &&
      sameUuid(manifest.translationRevisionId, media.translation.id),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function expectedMediaAspectRatio(
  role: string,
): readonly [width: number, height: number] | undefined {
  switch (role) {
    case "PRIMARY":
      return [1, 1];
    case "PORTRAIT":
    case "HERO_MOBILE":
      return [4, 5];
    case "HERO":
    case "HERO_DESKTOP":
      return [16, 9];
    default:
      return undefined;
  }
}

function hasAspectRatio(
  width: number,
  height: number,
  expectedWidth: number,
  expectedHeight: number,
): boolean {
  return (
    BigInt(width) * BigInt(expectedHeight) ===
    BigInt(height) * BigInt(expectedWidth)
  );
}

function requiresInformativePresentation(role: string): boolean {
  return (
    role === "PRIMARY" ||
    role === "PORTRAIT" ||
    role === "HERO" ||
    role === "HERO_DESKTOP" ||
    role === "HERO_MOBILE"
  );
}

function projectMedia(
  references: readonly Readonly<{
    role: string;
    sortOrder: number;
    mediaAssetId: string;
    mediaMetadataRevisionId: string;
  }>[],
  mediaSources: readonly PublicMediaProjectionSource[],
  selection: PublicRevisionSelection,
  issues: PublicationValidationIssue[],
): readonly MediaProjection[] {
  const projected: MediaProjection[] = [];
  const usedManifestIds = new Set<string>();
  const referenceKeys = new Set<string>();
  const sortOrderKeys = new Set<string>();

  for (const [referenceIndex, reference] of references.entries()) {
    const referenceKey = `${reference.role}:${canonicalUuid(reference.mediaAssetId)}`;
    if (referenceKeys.has(referenceKey)) {
      issues.push(
        issue("MEDIA_REFERENCE_DUPLICATE", [
          "source",
          "mediaReferences",
          referenceIndex,
        ]),
      );
    }
    referenceKeys.add(referenceKey);
    const sortOrderKey = `${reference.role}:${reference.sortOrder}`;
    if (sortOrderKeys.has(sortOrderKey)) {
      issues.push(
        issue("MEDIA_SORT_ORDER_DUPLICATE", [
          "source",
          "mediaReferences",
          referenceIndex,
          "sortOrder",
        ]),
      );
    }
    sortOrderKeys.add(sortOrderKey);

    const matches = mediaSources.filter(
      (media) =>
        sameUuid(media.mediaAssetId, reference.mediaAssetId) &&
        sameUuid(
          media.mediaMetadataRevisionId,
          reference.mediaMetadataRevisionId,
        ),
    );
    if (matches.length !== 1) {
      issues.push(
        issue(
          matches.length === 0
            ? "MEDIA_ASSET_MISSING"
            : "MEDIA_REFERENCE_DUPLICATE",
          ["source", "mediaReferences", referenceIndex],
        ),
      );
      continue;
    }
    const media = matches[0]!;
    if (
      !sameUuid(media.asset.id, media.mediaAssetId) ||
      !sameUuid(media.variant.mediaAssetId, media.mediaAssetId) ||
      !sameUuid(media.metadataRevision.id, media.mediaMetadataRevisionId) ||
      !sameUuid(media.metadataRevision.mediaAssetId, media.mediaAssetId) ||
      !sameUuid(
        media.translation.mediaMetadataRevisionId,
        media.mediaMetadataRevisionId,
      )
    ) {
      issues.push(
        issue("MEDIA_METADATA_MISMATCH", ["source", "media", referenceIndex]),
      );
      continue;
    }
    if (media.asset.processingStatus !== "READY") {
      issues.push(
        issue("MEDIA_ASSET_NOT_READY", [
          "source",
          "media",
          referenceIndex,
          "asset",
        ]),
      );
    }
    if (media.asset.rightsStatus !== "APPROVED") {
      issues.push(
        issue("MEDIA_RIGHTS_NOT_APPROVED", [
          "source",
          "media",
          referenceIndex,
          "asset",
        ]),
      );
    }
    if (
      !meetsMediaRoleSourceMinimum(
        reference.role,
        media.asset.width,
        media.asset.height,
      )
    ) {
      issues.push(
        issue("MEDIA_SOURCE_DIMENSIONS_INVALID", [
          "source",
          "media",
          referenceIndex,
          "asset",
        ]),
      );
    }
    if (
      media.metadataRevision.lifecycle.status !== "PUBLISHED" &&
      media.metadataRevision.lifecycle.status !== "SUPERSEDED"
    ) {
      issues.push(
        issue("MEDIA_METADATA_NOT_PUBLISHABLE", [
          "source",
          "media",
          referenceIndex,
          "metadataRevision",
          "lifecycle",
        ]),
      );
    }
    if (media.variant.status !== "READY") {
      issues.push(
        issue("MEDIA_DERIVATIVE_NOT_READY", [
          "source",
          "media",
          referenceIndex,
          "variant",
        ]),
      );
    }
    if (
      !meetsMediaRoleDerivativeMinimum(
        reference.role,
        media.variant.width,
        media.variant.height,
      )
    ) {
      issues.push(
        issue("MEDIA_DERIVATIVE_USABLE_SIZE_MISSING", [
          "source",
          "media",
          referenceIndex,
          "variant",
        ]),
      );
    }
    if (
      media.variant.width > media.asset.width ||
      media.variant.height > media.asset.height
    ) {
      issues.push(
        issue("MEDIA_DERIVATIVE_DIMENSIONS_INVALID", [
          "source",
          "media",
          referenceIndex,
          "variant",
        ]),
      );
    }
    const expectedAspectRatio = expectedMediaAspectRatio(reference.role);
    if (
      expectedAspectRatio !== undefined &&
      !hasAspectRatio(
        media.asset.width,
        media.asset.height,
        expectedAspectRatio[0],
        expectedAspectRatio[1],
      )
    ) {
      issues.push(
        issue("MEDIA_SOURCE_ASPECT_RATIO_INVALID", [
          "source",
          "media",
          referenceIndex,
          "asset",
        ]),
      );
    }
    if (
      expectedAspectRatio !== undefined &&
      !hasAspectRatio(
        media.variant.width,
        media.variant.height,
        expectedAspectRatio[0],
        expectedAspectRatio[1],
      )
    ) {
      issues.push(
        issue("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID", [
          "source",
          "media",
          referenceIndex,
          "variant",
        ]),
      );
    }

    const manifest = mediaManifestFor(
      media,
      selection.selectedMediaTranslations,
    );
    if (manifest === undefined || manifest.objectKind !== "MEDIA_METADATA") {
      issues.push(
        issue("PUBLIC_VIEW_TRANSLATION_MISMATCH", [
          "selection",
          "selectedMediaTranslations",
        ]),
      );
      continue;
    }
    usedManifestIds.add(manifest.translationRevisionId.toLowerCase());
    const mediaContentHash = computeMediaTranslationContentHash(
      media.translation,
    );
    if (
      media.translation.locale !== manifest.locale ||
      media.translation.locale !== selection.selectedTranslation.locale
    ) {
      issues.push(
        issue("PUBLIC_VIEW_LOCALE_MISMATCH", [
          "source",
          "media",
          referenceIndex,
          "translation",
          "locale",
        ]),
      );
    }
    if (
      media.translation.review.status !== "APPROVED" ||
      media.translation.sourceHash !== mediaContentHash ||
      media.translation.sourceHash !== manifest.approvedContentHash ||
      media.translation.translatedFromSourceHash !==
        manifest.approvedSourceHash ||
      media.translation.origin !== manifest.origin ||
      !sameOptionalUuid(
        media.translation.importBatchId,
        manifest.importBatchId,
      ) ||
      (media.translation.review.status === "APPROVED" &&
        (media.translation.review.reviewedContentHash !==
          manifest.approvedContentHash ||
          media.translation.review.reviewedSourceHash !==
            manifest.approvedSourceHash))
    ) {
      issues.push(
        issue("PUBLIC_VIEW_CONTENT_MISMATCH", [
          "source",
          "media",
          referenceIndex,
          "translation",
        ]),
      );
    }
    if (
      media.metadataRevision.presentationKind === "INFORMATIVE" &&
      !hasVisibleText(media.translation.alt)
    ) {
      issues.push(
        issue("MEDIA_ALT_MISSING", [
          "source",
          "media",
          referenceIndex,
          "translation",
          "alt",
        ]),
      );
    }
    if (
      requiresInformativePresentation(reference.role) &&
      media.metadataRevision.presentationKind !== "INFORMATIVE"
    ) {
      issues.push(
        issue("MEDIA_PRESENTATION_KIND_INVALID", [
          "source",
          "media",
          referenceIndex,
          "metadataRevision",
          "presentationKind",
        ]),
      );
    }
    const publicMediaGeometry = {
      width: media.variant.width,
      height: media.variant.height,
      focalPoint: media.metadataRevision.focalPoint,
    };
    projected.push({
      reference,
      media:
        media.metadataRevision.presentationKind === "INFORMATIVE"
          ? {
              schemaVersion: 1,
              kind: "INFORMATIVE",
              url: media.url,
              alt: media.translation.alt,
              ...publicMediaGeometry,
            }
          : {
              schemaVersion: 1,
              kind: "DECORATIVE",
              url: media.url,
              alt: "",
              ...publicMediaGeometry,
            },
    });
  }

  if (
    selection.selectedMediaTranslations.some(
      (manifest) =>
        manifest.objectKind !== "MEDIA_METADATA" ||
        !usedManifestIds.has(manifest.translationRevisionId.toLowerCase()),
    )
  ) {
    issues.push(
      issue("PUBLIC_VIEW_TRANSLATION_MISMATCH", [
        "selection",
        "selectedMediaTranslations",
      ]),
    );
  }
  return projected;
}

function mediaForRole(
  projected: readonly MediaProjection[],
  role: string,
  issues: PublicationValidationIssue[],
): MediaProjection["media"] | undefined {
  const matches = projected.filter((entry) => entry.reference.role === role);
  if (matches.length !== 1) {
    issues.push(
      issue(
        matches.length === 0
          ? "MEDIA_REQUIRED_ROLE_MISSING"
          : "MEDIA_REQUIRED_ROLE_DUPLICATE",
        ["source", "mediaReferences", role],
      ),
    );
    return undefined;
  }
  return matches[0]!.media;
}

function finishProjection<Value>(
  schema: RuntimeSchema<Value>,
  rawView: unknown,
  issues: PublicationValidationIssue[],
): PublicProjectionResult<Value> {
  const view = parseInput(schema, rawView, "view", issues);
  if (view === undefined || issues.length > 0) {
    return { success: false, issues };
  }
  return { success: true, value: view };
}

function parseSelectionAndSource<Source extends ProjectionSource>(
  objectKind: PublicObjectKind,
  selectionInput: unknown,
  sourceInput: unknown,
  sourceSchema: RuntimeSchema<Source>,
): Readonly<{
  selection: PublicRevisionSelection | undefined;
  source: Source | undefined;
  issues: PublicationValidationIssue[];
}> {
  const issues: PublicationValidationIssue[] = [];
  const selection = parseInput(
    publicRevisionSelectionSchema,
    selectionInput,
    "selection",
    issues,
  );
  if (selection !== undefined) {
    validateSelection(objectKind, selection, issues);
  }
  const source = parseInput(sourceSchema, sourceInput, "source", issues);
  return { selection, source, issues };
}

export function selectPublishedIdol(
  selectionInput: unknown,
  sourceInput: unknown,
): PublicProjectionResult<PublishedIdolView> {
  const parsed = parseSelectionAndSource(
    "IDOL",
    selectionInput,
    sourceInput,
    idolPublicProjectionSourceSchema,
  );
  const { selection, source, issues } = parsed;
  if (
    selection === undefined ||
    selection.objectKind !== "IDOL" ||
    source === undefined
  ) {
    return { success: false, issues };
  }

  if (
    !sameUuid(source.base.id, selection.idolId) ||
    !sameUuid(source.revision.idolId, selection.idolId)
  ) {
    issues.push(issue("PUBLIC_VIEW_IDENTITY_MISMATCH", ["source"]));
  }
  if (
    source.base.status !== selection.operationalStatus ||
    source.base.acceptingGifts !== selection.acceptingGifts
  ) {
    issues.push(issue("PUBLIC_VIEW_STATUS_MISMATCH", ["source", "base"]));
  }
  if (
    source.base.publishedRevisionId === null ||
    !sameUuid(source.base.publishedRevisionId, selection.selectedRevisionId) ||
    !sameUuid(source.revision.id, selection.selectedRevisionId)
  ) {
    issues.push(issue("PUBLISHED_POINTER_MISMATCH", ["source", "revision"]));
  }
  if (
    source.revision.lifecycle.status !== selection.selectedRevisionLifecycle
  ) {
    issues.push(
      issue("PUBLIC_REVISION_NOT_ELIGIBLE", [
        "source",
        "revision",
        "lifecycle",
      ]),
    );
  }
  validateTranslationBinding(
    selection,
    source.translation,
    source.translation.idolRevisionId,
    source.localeContext,
    computeIdolTranslationContentHash,
    issues,
  );

  const revisionReferences = source.mediaReferences.filter((reference) => {
    if (!sameUuid(reference.idolRevisionId, source.revision.id)) {
      issues.push(
        issue("MEDIA_REFERENCE_PARENT_MISMATCH", ["source", "mediaReferences"]),
      );
      return false;
    }
    return true;
  });
  const projectedMedia = projectMedia(
    revisionReferences,
    source.media,
    selection,
    issues,
  );
  const portrait = mediaForRole(projectedMedia, "PORTRAIT", issues);
  const heroDesktop = mediaForRole(projectedMedia, "HERO_DESKTOP", issues);
  const heroMobile = mediaForRole(projectedMedia, "HERO_MOBILE", issues);
  const gallery = projectedMedia
    .filter((entry) => entry.reference.role === "GALLERY")
    .toSorted(
      (left, right) => left.reference.sortOrder - right.reference.sortOrder,
    )
    .map((entry) => entry.media);

  if (
    portrait === undefined ||
    heroDesktop === undefined ||
    heroMobile === undefined
  ) {
    return { success: false, issues };
  }
  return finishProjection(
    publishedIdolViewSchema,
    {
      schemaVersion: 1,
      id: source.base.id,
      handle: source.base.handle,
      status: selection.operationalStatus,
      acceptingGifts: selection.acceptingGifts,
      localeContext: source.localeContext,
      displayName: source.translation.displayName,
      shortBio: source.translation.shortBio,
      fullBio: source.translation.fullBio,
      seoTitle: source.translation.seoTitle,
      seoDescription: source.translation.seoDescription,
      themeAccent: source.revision.themeAccent,
      heroTextTone: source.revision.heroTextTone,
      portrait,
      heroDesktop,
      heroMobile,
      gallery,
    },
    issues,
  );
}

export function selectPublishedGift(
  selectionInput: unknown,
  sourceInput: unknown,
): PublicProjectionResult<PublishedGiftView> {
  const parsed = parseSelectionAndSource(
    "GIFT",
    selectionInput,
    sourceInput,
    giftPublicProjectionSourceSchema,
  );
  const { selection, source, issues } = parsed;
  if (
    selection === undefined ||
    selection.objectKind !== "GIFT" ||
    source === undefined
  ) {
    return { success: false, issues };
  }

  if (
    !sameUuid(source.base.id, selection.giftId) ||
    !sameUuid(source.revision.giftId, selection.giftId)
  ) {
    issues.push(issue("PUBLIC_VIEW_IDENTITY_MISMATCH", ["source"]));
  }
  if (source.base.status !== selection.operationalStatus) {
    issues.push(
      issue("PUBLIC_VIEW_STATUS_MISMATCH", ["source", "base", "status"]),
    );
  }
  if (
    source.base.publishedRevisionId === null ||
    !sameUuid(source.base.publishedRevisionId, selection.selectedRevisionId) ||
    !sameUuid(source.revision.id, selection.selectedRevisionId)
  ) {
    issues.push(issue("PUBLISHED_POINTER_MISMATCH", ["source", "revision"]));
  }
  if (
    source.revision.lifecycle.status !== selection.selectedRevisionLifecycle
  ) {
    issues.push(
      issue("PUBLIC_REVISION_NOT_ELIGIBLE", [
        "source",
        "revision",
        "lifecycle",
      ]),
    );
  }
  validateTranslationBinding(
    selection,
    source.translation,
    source.translation.giftRevisionId,
    source.localeContext,
    computeGiftTranslationContentHash,
    issues,
  );

  const revisionReferences = source.mediaReferences.filter((reference) => {
    if (!sameUuid(reference.giftRevisionId, source.revision.id)) {
      issues.push(
        issue("MEDIA_REFERENCE_PARENT_MISMATCH", ["source", "mediaReferences"]),
      );
      return false;
    }
    return true;
  });
  const projectedMedia = projectMedia(
    revisionReferences,
    source.media,
    selection,
    issues,
  );
  const primaryMedia = mediaForRole(projectedMedia, "PRIMARY", issues);
  const gallery = projectedMedia
    .filter((entry) => entry.reference.role === "GALLERY")
    .toSorted(
      (left, right) => left.reference.sortOrder - right.reference.sortOrder,
    )
    .map((entry) => entry.media);
  const labelByVariantId = new Map(
    source.translation.variantLabels.map((entry) => [
      canonicalUuid(entry.giftVariantId),
      entry.label,
    ]),
  );
  const variants = source.variants
    .filter(
      (variant) => variant.status === "active" || variant.status === "paused",
    )
    .map((variant, index) => {
      const label = labelByVariantId.get(canonicalUuid(variant.id));
      if (!sameUuid(variant.giftId, source.base.id) || label === undefined) {
        issues.push(
          issue("VARIANT_LABEL_MISMATCH", ["source", "variants", index]),
        );
      }
      return {
        schemaVersion: 1 as const,
        id: variant.id,
        label: label ?? "",
        status: variant.status,
        inventoryPolicy: variant.inventoryPolicy,
      };
    });
  if (
    selection.operationalStatus === "active" &&
    !variants.some((variant) => variant.status === "active")
  ) {
    issues.push(issue("VARIANT_SELLABLE_MISSING", ["source", "variants"]));
  }

  if (primaryMedia === undefined) {
    return { success: false, issues };
  }
  return finishProjection(
    publishedGiftViewSchema,
    {
      schemaVersion: 1,
      id: source.base.id,
      handle: source.base.handle,
      status: selection.operationalStatus,
      localeContext: source.localeContext,
      title: source.translation.title,
      subtitle: source.translation.subtitle,
      shortDescription: source.translation.shortDescription,
      description: source.translation.description,
      fulfillmentDescription: source.translation.fulfillmentDescription,
      category: source.revision.category,
      contents: source.revision.contents,
      deliveryEstimate: source.revision.deliveryEstimate,
      shippingMode: source.revision.shippingMode,
      primaryMedia,
      gallery,
      variants,
      safetyNotice: source.translation.safetyNotice,
      seoTitle: source.translation.seoTitle,
      seoDescription: source.translation.seoDescription,
    },
    issues,
  );
}

export function selectPublishedHomepage(
  selectionInput: unknown,
  sourceInput: unknown,
): PublicProjectionResult<PublishedHomepageView> {
  const parsed = parseSelectionAndSource(
    "HOMEPAGE",
    selectionInput,
    sourceInput,
    homepagePublicProjectionSourceSchema,
  );
  const { selection, source, issues } = parsed;
  if (
    selection === undefined ||
    selection.objectKind !== "HOMEPAGE" ||
    source === undefined
  ) {
    return { success: false, issues };
  }

  if (!sameUuid(source.revision.id, selection.selectedRevisionId)) {
    issues.push(
      issue("PUBLISHED_POINTER_MISMATCH", ["source", "revision", "id"]),
    );
  }
  if (
    source.revision.lifecycle.status !== selection.selectedRevisionLifecycle
  ) {
    issues.push(
      issue("PUBLIC_REVISION_NOT_ELIGIBLE", [
        "source",
        "revision",
        "lifecycle",
      ]),
    );
  }
  validateTranslationBinding(
    selection,
    source.translation,
    source.translation.homepageRevisionId,
    source.localeContext,
    computeHomepageTranslationContentHash,
    issues,
  );

  const labelBySlotKey = new Map(
    source.translation.slotLabels.map((entry) => [entry.slotKey, entry.label]),
  );
  const publicSlots = source.slots
    .filter((slot) => {
      if (!sameUuid(slot.homepageRevisionId, source.revision.id)) {
        issues.push(
          issue("HOMEPAGE_SLOT_PARENT_MISMATCH", ["source", "slots"]),
        );
        return false;
      }
      return true;
    })
    .map((slot, index) => {
      const label = labelBySlotKey.get(slot.slotKey);
      if (label === undefined) {
        issues.push(
          issue("HOMEPAGE_SLOT_LABEL_MISMATCH", ["source", "slots", index]),
        );
      }
      const common = {
        schemaVersion: 1 as const,
        slotKey: slot.slotKey,
        label: label ?? "",
        sortOrder: slot.sortOrder,
        kind: slot.kind,
      };
      return slot.kind === "HERO_IDOL" || slot.kind === "FEATURED_IDOL"
        ? { ...common, idolId: slot.idolId }
        : slot.kind === "FEATURED_GIFT"
          ? { ...common, giftId: slot.giftId }
          : { ...common, policyKey: slot.policyKey };
    })
    .toSorted((left, right) => left.sortOrder - right.sortOrder);
  if (
    publicSlots.length !== source.translation.slotLabels.length ||
    new Set(source.translation.slotLabels.map((entry) => entry.slotKey))
      .size !== source.translation.slotLabels.length
  ) {
    issues.push(
      issue("HOMEPAGE_SLOT_LABEL_MISMATCH", [
        "source",
        "translation",
        "slotLabels",
      ]),
    );
  }

  const heroReferences = source.slots.filter(
    (slot) => slot.kind === "HERO_IDOL",
  );
  const projectedMedia = projectMedia(
    heroReferences.flatMap((reference) => [
      {
        role: "HERO_DESKTOP",
        sortOrder: reference.sortOrder,
        mediaAssetId: reference.desktopMediaAssetId,
        mediaMetadataRevisionId: reference.desktopMediaMetadataRevisionId,
      },
      {
        role: "HERO_MOBILE",
        sortOrder: reference.sortOrder,
        mediaAssetId: reference.mobileMediaAssetId,
        mediaMetadataRevisionId: reference.mobileMediaMetadataRevisionId,
      },
    ]),
    source.media,
    selection,
    issues,
  );
  const heroDesktop = mediaForRole(projectedMedia, "HERO_DESKTOP", issues);
  const heroMobile = mediaForRole(projectedMedia, "HERO_MOBILE", issues);
  if (
    heroReferences.length !== 1 ||
    heroDesktop === undefined ||
    heroMobile === undefined
  ) {
    issues.push(issue("HOMEPAGE_HERO_INVALID", ["source", "slots"]));
    return { success: false, issues };
  }

  return finishProjection(
    publishedHomepageViewSchema,
    {
      schemaVersion: 1,
      localeContext: source.localeContext,
      heroTitle: source.translation.heroTitle,
      heroSubtitle: source.translation.heroSubtitle,
      ctaLabel: source.translation.ctaLabel,
      announcement: source.translation.announcement,
      heroDesktop,
      heroMobile,
      slots: publicSlots,
      seoTitle: source.translation.seoTitle,
      seoDescription: source.translation.seoDescription,
    },
    issues,
  );
}

export function selectPublishedPolicy(
  selectionInput: unknown,
  sourceInput: unknown,
): PublicProjectionResult<PublishedPolicyView> {
  const parsed = parseSelectionAndSource(
    "POLICY",
    selectionInput,
    sourceInput,
    policyPublicProjectionSourceSchema,
  );
  const { selection, source, issues } = parsed;
  if (
    selection === undefined ||
    selection.objectKind !== "POLICY" ||
    source === undefined
  ) {
    return { success: false, issues };
  }

  if (
    !sameUuid(source.revision.id, selection.selectedRevisionId) ||
    source.revision.policyKey !== selection.policyKey
  ) {
    issues.push(issue("PUBLIC_VIEW_IDENTITY_MISMATCH", ["source", "revision"]));
  }
  if (
    source.revision.lifecycle.status !== selection.selectedRevisionLifecycle
  ) {
    issues.push(
      issue("PUBLIC_REVISION_NOT_ELIGIBLE", [
        "source",
        "revision",
        "lifecycle",
      ]),
    );
  }
  validateTranslationBinding(
    selection,
    source.translation,
    source.translation.policyRevisionId,
    source.localeContext,
    computePolicyTranslationContentHash,
    issues,
  );

  return finishProjection(
    publishedPolicyViewSchema,
    {
      schemaVersion: 1,
      policyKey: source.revision.policyKey,
      kind: source.revision.kind,
      localeContext: source.localeContext,
      title: source.translation.title,
      summary: source.translation.summary,
      body: source.translation.body,
      effectiveAt: source.revision.effectiveAt,
    },
    issues,
  );
}
