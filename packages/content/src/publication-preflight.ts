import {
  SUPPORTED_LOCALES,
  publicationPreflightContextSchema,
  publicationPreflightResponseSchema,
  type PublicationPreflightContext,
  type PublicationPreflightIssue,
  type PublicationPreflightResponse,
  type PublicationValidationIssue,
} from "@fan-support/contracts";
import { validateGiftPublicationCandidate } from "./publication.js";
import {
  validateHomepagePublicationCandidate,
  validateIdolPublicationCandidate,
  validatePolicyPublicationCandidate,
} from "./non-gift-publication.js";
import { validateCurrentPublicationEvidence } from "./publication-validation.js";
import { validatePreflightEffectiveTime } from "./publication-preflight-effective-time.js";
import { sameBaseContentTarget } from "./base-content.js";
import { validatePreflightExtensions } from "./publication-preflight-extensions.js";
import { validatePreflightAssets } from "./publication-preflight-assets.js";
import { validatePreflightBindings } from "./publication-preflight-bindings.js";
import { validatePreflightReviewPackages } from "./publication-preflight-reviews.js";
import { validatePreflightMediaLineage } from "./publication-preflight-media.js";
import {
  comparePreflightTime,
  preflightIssue,
  rawCanonical,
  withoutFields,
  sameId,
} from "./publication-preflight-shared.js";
function baseMediaCandidate(
  candidate: PublicationPreflightContext["candidate"],
): PublicationPreflightContext["candidate"] {
  if (candidate.objectKind !== "GIFT" && candidate.objectKind !== "IDOL")
    return candidate;
  const assetIds = new Set(
    candidate.mediaReferences.map((row) => row.mediaAssetId.toLowerCase()),
  );
  const metadataIds = new Set(
    candidate.mediaReferences.map((row) =>
      row.mediaMetadataRevisionId.toLowerCase(),
    ),
  );
  return {
    ...candidate,
    mediaAssets: candidate.mediaAssets.filter((row) =>
      assetIds.has(row.id.toLowerCase()),
    ),
    mediaVariants: candidate.mediaVariants.filter((row) =>
      assetIds.has(row.mediaAssetId.toLowerCase()),
    ),
    mediaMetadataRevisions: candidate.mediaMetadataRevisions.filter((row) =>
      metadataIds.has(row.id.toLowerCase()),
    ),
    mediaTranslations: candidate.mediaTranslations.filter((row) =>
      metadataIds.has(row.mediaMetadataRevisionId.toLowerCase()),
    ),
  };
}
function legacyIssues(
  context: PublicationPreflightContext,
): PublicationPreflightIssue[] {
  const candidate = baseMediaCandidate(context.candidate);
  let issues: PublicationValidationIssue[];
  switch (candidate.objectKind) {
    case "IDOL":
      issues = validateIdolPublicationCandidate(
        candidate,
        context.approvals,
      ).issues;
      break;
    case "GIFT":
      issues = validateGiftPublicationCandidate(
        candidate,
        context.approvals,
      ).issues;
      break;
    case "HOMEPAGE":
      issues = validateHomepagePublicationCandidate(
        candidate,
        context.approvals,
      ).issues;
      break;
    case "POLICY":
      issues = validatePolicyPublicationCandidate(
        candidate,
        context.approvals,
      ).issues;
      break;
    case "MEDIA_METADATA": {
      issues = [];
      validateCurrentPublicationEvidence({
        action: context.action,
        currentPublication: candidate.currentPublication,
        currentPublishedRevisionId: candidate.currentPublishedRevisionId,
        targetRevisionId: context.target.revisionId,
        issues,
        currentRevisionPath: ["currentPublishedRevisionId"],
      });
      if (
        candidate.currentPublication !== null &&
        !sameId(candidate.currentPublication.mediaAssetId, candidate.asset.id)
      )
        issues.push({
          schemaVersion: 1,
          ...preflightIssue("CURRENT_PUBLICATION_EVIDENCE_MISMATCH", [
            "currentPublication",
            "mediaAssetId",
          ]),
        } as PublicationValidationIssue);
      break;
    }
  }
  // DRAFT is an explicit preflight input. Only the legacy target-state diagnostic is deferred;
  // all content, timeline, dependency and current-head checks still run unchanged.
  return issues
    .filter(
      (issue) =>
        ![
          "PRICE_NOT_EFFECTIVE",
          "PRICE_OVERLAP",
          "POLICY_EFFECTIVE_TIME_INVALID",
          "POLICY_NOT_EFFECTIVE",
        ].includes(issue.code),
    )
    .filter(
      (issue) =>
        !(
          context.action === "PUBLISH" &&
          context.snapshot.lifecycle.status === "DRAFT" &&
          issue.code === "REVISION_NOT_VALIDATED" &&
          rawCanonical(issue.path) ===
            rawCanonical(["revision", "lifecycle", "status"])
        ),
    )
    .map((issue) =>
      localeIssue(context, withoutFields(issue, ["schemaVersion"])),
    );
}
function lifecycleIssues(
  context: PublicationPreflightContext,
): PublicationPreflightIssue[] {
  const issues: PublicationPreflightIssue[] = [];
  const history = context.previousPublication;
  if (context.action === "ROLLBACK" && history === null)
    issues.push(
      preflightIssue("ROLLBACK_TARGET_INVALID", ["previousPublication"]),
    );
  if (
    history !== null &&
    (!sameBaseContentTarget(
      { ...history.target, locale: "en" },
      { ...context.target, locale: "en" },
    ) ||
      comparePreflightTime(history.publishedAt, context.evaluatedAt) > 0 ||
      comparePreflightTime(history.publishedAt, context.snapshot.createdAt) < 0)
  )
    issues.push(
      preflightIssue("ROLLBACK_TARGET_INVALID", ["previousPublication"]),
    );
  const valid =
    context.action === "PUBLISH" ? ["DRAFT", "VALIDATED"] : ["SUPERSEDED"];
  if (!valid.includes(context.snapshot.lifecycle.status))
    issues.push(
      preflightIssue("REVISION_NOT_VALIDATED", [
        "revision",
        "lifecycle",
        "status",
      ]),
    );
  for (const [index, snapshot] of [
    context.snapshot,
    ...context.mediaSnapshots,
  ].entries()) {
    const path = index === 0 ? ["revision"] : ["mediaSnapshots", index - 1];
    const times = [
      snapshot.createdAt,
      ...Object.entries(snapshot.lifecycle)
        .filter(([key]) => key !== "status")
        .map(([, time]) => time),
    ];
    if (
      times.some(
        (time) => comparePreflightTime(time, context.evaluatedAt) > 0,
      ) ||
      times.some(
        (time, i) => i > 0 && comparePreflightTime(time, times[i - 1]!) < 0,
      )
    )
      issues.push(preflightIssue("REVISION_LIFECYCLE_TIME_INVALID", path));
  }
  return issues;
}
function localeIssue(
  context: PublicationPreflightContext,
  issue: PublicationPreflightIssue,
): PublicationPreflightIssue {
  if (issue.locale !== undefined) return issue;
  const [root, index, collection, rowIndex] = issue.path;
  let locale: string | undefined;
  if (root === "translations")
    locale =
      typeof index === "number"
        ? context.candidate.objectKind === "MEDIA_METADATA"
          ? context.snapshot.translationAudits[index]?.locale
          : context.candidate.translations[index]?.locale
        : typeof index === "string"
          ? index
          : undefined;
  if (
    root === "mediaTranslations" &&
    typeof index === "number" &&
    "mediaTranslations" in context.candidate
  )
    locale = context.candidate.mediaTranslations[index]?.locale;
  if (
    root === "mediaSnapshots" &&
    typeof index === "number" &&
    collection === "translations"
  )
    locale =
      typeof rowIndex === "number"
        ? context.mediaSnapshots[index]?.translationAudits[rowIndex]?.locale
        : typeof rowIndex === "string"
          ? rowIndex
          : undefined;
  const supported = SUPPORTED_LOCALES.find((value) => value === locale);
  return supported === undefined ? issue : { ...issue, locale: supported };
}
/** Read-only: readiness is a diagnostic, never a publication receipt or a state transition. */
export function evaluatePublicationPreflight(
  input: unknown,
): PublicationPreflightResponse {
  try {
    const context = publicationPreflightContextSchema.parse(input);
    const issues = [
      ...validatePreflightBindings(context),
      ...lifecycleIssues(context),
      ...legacyIssues(context),
      ...validatePreflightReviewPackages(context),
      ...validatePreflightMediaLineage(context),
      ...validatePreflightExtensions(context),
      ...validatePreflightAssets(context),
      ...validatePreflightEffectiveTime(context),
    ];
    const unique = [
      ...new Map(
        issues
          .map((issue) => localeIssue(context, issue))
          .map((issue) => [rawCanonical(issue), issue]),
      ).values(),
    ];
    return publicationPreflightResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PUBLICATION_PREFLIGHT",
      target: context.target,
      action: context.action,
      headVersion: context.headVersion,
      contentHash: context.snapshot.contentHash,
      evaluatedAt: context.evaluatedAt,
      ready: !unique.some((issue) => issue.severity === "BLOCKER"),
      issues: unique,
    });
  } catch {
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    };
  }
}
