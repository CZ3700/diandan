import {
  publicationManifestSchema,
  publicationManifestRevisionSchema,
  publicationManifestAssetSchema,
  publicationManifestVariantSchema,
  publicationPreflightContextSchema,
  type PublicationManifest,
  type PublicationPreflightContext,
  type ContentAuthoringSnapshot,
} from "@fan-support/contracts";
import { withoutFields, sameId } from "./publication-preflight-shared.js";
import {
  canonicalPublicationValue,
  hashPublicationValue,
} from "./publication-manifest-canonical.js";
import { validatePreflightBindings } from "./publication-preflight-bindings.js";
import { validatePreflightReviewPackages } from "./publication-preflight-reviews.js";
import { validatePreflightExtensions } from "./publication-preflight-extensions.js";
import { validatePreflightAssets } from "./publication-preflight-assets.js";
import { validatePreflightMediaLineage } from "./publication-preflight-media.js";

const domain = "fan-support.publication-manifest.v1";
function revision(snapshot: ContentAuthoringSnapshot) {
  return publicationManifestRevisionSchema.parse(
    withoutFields(snapshot, ["lifecycle", "headVersion", "contentHash"]),
  );
}
function asset(
  value: PublicationPreflightContext["mediaLineage"][number]["processing"][number]["sourceAsset"],
) {
  return publicationManifestAssetSchema.parse(
    withoutFields(value, [
      "processingStatus",
      "processingErrorCode",
      "rightsStatus",
      "rightsReference",
    ]),
  );
}
/** Deterministic projection only; the write transaction must first run the full publication gate. */
export function buildPublicationManifest(
  input: PublicationPreflightContext,
): PublicationManifest {
  const context = publicationPreflightContextSchema.parse(input);
  const candidate = context.candidate;
  const assets =
    candidate.objectKind === "POLICY"
      ? []
      : candidate.objectKind === "MEDIA_METADATA"
        ? [candidate.asset]
        : candidate.mediaAssets;
  const variants =
    candidate.objectKind === "POLICY"
      ? []
      : candidate.objectKind === "MEDIA_METADATA"
        ? candidate.variants
        : candidate.mediaVariants;
  return publicationManifestSchema.parse({
    schemaVersion: 1,
    target: context.target,
    revision: revision(context.snapshot),
    mediaRevisions: context.mediaSnapshots.map(revision),
    approvals: context.approvals,
    copies: context.copies,
    extensionApprovals: context.extensionApprovals,
    media: {
      assets: assets.map(asset),
      variants: variants
        .filter((row) => row.status === "READY")
        .map((row) =>
          publicationManifestVariantSchema.parse(
            withoutFields(row, ["status"]),
          ),
        ),
      lineage: context.mediaLineage.map((row) => ({
        assetId: row.assetId,
        identityKind: row.identityKind,
        processing: row.processing.map((proof) => ({
          ...withoutFields(proof, ["status", "sourceAsset"]),
          sourceAsset: asset(proof.sourceAsset),
        })),
      })),
    },
  });
}
export function serializePublicationManifest(
  input: PublicationManifest,
): string {
  return canonicalPublicationValue(publicationManifestSchema.parse(input));
}
export function computePublicationManifestHash(input: PublicationManifest) {
  return hashPublicationValue(domain, publicationManifestSchema.parse(input));
}
export function computePublicationManifestSectionHashes(
  input: PublicationManifest,
) {
  const manifest = publicationManifestSchema.parse(input);
  return {
    translationManifestHash: hashPublicationValue(`${domain}/translations`, {
      revision: manifest.revision,
    }),
    approvalManifestHash: hashPublicationValue(`${domain}/approvals`, {
      approvals: manifest.approvals,
      copies: manifest.copies,
      extensionApprovals: manifest.extensionApprovals,
    }),
    mediaManifestHash: hashPublicationValue(`${domain}/media`, {
      mediaRevisions: manifest.mediaRevisions,
      media: manifest.media,
    }),
  };
}
const equal = (left: unknown, right: unknown) =>
  canonicalPublicationValue(left) === canonicalPublicationValue(right);
function exactSubset<T>(
  frozen: readonly T[],
  current: readonly T[],
  id: (row: T) => string,
): boolean {
  return frozen.every((row) => {
    const matches = current.filter((entry) => sameId(id(row), id(entry)));
    return matches.length === 1 && equal(row, matches[0]);
  });
}
/** Verifies real immutable proof and all current media sources, without treating it as publish permission. */
export function verifyPublicationManifest(
  input: unknown,
  canonical: unknown,
): boolean {
  try {
    const manifest = publicationManifestSchema.parse(input);
    const context = publicationPreflightContextSchema.parse(canonical);
    const current = buildPublicationManifest(context);
    if (
      !equal(
        withoutFields(manifest, ["media"]),
        withoutFields(current, ["media"]),
      )
    )
      return false;
    if (
      !equal(
        { assets: manifest.media.assets },
        { assets: current.media.assets },
      )
    )
      return false;
    if (
      !exactSubset(
        manifest.media.variants,
        current.media.variants,
        (row) => row.id,
      )
    )
      return false;
    if (manifest.media.lineage.length !== current.media.lineage.length)
      return false;
    for (const lineage of manifest.media.lineage) {
      const match = current.media.lineage.filter((row) =>
        sameId(row.assetId, lineage.assetId),
      );
      if (
        match.length !== 1 ||
        match[0]!.identityKind !== lineage.identityKind ||
        !exactSubset(
          lineage.processing,
          match[0]!.processing,
          (row) => row.jobId,
        )
      )
        return false;
    }
    return [
      ...validatePreflightBindings(context),
      ...validatePreflightReviewPackages(context),
      ...validatePreflightExtensions(context),
      // A frozen publication can retain an already published metadata revision after it is superseded.
      // Command eligibility remains a separate full preflight check in the write transaction.
      ...validatePreflightAssets(context, "PUBLISHED_REFERENCE"),
      ...validatePreflightMediaLineage(context),
    ].every((issue) => issue.severity !== "BLOCKER");
  } catch {
    return false;
  }
}
