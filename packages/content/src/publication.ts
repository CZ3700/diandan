import {
  giftPublicationCandidateSchema,
  hasVisibleText,
  publicationValidationReportSchema,
} from "@fan-support/contracts";
import type {
  GiftPublicationCandidate,
  PublicationValidationIssue,
  PublicationValidationReport,
  TranslationApprovalEvidence,
} from "@fan-support/contracts";

import {
  computeGiftTranslationContentHash,
  computeMediaTranslationContentHash,
} from "./hashing.js";
import { validateGiftMediaQualification } from "./media-qualification.js";
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

export { deriveTranslationEffectiveState } from "./publication-validation.js";

function isEffectiveAt(
  evaluatedAt: number,
  validFrom: string,
  validUntil: string | undefined,
): boolean {
  return (
    Date.parse(validFrom) <= evaluatedAt &&
    (validUntil === undefined || evaluatedAt < Date.parse(validUntil))
  );
}

function validateCandidateIdentity(
  candidate: GiftPublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  if (candidate.base.status === "archived") {
    issues.push(issue("BASE_ARCHIVED", ["base", "status"]));
  }
  if (!sameUuid(candidate.revision.giftId, candidate.base.id)) {
    issues.push(issue("REVISION_PARENT_MISMATCH", ["revision", "giftId"]));
  }
  if (
    candidate.currentPublication !== null &&
    candidate.currentPublication.giftId.toLowerCase() !==
      candidate.base.id.toLowerCase()
  ) {
    issues.push(
      issue("CURRENT_PUBLICATION_EVIDENCE_MISMATCH", [
        "currentPublication",
        "giftId",
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
  if (candidate.action === "PUBLISH") {
    if (
      candidate.base.draftRevisionId === null ||
      !sameUuid(candidate.base.draftRevisionId, candidate.revision.id)
    ) {
      issues.push(issue("DRAFT_POINTER_MISMATCH", ["base", "draftRevisionId"]));
    }
  }
}

function validateGiftTranslations(
  candidate: GiftPublicationCandidate,
  approvals: readonly TranslationApprovalEvidence[],
  issues: PublicationValidationIssue[],
): void {
  validateTranslationPackage({
    objectKind: "GIFT",
    parentRevisionId: candidate.revision.id,
    rows: candidate.translations,
    approvals,
    computeContentHash: computeGiftTranslationContentHash,
    parentRevisionIdOf: (row) => row.giftRevisionId,
    evaluatedAt: candidate.evaluatedAt,
    issues,
    pathPrefix: ["translations"],
  });

  const variantIds = new Set(
    candidate.variants.map((variant) => canonicalUuid(variant.id)),
  );
  for (const [index, row] of candidate.translations.entries()) {
    const labelIds = row.variantLabels.map((label) =>
      canonicalUuid(label.giftVariantId),
    );
    const uniqueLabelIds = new Set(labelIds);
    if (
      labelIds.length !== candidate.variants.length ||
      uniqueLabelIds.size !== variantIds.size ||
      [...variantIds].some((variantId) => !uniqueLabelIds.has(variantId))
    ) {
      issues.push(
        issue("VARIANT_LABEL_MISMATCH", [
          "translations",
          index,
          "variantLabels",
        ]),
      );
    }
  }

  if (candidate.revision.requiresSafetyNotice) {
    for (const [index, row] of candidate.translations.entries()) {
      if (row.safetyNotice === undefined || row.safetyNotice.trim() === "") {
        issues.push(
          issue("SAFETY_NOTICE_MISSING", [
            "translations",
            index,
            "safetyNotice",
          ]),
        );
      }
    }
  }
}

function validateVariantsAndEligibility(
  candidate: GiftPublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  if (candidate.variants.length === 0) {
    issues.push(issue("VARIANT_MISSING", ["variants"]));
    return;
  }
  if (
    !candidate.variants.some(
      (variant) => variant.status === "active" || variant.status === "paused",
    )
  ) {
    issues.push(issue("VARIANT_MISSING", ["variants"]));
  }
  if (
    candidate.targetOperationalStatus === "active" &&
    !candidate.variants.some((variant) => variant.status === "active")
  ) {
    issues.push(issue("VARIANT_SELLABLE_MISSING", ["variants"]));
  }

  const seenIds = new Set<string>();
  const seenSkus = new Set<string>();
  for (const [index, variant] of candidate.variants.entries()) {
    if (!sameUuid(variant.giftId, candidate.base.id)) {
      issues.push(
        issue("REVISION_PARENT_MISMATCH", ["variants", index, "giftId"]),
      );
    }
    if (seenSkus.has(variant.sku)) {
      issues.push(issue("VARIANT_DUPLICATE_SKU", ["variants", index, "sku"]));
    }
    const variantId = canonicalUuid(variant.id);
    if (seenIds.has(variantId)) {
      issues.push(issue("VARIANT_DUPLICATE_ID", ["variants", index, "id"]));
    }
    seenIds.add(variantId);
    seenSkus.add(variant.sku);

    if (variant.status === "archived") {
      continue;
    }
    const linkedIdols = candidate.eligibility
      .filter((link) => sameUuid(link.giftVariantId, variant.id))
      .flatMap((link) =>
        candidate.eligibleIdols.filter((idol) =>
          sameUuid(idol.id, link.idolId),
        ),
      );
    const eligibleIdols = linkedIdols.filter(
      (idol) => idol.status === "active" && idol.acceptingGifts,
    );
    if (eligibleIdols.length === 0) {
      issues.push(
        issue("ELIGIBILITY_MISSING", ["variants", index, "eligibility"]),
      );
    } else if (
      !eligibleIdols.some((idol) => idol.publishedRevisionId !== null)
    ) {
      issues.push(
        issue("ELIGIBLE_IDOL_NOT_PUBLISHED", [
          "variants",
          index,
          "eligibility",
        ]),
      );
    }
  }
}

function validatePrices(
  candidate: GiftPublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  const evaluatedAt = Date.parse(candidate.evaluatedAt);
  const priceBooks = new Map<
    string,
    GiftPublicationCandidate["priceBooks"][number]
  >();
  const duplicatePriceBookKeys = new Set<string>();
  for (const [index, book] of candidate.priceBooks.entries()) {
    const key = `${canonicalUuid(book.id)}:${book.revision}`;
    if (priceBooks.has(key)) {
      duplicatePriceBookKeys.add(key);
      issues.push(issue("PRICE_BOOK_DUPLICATE", ["priceBooks", index]));
    } else {
      priceBooks.set(key, book);
    }
  }

  const seenPriceRevisions = new Set<string>();
  for (const [index, price] of candidate.prices.entries()) {
    const priceRevisionKey = `${price.id.toLowerCase()}:${price.revision}`;
    if (seenPriceRevisions.has(priceRevisionKey)) {
      issues.push(issue("PRICE_DUPLICATE", ["prices", index, "id"]));
    }
    seenPriceRevisions.add(priceRevisionKey);
  }
  const variantIds = new Set(
    candidate.variants.map((variant) => canonicalUuid(variant.id)),
  );

  for (const [index, price] of candidate.prices.entries()) {
    if (!variantIds.has(canonicalUuid(price.giftVariantId))) {
      issues.push(
        issue("PRICE_VARIANT_MISMATCH", ["prices", index, "giftVariantId"]),
      );
    }
  }

  for (const [index, variant] of candidate.variants.entries()) {
    if (variant.status === "archived") {
      continue;
    }
    const variantPrices = candidate.prices.filter((price) =>
      sameUuid(price.giftVariantId, variant.id),
    );
    if (variantPrices.length === 0) {
      issues.push(issue("PRICE_MISSING", ["variants", index, "prices"]));
      continue;
    }

    let hasPublishedBook = false;
    let hasEffectivePrice = false;
    for (const price of variantPrices) {
      const book = priceBooks.get(
        `${canonicalUuid(price.priceBookId)}:${price.priceBookRevision}`,
      );
      const bookKey = `${canonicalUuid(price.priceBookId)}:${price.priceBookRevision}`;
      if (book?.status !== "PUBLISHED" || duplicatePriceBookKeys.has(bookKey)) {
        continue;
      }
      hasPublishedBook = true;
      if (
        isEffectiveAt(evaluatedAt, book.validFrom, book.validUntil) &&
        isEffectiveAt(evaluatedAt, price.validFrom, price.validUntil)
      ) {
        hasEffectivePrice = true;
      }
    }
    if (!hasPublishedBook) {
      issues.push(
        issue("PRICE_BOOK_NOT_PUBLISHED", ["variants", index, "prices"]),
      );
    } else if (!hasEffectivePrice) {
      issues.push(issue("PRICE_NOT_EFFECTIVE", ["variants", index, "prices"]));
    }
  }

  const publishedIntervals = candidate.prices
    .map((price, index) => {
      const book = priceBooks.get(
        `${canonicalUuid(price.priceBookId)}:${price.priceBookRevision}`,
      );
      const bookKey = `${canonicalUuid(price.priceBookId)}:${price.priceBookRevision}`;
      if (book?.status !== "PUBLISHED" || duplicatePriceBookKeys.has(bookKey)) {
        return undefined;
      }
      const effectiveStart = Math.max(
        Date.parse(price.validFrom),
        Date.parse(book.validFrom),
      );
      const effectiveEnd = Math.min(
        price.validUntil === undefined
          ? Number.POSITIVE_INFINITY
          : Date.parse(price.validUntil),
        book.validUntil === undefined
          ? Number.POSITIVE_INFINITY
          : Date.parse(book.validUntil),
      );
      return effectiveStart < effectiveEnd
        ? {
            price,
            index,
            market: book.market,
            currency: book.currency,
            effectiveStart,
            effectiveEnd,
          }
        : undefined;
    })
    .filter((value) => value !== undefined);
  const groups = new Map<string, typeof publishedIntervals>();
  for (const interval of publishedIntervals) {
    const key = `${canonicalUuid(interval.price.giftVariantId)}:${interval.market}:${interval.currency}`;
    const group = groups.get(key) ?? [];
    group.push(interval);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.effectiveStart - right.effectiveStart);
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      if (current.effectiveStart < previous.effectiveEnd) {
        issues.push(issue("PRICE_OVERLAP", ["prices", current.index]));
      }
    }
  }
}

function validateInventoryAssociations(
  candidate: GiftPublicationCandidate,
  issues: PublicationValidationIssue[],
): void {
  const variantsById = new Map(
    candidate.variants.map((variant) => [canonicalUuid(variant.id), variant]),
  );
  const itemIds = new Set(
    candidate.inventoryItems.map((item) => canonicalUuid(item.id)),
  );

  for (const [index, variant] of candidate.variants.entries()) {
    if (
      variant.status === "archived" ||
      variant.inventoryPolicy !== "TRACKED"
    ) {
      continue;
    }
    const matchingItems = candidate.inventoryItems.filter(
      (item) =>
        sameUuid(item.giftVariantId, variant.id) && item.status === "ACTIVE",
    );
    if (matchingItems.length === 0) {
      issues.push(
        issue("INVENTORY_ITEM_MISSING", ["variants", index, "inventory"]),
      );
    }
  }

  for (const [index, item] of candidate.inventoryItems.entries()) {
    const variant = variantsById.get(canonicalUuid(item.giftVariantId));
    if (
      variant === undefined ||
      item.sku !== variant.sku ||
      item.policy !== variant.inventoryPolicy
    ) {
      issues.push(issue("INVENTORY_ITEM_MISMATCH", ["inventoryItems", index]));
    }
  }

  for (const [index, balance] of candidate.inventoryBalances.entries()) {
    if (!itemIds.has(canonicalUuid(balance.inventoryItemId))) {
      issues.push(
        issue("INVENTORY_BALANCE_ITEM_MISMATCH", [
          "inventoryBalances",
          index,
          "inventoryItemId",
        ]),
      );
    }
  }
}

function validateMedia(
  candidate: GiftPublicationCandidate,
  approvals: readonly TranslationApprovalEvidence[],
  issues: PublicationValidationIssue[],
): void {
  const qualificationIssues = validateGiftMediaQualification({
    revisionId: candidate.revision.id,
    references: candidate.mediaReferences,
    assets: candidate.mediaAssets,
    variants: candidate.mediaVariants,
    metadataRevisions: candidate.mediaMetadataRevisions,
  });
  for (const qualificationIssue of qualificationIssues) {
    issues.push(issue(qualificationIssue.code, qualificationIssue.path));
  }

  if (
    !candidate.mediaReferences.some(
      (reference) =>
        sameUuid(reference.giftRevisionId, candidate.revision.id) &&
        reference.role === "PRIMARY",
    )
  ) {
    issues.push(issue("MEDIA_MISSING", ["mediaReferences"]));
  }

  const referencedMetadataRevisionIds = new Set(
    candidate.mediaReferences
      .filter((reference) =>
        sameUuid(reference.giftRevisionId, candidate.revision.id),
      )
      .map((reference) => canonicalUuid(reference.mediaMetadataRevisionId)),
  );
  validateReferencedMediaLifecycle({
    action: candidate.action,
    referencedMetadataRevisionIds,
    metadataRevisions: candidate.mediaMetadataRevisions,
    evaluatedAt: candidate.evaluatedAt,
    issues,
  });
  for (const [index, translation] of candidate.mediaTranslations.entries()) {
    if (
      !referencedMetadataRevisionIds.has(
        canonicalUuid(translation.mediaMetadataRevisionId),
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

  for (const [index, reference] of candidate.mediaReferences.entries()) {
    if (!sameUuid(reference.giftRevisionId, candidate.revision.id)) {
      continue;
    }
    const path = ["mediaReferences", index] as const;
    const metadataMatches = candidate.mediaMetadataRevisions.filter(
      (candidateMetadata) =>
        sameUuid(candidateMetadata.id, reference.mediaMetadataRevisionId),
    );
    if (metadataMatches.length !== 1) {
      continue;
    }
    const metadata = metadataMatches[0]!;

    const translations = candidate.mediaTranslations.filter((translation) =>
      sameUuid(
        translation.mediaMetadataRevisionId,
        reference.mediaMetadataRevisionId,
      ),
    );
    validateTranslationPackage({
      objectKind: "MEDIA_METADATA",
      parentRevisionId: reference.mediaMetadataRevisionId,
      rows: translations,
      approvals,
      computeContentHash: computeMediaTranslationContentHash,
      parentRevisionIdOf: (translation) => translation.mediaMetadataRevisionId,
      evaluatedAt: candidate.evaluatedAt,
      issues,
      pathPrefix: [...path, "translations"],
    });
    if (metadata.presentationKind === "INFORMATIVE") {
      for (const [translationIndex, translation] of translations.entries()) {
        if (!hasVisibleText(translation.alt)) {
          issues.push(
            issue("MEDIA_ALT_MISSING", [
              ...path,
              "translations",
              translationIndex,
              "alt",
            ]),
          );
        }
      }
    }
    if (translations.some((translation) => translation.caption === undefined)) {
      issues.push(
        issue(
          "OPTIONAL_FIELD_MISSING",
          [...path, "translations", "caption"],
          "WARNING",
        ),
      );
    }
  }
}

export function validateGiftPublicationCandidate(
  input: unknown,
  approvalInput: unknown,
): PublicationValidationReport {
  const parsed = giftPublicationCandidateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((schemaIssue) =>
      issue("SCHEMA_INVALID", safeSchemaPath(schemaIssue.path)),
    );
    return publicationValidationReportSchema.parse({
      schemaVersion: 1,
      objectKind: "GIFT",
      publishable: false,
      issues,
    });
  }

  const issues: PublicationValidationIssue[] = [];
  const approvals = parseApprovalEvidence(approvalInput, issues);
  if (approvals === undefined) {
    return publicationValidationReportSchema.parse({
      schemaVersion: 1,
      objectKind: "GIFT",
      publishable: false,
      issues,
    });
  }
  validateCandidateIdentity(parsed.data, issues);
  validateGiftTranslations(parsed.data, approvals, issues);
  validateVariantsAndEligibility(parsed.data, issues);
  validatePrices(parsed.data, issues);
  validateInventoryAssociations(parsed.data, issues);
  validateMedia(parsed.data, approvals, issues);

  return publicationValidationReportSchema.parse({
    schemaVersion: 1,
    objectKind: "GIFT",
    publishable: !issues.some(
      (candidateIssue) => candidateIssue.severity === "BLOCKER",
    ),
    issues,
  });
}
