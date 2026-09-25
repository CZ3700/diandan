import {
  hasVisibleText,
  homepagePublicationCandidateSchema,
  idolPublicationCandidateSchema,
  policyPublicationCandidateSchema,
  publicationValidationReportSchema,
} from "@fan-support/contracts";
import type {
  HomepagePublicationCandidate,
  IdolPublicationCandidate,
  MediaMetadataRevisionTranslation,
  PolicyPublicationCandidate,
  PublicationValidationIssue,
  PublicationValidationReport,
  TranslationApprovalEvidence,
} from "@fan-support/contracts";

import {
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";
import {
  meetsMediaRoleDerivativeMinimum,
  validateIdolMediaQualification,
} from "./media-qualification.js";
import {
  parseApprovalEvidence,
  publicationIssue as issue,
  safeSchemaPath,
  validateCurrentPublicationEvidence,
  validatePublicationLifecycle,
  validateReferencedMediaLifecycle,
  validateTranslationPackage,
} from "./publication-validation.js";
import { canonicalUuid, sameUuid } from "./uuid-identity.js";

type NonGiftObjectKind = "IDOL" | "HOMEPAGE" | "POLICY";

function report(
  objectKind: NonGiftObjectKind,
  issues: readonly PublicationValidationIssue[],
): PublicationValidationReport {
  return publicationValidationReportSchema.parse({
    schemaVersion: 1,
    objectKind,
    publishable: !issues.some(
      (candidateIssue) => candidateIssue.severity === "BLOCKER",
    ),
    issues,
  });
}

function validateIdolTranslations(
  candidate: IdolPublicationCandidate,
  approvals: readonly TranslationApprovalEvidence[],
  issues: PublicationValidationIssue[],
): void {
  validateTranslationPackage({
    objectKind: "IDOL",
    parentRevisionId: candidate.revision.id,
    rows: candidate.translations,
    approvals,
    computeContentHash: computeIdolTranslationContentHash,
    parentRevisionIdOf: (row) => row.idolRevisionId,
    evaluatedAt: candidate.evaluatedAt,
    issues,
    pathPrefix: ["translations"],
  });
}

function validateMediaTranslationPackages(
  metadataRevisionIds: ReadonlySet<string>,
  informativeMetadataRevisionIds: ReadonlySet<string>,
  rows: readonly MediaMetadataRevisionTranslation[],
  approvals: readonly TranslationApprovalEvidence[],
  issues: PublicationValidationIssue[],
  evaluatedAt: string,
): void {
  const canonicalMetadataRevisionIds = new Set(
    [...metadataRevisionIds].map(canonicalUuid),
  );
  const canonicalInformativeMetadataRevisionIds = new Set(
    [...informativeMetadataRevisionIds].map(canonicalUuid),
  );
  for (const [index, row] of rows.entries()) {
    if (
      !canonicalMetadataRevisionIds.has(
        canonicalUuid(row.mediaMetadataRevisionId),
      )
    ) {
      issues.push(
        issue("TRANSLATION_PARENT_MISMATCH", [
          "mediaTranslations",
          index,
          "mediaMetadataRevisionId",
        ]),
      );
    }
  }

  for (const metadataRevisionId of canonicalMetadataRevisionIds) {
    const translations = rows.filter(
      (translation) =>
        canonicalUuid(translation.mediaMetadataRevisionId) ===
        metadataRevisionId,
    );
    validateTranslationPackage({
      objectKind: "MEDIA_METADATA",
      parentRevisionId: metadataRevisionId,
      rows: translations,
      approvals,
      computeContentHash: computeMediaTranslationContentHash,
      parentRevisionIdOf: (row) => row.mediaMetadataRevisionId,
      evaluatedAt,
      issues,
      pathPrefix: ["mediaTranslations", metadataRevisionId],
    });
    if (canonicalInformativeMetadataRevisionIds.has(metadataRevisionId)) {
      for (const [translationIndex, translation] of translations.entries()) {
        if (!hasVisibleText(translation.alt)) {
          issues.push(
            issue("MEDIA_ALT_MISSING", [
              "mediaTranslations",
              metadataRevisionId,
              translationIndex,
              "alt",
            ]),
          );
        }
      }
    }
  }
}

function validateIdolIdentityAndMedia(
  candidate: IdolPublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  if (candidate.base.status === "archived") {
    issues.push(issue("BASE_ARCHIVED", ["base", "status"]));
  }
  if (!sameUuid(candidate.revision.idolId, candidate.base.id)) {
    issues.push(issue("REVISION_PARENT_MISMATCH", ["revision", "idolId"]));
  }
  if (
    candidate.currentPublication !== null &&
    candidate.currentPublication.idolId.toLowerCase() !==
      candidate.base.id.toLowerCase()
  ) {
    issues.push(
      issue("CURRENT_PUBLICATION_EVIDENCE_MISMATCH", [
        "currentPublication",
        "idolId",
      ]),
    );
  }
  validateCurrentPublicationEvidence({
    action: candidate.action,
    currentPublication: candidate.currentPublication,
    currentPublishedRevisionId: candidate.base.publishedRevisionId,
    targetRevisionId: candidate.revision.id,
    issues,
    currentRevisionPath: ["base", "publishedRevisionId"],
  });
  validatePublicationLifecycle({
    action: candidate.action,
    lifecycle: candidate.revision.lifecycle,
    createdAt: candidate.revision.createdAt,
    evaluatedAt: candidate.evaluatedAt,
    issues,
  });
  if (
    candidate.targetAcceptingGifts &&
    candidate.targetOperationalStatus !== "active"
  ) {
    issues.push(
      issue("TARGET_OPERATIONAL_STATE_INVALID", ["targetAcceptingGifts"]),
    );
  }
  if (
    candidate.action === "PUBLISH" &&
    (candidate.base.draftRevisionId === null ||
      !sameUuid(candidate.base.draftRevisionId, candidate.revision.id))
  ) {
    issues.push(issue("DRAFT_POINTER_MISMATCH", ["base", "draftRevisionId"]));
  }

  for (const mediaIssue of validateIdolMediaQualification({
    revisionId: candidate.revision.id,
    references: candidate.mediaReferences,
    assets: candidate.mediaAssets,
    variants: candidate.mediaVariants,
    metadataRevisions: candidate.mediaMetadataRevisions,
  })) {
    issues.push(issue(mediaIssue.code, mediaIssue.path));
  }
  validateReferencedMediaLifecycle({
    action: candidate.action,
    referencedMetadataRevisionIds: new Set(
      candidate.mediaReferences
        .filter((reference) =>
          sameUuid(reference.idolRevisionId, candidate.revision.id),
        )
        .map((reference) => canonicalUuid(reference.mediaMetadataRevisionId)),
    ),
    metadataRevisions: candidate.mediaMetadataRevisions,
    evaluatedAt: candidate.evaluatedAt,
    issues,
  });
}

function validateHomepageTranslations(
  candidate: HomepagePublicationCandidate,
  approvals: readonly TranslationApprovalEvidence[],
  issues: PublicationValidationIssue[],
): void {
  validateTranslationPackage({
    objectKind: "HOMEPAGE",
    parentRevisionId: candidate.revision.id,
    rows: candidate.translations,
    approvals,
    computeContentHash: computeHomepageTranslationContentHash,
    parentRevisionIdOf: (row) => row.homepageRevisionId,
    evaluatedAt: candidate.evaluatedAt,
    issues,
    pathPrefix: ["translations"],
  });
}

function validateHomepageSlotsAndReferences(
  candidate: HomepagePublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  validateCurrentPublicationEvidence({
    action: candidate.action,
    currentPublication: candidate.currentPublication,
    currentPublishedRevisionId: candidate.currentPublishedRevisionId,
    targetRevisionId: candidate.revision.id,
    issues,
    currentRevisionPath: ["currentPublishedRevisionId"],
  });
  validatePublicationLifecycle({
    action: candidate.action,
    lifecycle: candidate.revision.lifecycle,
    createdAt: candidate.revision.createdAt,
    evaluatedAt: candidate.evaluatedAt,
    issues,
  });

  const slotKeys = new Set<string>();
  const slotSortOrders = new Set<number>();
  for (const [index, slot] of candidate.slots.entries()) {
    if (!sameUuid(slot.homepageRevisionId, candidate.revision.id)) {
      issues.push(
        issue("HOMEPAGE_SLOT_PARENT_MISMATCH", [
          "slots",
          index,
          "homepageRevisionId",
        ]),
      );
    }
    if (slotKeys.has(slot.slotKey)) {
      issues.push(
        issue("HOMEPAGE_SLOT_DUPLICATE", ["slots", index, "slotKey"]),
      );
    }
    slotKeys.add(slot.slotKey);
    if (slotSortOrders.has(slot.sortOrder)) {
      issues.push(
        issue("HOMEPAGE_SLOT_DUPLICATE", ["slots", index, "sortOrder"]),
      );
    }
    slotSortOrders.add(slot.sortOrder);

    if (slot.kind === "HERO_IDOL" || slot.kind === "FEATURED_IDOL") {
      const matches = candidate.referencedIdols.filter((idol) =>
        sameUuid(idol.id, slot.idolId),
      );
      if (
        matches.length !== 1 ||
        matches[0]?.status !== "active" ||
        matches[0].publishedRevisionId === null
      ) {
        issues.push(
          issue("HOMEPAGE_REFERENCE_NOT_PUBLIC", ["slots", index, "idolId"]),
        );
      }
    } else if (slot.kind === "FEATURED_GIFT") {
      const matches = candidate.referencedGifts.filter((gift) =>
        sameUuid(gift.id, slot.giftId),
      );
      if (
        matches.length !== 1 ||
        matches[0]?.status !== "active" ||
        matches[0].publishedRevisionId === null
      ) {
        issues.push(
          issue("HOMEPAGE_REFERENCE_NOT_PUBLIC", ["slots", index, "giftId"]),
        );
      }
    } else {
      const matches = candidate.referencedPolicies.filter(
        (policy) => policy.policyKey === slot.policyKey,
      );
      if (matches.length !== 1) {
        issues.push(
          issue("HOMEPAGE_REFERENCE_NOT_PUBLIC", ["slots", index, "policyKey"]),
        );
      }
    }
  }

  if (
    candidate.slots.filter((slot) => slot.kind === "HERO_IDOL").length !== 1
  ) {
    issues.push(issue("HOMEPAGE_HERO_INVALID", ["slots"]));
  }

  for (const [
    translationIndex,
    translation,
  ] of candidate.translations.entries()) {
    const labelKeys = translation.slotLabels.map((label) => label.slotKey);
    const uniqueLabelKeys = new Set(labelKeys);
    const labelsMatchSlots =
      labelKeys.length === slotKeys.size &&
      uniqueLabelKeys.size === slotKeys.size &&
      [...slotKeys].every((slotKey) => uniqueLabelKeys.has(slotKey));
    if (!labelsMatchSlots) {
      issues.push(
        issue("HOMEPAGE_SLOT_LABEL_MISMATCH", [
          "translations",
          translationIndex,
          "slotLabels",
        ]),
      );
    }
  }
}

function hasExactAspectRatio(
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

type HomepageHeroMediaBinding = Readonly<{
  role: "HERO_DESKTOP" | "HERO_MOBILE";
  assetId: string;
  metadataRevisionId: string;
  assetField: "desktopMediaAssetId" | "mobileMediaAssetId";
  metadataField:
    "desktopMediaMetadataRevisionId" | "mobileMediaMetadataRevisionId";
  minimumWidth: number;
  minimumHeight: number;
  aspectWidth: number;
  aspectHeight: number;
}>;

function validateHomepageHeroMediaBinding(
  candidate: HomepagePublicationCandidate,
  slotKey: string,
  binding: HomepageHeroMediaBinding,
  issues: PublicationValidationIssue[],
): void {
  const assetPath = ["slots", slotKey, binding.assetField] as const;
  const metadataPath = ["slots", slotKey, binding.metadataField] as const;
  const assetMatches = candidate.mediaAssets.filter((asset) =>
    sameUuid(asset.id, binding.assetId),
  );
  if (assetMatches.length !== 1) {
    issues.push(
      issue(
        assetMatches.length === 0
          ? "MEDIA_ASSET_MISSING"
          : "MEDIA_ASSET_DUPLICATE",
        assetPath,
      ),
    );
    return;
  }
  const asset = assetMatches[0]!;
  if (asset.processingStatus !== "READY") {
    issues.push(issue("MEDIA_ASSET_NOT_READY", assetPath));
  }
  if (asset.rightsStatus !== "APPROVED") {
    issues.push(issue("MEDIA_RIGHTS_NOT_APPROVED", assetPath));
  }
  if (
    asset.width < binding.minimumWidth ||
    asset.height < binding.minimumHeight
  ) {
    issues.push(issue("MEDIA_SOURCE_DIMENSIONS_INVALID", assetPath));
  }
  if (
    !hasExactAspectRatio(
      asset.width,
      asset.height,
      binding.aspectWidth,
      binding.aspectHeight,
    )
  ) {
    issues.push(issue("MEDIA_SOURCE_ASPECT_RATIO_INVALID", assetPath));
  }

  const metadataMatches = candidate.mediaMetadataRevisions.filter((metadata) =>
    sameUuid(metadata.id, binding.metadataRevisionId),
  );
  if (metadataMatches.length !== 1) {
    issues.push(
      issue(
        metadataMatches.length === 0
          ? "MEDIA_METADATA_MISSING"
          : "MEDIA_METADATA_DUPLICATE",
        metadataPath,
      ),
    );
    return;
  }
  const metadata = metadataMatches[0]!;
  if (!sameUuid(metadata.mediaAssetId, asset.id)) {
    issues.push(issue("MEDIA_METADATA_MISMATCH", metadataPath));
  }
  if (
    metadata.lifecycle.status === "DRAFT" ||
    metadata.lifecycle.status === "ARCHIVED"
  ) {
    issues.push(issue("MEDIA_METADATA_NOT_PUBLISHABLE", metadataPath));
  }
  if (metadata.presentationKind !== "INFORMATIVE") {
    issues.push(issue("MEDIA_PRESENTATION_KIND_INVALID", metadataPath));
  }

  for (const format of ["AVIF", "WEBP", "JPEG"] as const) {
    const variants = candidate.mediaVariants.filter(
      (variant) =>
        sameUuid(variant.mediaAssetId, asset.id) && variant.format === format,
    );
    const formatPath = [...assetPath, format] as const;
    if (variants.length === 0) {
      issues.push(issue("MEDIA_DERIVATIVE_MISSING", formatPath));
      continue;
    }
    const readyVariants = variants.filter(
      (variant) => variant.status === "READY",
    );
    if (readyVariants.length === 0) {
      issues.push(issue("MEDIA_DERIVATIVE_NOT_READY", formatPath));
    }
    if (
      !readyVariants.some((variant) =>
        meetsMediaRoleDerivativeMinimum(
          binding.role,
          variant.width,
          variant.height,
        ),
      )
    ) {
      issues.push(issue("MEDIA_DERIVATIVE_USABLE_SIZE_MISSING", formatPath));
    }
    for (const variant of variants) {
      if (variant.status !== "READY" && variant.status !== "PROCESSING") {
        continue;
      }
      if (variant.width > asset.width || variant.height > asset.height) {
        issues.push(issue("MEDIA_DERIVATIVE_DIMENSIONS_INVALID", formatPath));
      }
      if (
        !hasExactAspectRatio(
          variant.width,
          variant.height,
          binding.aspectWidth,
          binding.aspectHeight,
        )
      ) {
        issues.push(issue("MEDIA_DERIVATIVE_ASPECT_RATIO_INVALID", formatPath));
      }
    }
  }
}

function validateHomepageHeroMedia(
  candidate: HomepagePublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  const heroSlots = candidate.slots.filter((slot) => slot.kind === "HERO_IDOL");
  validateReferencedMediaLifecycle({
    action: candidate.action,
    referencedMetadataRevisionIds: new Set(
      heroSlots.flatMap((slot) => [
        canonicalUuid(slot.desktopMediaMetadataRevisionId),
        canonicalUuid(slot.mobileMediaMetadataRevisionId),
      ]),
    ),
    metadataRevisions: candidate.mediaMetadataRevisions,
    evaluatedAt: candidate.evaluatedAt,
    issues,
  });

  const variantIds = new Set<string>();
  const derivativeKeys = new Set<string>();
  for (const [variantIndex, variant] of candidate.mediaVariants.entries()) {
    const variantId = canonicalUuid(variant.id);
    if (variantIds.has(variantId)) {
      issues.push(
        issue("MEDIA_VARIANT_ID_DUPLICATE", [
          "mediaVariants",
          variantIndex,
          "id",
        ]),
      );
    }
    variantIds.add(variantId);
    const derivativeKey = `${canonicalUuid(variant.mediaAssetId)}:${variant.format}:${variant.width}:${variant.height}`;
    if (derivativeKeys.has(derivativeKey)) {
      issues.push(
        issue("MEDIA_DERIVATIVE_DUPLICATE", [
          "mediaVariants",
          variantIndex,
          "width",
        ]),
      );
    }
    derivativeKeys.add(derivativeKey);
  }

  for (const hero of heroSlots) {
    const bindings: readonly HomepageHeroMediaBinding[] = [
      {
        role: "HERO_DESKTOP",
        assetId: hero.desktopMediaAssetId,
        metadataRevisionId: hero.desktopMediaMetadataRevisionId,
        assetField: "desktopMediaAssetId",
        metadataField: "desktopMediaMetadataRevisionId",
        minimumWidth: 2_400,
        minimumHeight: 1_350,
        aspectWidth: 16,
        aspectHeight: 9,
      },
      {
        role: "HERO_MOBILE",
        assetId: hero.mobileMediaAssetId,
        metadataRevisionId: hero.mobileMediaMetadataRevisionId,
        assetField: "mobileMediaAssetId",
        metadataField: "mobileMediaMetadataRevisionId",
        minimumWidth: 1_080,
        minimumHeight: 1_350,
        aspectWidth: 4,
        aspectHeight: 5,
      },
    ];
    for (const binding of bindings) {
      validateHomepageHeroMediaBinding(
        candidate,
        hero.slotKey,
        binding,
        issues,
      );
    }
  }
}

function validatePolicyTranslations(
  candidate: PolicyPublicationCandidate,
  approvals: readonly TranslationApprovalEvidence[],
  issues: PublicationValidationIssue[],
): void {
  validateTranslationPackage({
    objectKind: "POLICY",
    parentRevisionId: candidate.revision.id,
    rows: candidate.translations,
    approvals,
    computeContentHash: computePolicyTranslationContentHash,
    parentRevisionIdOf: (row) => row.policyRevisionId,
    evaluatedAt: candidate.evaluatedAt,
    issues,
    pathPrefix: ["translations"],
  });
}

function validatePolicyLifecycleAndTiming(
  candidate: PolicyPublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  if (
    candidate.currentPublication !== null &&
    candidate.currentPublication.policyKey !== candidate.revision.policyKey
  ) {
    issues.push(
      issue("CURRENT_PUBLICATION_EVIDENCE_MISMATCH", [
        "currentPublication",
        "policyKey",
      ]),
    );
  }
  validateCurrentPublicationEvidence({
    action: candidate.action,
    currentPublication: candidate.currentPublication,
    currentPublishedRevisionId: candidate.currentPublishedRevisionId,
    targetRevisionId: candidate.revision.id,
    issues,
    currentRevisionPath: ["currentPublishedRevisionId"],
  });
  validatePublicationLifecycle({
    action: candidate.action,
    lifecycle: candidate.revision.lifecycle,
    createdAt: candidate.revision.createdAt,
    evaluatedAt: candidate.evaluatedAt,
    issues,
  });
  if (
    Date.parse(candidate.revision.effectiveAt) <
    Date.parse(candidate.revision.createdAt)
  ) {
    issues.push(
      issue("POLICY_EFFECTIVE_TIME_INVALID", ["revision", "effectiveAt"]),
    );
  }
  if (
    Date.parse(candidate.revision.effectiveAt) >
    Date.parse(candidate.evaluatedAt)
  ) {
    issues.push(issue("POLICY_NOT_EFFECTIVE", ["revision", "effectiveAt"]));
  }
}

export function validateIdolPublicationCandidate(
  input: unknown,
  approvalInput: unknown,
): PublicationValidationReport {
  const parsed = idolPublicationCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return report(
      "IDOL",
      parsed.error.issues.map((schemaIssue) =>
        issue("SCHEMA_INVALID", safeSchemaPath(schemaIssue.path)),
      ),
    );
  }
  const issues: PublicationValidationIssue[] = [];
  const approvals = parseApprovalEvidence(approvalInput, issues);
  if (approvals === undefined) {
    return report("IDOL", issues);
  }
  validateIdolIdentityAndMedia(parsed.data, issues);
  validateIdolTranslations(parsed.data, approvals, issues);
  validateMediaTranslationPackages(
    new Set(
      parsed.data.mediaReferences
        .filter((reference) =>
          sameUuid(reference.idolRevisionId, parsed.data.revision.id),
        )
        .map((reference) => canonicalUuid(reference.mediaMetadataRevisionId)),
    ),
    new Set(
      parsed.data.mediaMetadataRevisions
        .filter((metadata) => metadata.presentationKind === "INFORMATIVE")
        .map((metadata) => canonicalUuid(metadata.id)),
    ),
    parsed.data.mediaTranslations,
    approvals,
    issues,
    parsed.data.evaluatedAt,
  );
  return report("IDOL", issues);
}

export function validateHomepagePublicationCandidate(
  input: unknown,
  approvalInput: unknown,
): PublicationValidationReport {
  const parsed = homepagePublicationCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return report(
      "HOMEPAGE",
      parsed.error.issues.map((schemaIssue) =>
        issue("SCHEMA_INVALID", safeSchemaPath(schemaIssue.path)),
      ),
    );
  }
  const issues: PublicationValidationIssue[] = [];
  const approvals = parseApprovalEvidence(approvalInput, issues);
  if (approvals === undefined) {
    return report("HOMEPAGE", issues);
  }
  validateHomepageSlotsAndReferences(parsed.data, issues);
  validateHomepageHeroMedia(parsed.data, issues);
  validateHomepageTranslations(parsed.data, approvals, issues);
  validateMediaTranslationPackages(
    new Set(
      parsed.data.slots
        .filter((slot) => slot.kind === "HERO_IDOL")
        .flatMap((slot) => [
          canonicalUuid(slot.desktopMediaMetadataRevisionId),
          canonicalUuid(slot.mobileMediaMetadataRevisionId),
        ]),
    ),
    new Set(
      parsed.data.mediaMetadataRevisions
        .filter((metadata) => metadata.presentationKind === "INFORMATIVE")
        .map((metadata) => canonicalUuid(metadata.id)),
    ),
    parsed.data.mediaTranslations,
    approvals,
    issues,
    parsed.data.evaluatedAt,
  );
  return report("HOMEPAGE", issues);
}

export function validatePolicyPublicationCandidate(
  input: unknown,
  approvalInput: unknown,
): PublicationValidationReport {
  const parsed = policyPublicationCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return report(
      "POLICY",
      parsed.error.issues.map((schemaIssue) =>
        issue("SCHEMA_INVALID", safeSchemaPath(schemaIssue.path)),
      ),
    );
  }
  const issues: PublicationValidationIssue[] = [];
  const approvals = parseApprovalEvidence(approvalInput, issues);
  if (approvals === undefined) {
    return report("POLICY", issues);
  }
  validatePolicyLifecycleAndTiming(parsed.data, issues);
  validatePolicyTranslations(parsed.data, approvals, issues);
  return report("POLICY", issues);
}
