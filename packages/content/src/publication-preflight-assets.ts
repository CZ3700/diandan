import type {
  PublicationPreflightContext,
  PublicationPreflightIssue,
  PublicationValidationIssue,
} from "@fan-support/contracts";
import { validateReferencedMediaLifecycle } from "./publication-validation.js";
import {
  withoutFields,
  preflightIssue,
  sameId,
} from "./publication-preflight-shared.js";
/** Shared qualification also covers standalone metadata and detail-only image dependencies. */
export function validatePreflightAssets(
  context: PublicationPreflightContext,
): PublicationPreflightIssue[] {
  const candidate = context.candidate;
  if (candidate.objectKind === "POLICY") return [];
  const assets =
    candidate.objectKind === "MEDIA_METADATA"
      ? [candidate.asset]
      : candidate.mediaAssets;
  const variants =
    candidate.objectKind === "MEDIA_METADATA"
      ? candidate.variants
      : candidate.mediaVariants;
  const issues: PublicationPreflightIssue[] = [];
  const ids = new Set<string>();
  const variantIds = new Set<string>();
  const derivativeKeys = new Set<string>();
  for (const [index, asset] of assets.entries()) {
    const path = ["candidate", "mediaAssets", index];
    if (ids.has(asset.id.toLowerCase()))
      issues.push(preflightIssue("MEDIA_ASSET_DUPLICATE", path));
    ids.add(asset.id.toLowerCase());
    if (asset.rightsStatus !== "APPROVED")
      issues.push(preflightIssue("MEDIA_RIGHTS_NOT_APPROVED", path));
    if (asset.processingStatus !== "READY")
      issues.push(preflightIssue("MEDIA_ASSET_NOT_READY", path));
    for (const format of ["AVIF", "WEBP", "JPEG"]) {
      const matches = variants.filter(
        (row) => sameId(row.mediaAssetId, asset.id) && row.format === format,
      );
      if (matches.length === 0)
        issues.push(
          preflightIssue("MEDIA_DERIVATIVE_MISSING", [...path, format]),
        );
      else if (!matches.some((row) => row.status === "READY"))
        issues.push(
          preflightIssue("MEDIA_DERIVATIVE_NOT_READY", [...path, format]),
        );
    }
  }
  for (const [index, variant] of variants.entries()) {
    const path = ["candidate", "mediaVariants", index];
    const asset = assets.find((item) => sameId(item.id, variant.mediaAssetId));
    if (asset === undefined) {
      issues.push(preflightIssue("MEDIA_ASSET_MISSING", path));
      continue;
    }
    const key = [
      variant.mediaAssetId.toLowerCase(),
      variant.format,
      variant.width,
      variant.height,
    ].join(":");
    if (variantIds.has(variant.id.toLowerCase()))
      issues.push(preflightIssue("MEDIA_VARIANT_ID_DUPLICATE", path));
    variantIds.add(variant.id.toLowerCase());
    if (derivativeKeys.has(key))
      issues.push(preflightIssue("MEDIA_DERIVATIVE_DUPLICATE", path));
    derivativeKeys.add(key);
    if (
      (variant.status === "READY" || variant.status === "PROCESSING") &&
      (variant.width > asset.width || variant.height > asset.height)
    )
      issues.push(preflightIssue("MEDIA_DERIVATIVE_DIMENSIONS_INVALID", path));
  }
  for (const [index, snapshot] of context.mediaSnapshots.entries())
    if (
      snapshot.target.kind !== "MEDIA_METADATA" ||
      !assets.some(
        (asset) =>
          snapshot.target.kind === "MEDIA_METADATA" &&
          sameId(asset.id, snapshot.target.mediaAssetId),
      )
    )
      issues.push(
        preflightIssue("MEDIA_ASSET_MISSING", ["mediaSnapshots", index]),
      );
  if (candidate.objectKind !== "MEDIA_METADATA") {
    const legacy: PublicationValidationIssue[] = [];
    validateReferencedMediaLifecycle({
      action: context.action,
      referencedMetadataRevisionIds: new Set(
        candidate.mediaMetadataRevisions.map((row) => row.id),
      ),
      metadataRevisions: candidate.mediaMetadataRevisions,
      evaluatedAt: context.evaluatedAt,
      issues: legacy,
    });
    issues.push(
      ...legacy.map((issue) => withoutFields(issue, ["schemaVersion"])),
    );
  }
  return issues;
}
