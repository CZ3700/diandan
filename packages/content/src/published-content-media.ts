import {
  publishedMediaViewSchema,
  type PublishedContentContext,
} from "@fan-support/contracts";
import {
  meetsMediaRoleSourceMinimum,
  meetsMediaRoleDerivativeMinimum,
} from "./media-qualification.js";
import { sameId } from "./publication-preflight-shared.js";

/** Resolves an approved immutable variant while applying current binary and metadata eligibility. */
export function publishedMediaResolver(context: PublishedContentContext) {
  const candidate = context.canonical.candidate;
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
  const revisions =
    candidate.objectKind === "MEDIA_METADATA"
      ? [context.canonical.snapshot]
      : context.canonical.mediaSnapshots;
  const used = new Set<string>();
  function resolve(assetId: string, metadataId: string, role = "GALLERY") {
    const urls = context.media.filter(
      (row) =>
        sameId(row.mediaAssetId, assetId) &&
        sameId(row.mediaMetadataRevisionId, metadataId),
    );
    const metadata = revisions.filter(
      (row) =>
        sameId(row.revisionId, metadataId) &&
        row.target.kind === "MEDIA_METADATA" &&
        sameId(row.target.mediaAssetId, assetId),
    );
    const asset = assets.find((row) => sameId(row.id, assetId));
    if (urls.length !== 1 || metadata.length !== 1 || !asset)
      throw new Error("Invalid public media binding");
    const url = urls[0]!,
      revision = metadata[0]!;
    if (
      revision.content.kind !== "MEDIA_METADATA" ||
      !["PUBLISHED", "SUPERSEDED"].includes(revision.lifecycle.status)
    )
      throw new Error("Public metadata unavailable");
    const variant = variants.find(
      (row) =>
        sameId(row.id, url.mediaVariantId) && sameId(row.mediaAssetId, assetId),
    );
    if (
      !variant ||
      !context.publication.manifest.media.variants.some((row) =>
        sameId(row.id, variant.id),
      ) ||
      variant.status !== "READY" ||
      asset.processingStatus !== "READY" ||
      asset.rightsStatus !== "APPROVED"
    )
      throw new Error("Public variant unavailable");
    if (!new URL(url.url).pathname.endsWith(`/${variant.objectKey}`))
      throw new Error("Public variant URL mismatch");
    if (
      !meetsMediaRoleSourceMinimum(role, asset.width, asset.height) ||
      !meetsMediaRoleDerivativeMinimum(role, variant.width, variant.height) ||
      variant.width > asset.width ||
      variant.height > asset.height
    )
      throw new Error("Public media dimensions invalid");
    const ratio =
      role === "PRIMARY"
        ? [1, 1]
        : ["PORTRAIT", "HERO_MOBILE"].includes(role)
          ? [4, 5]
          : ["HERO", "HERO_DESKTOP"].includes(role)
            ? [16, 9]
            : null;
    if (
      ratio &&
      [asset, variant].some(
        (row) =>
          BigInt(row.width) * BigInt(ratio[1]!) !==
          BigInt(row.height) * BigInt(ratio[0]!),
      )
    )
      throw new Error("Public media aspect ratio invalid");
    const fields = revision.content.translations.find(
      (row) => row.locale === context.locale,
    )?.fields;
    if (!fields) throw new Error("Public media translation unavailable");
    const structure = revision.content.structure;
    if (ratio && structure.presentationKind !== "INFORMATIVE")
      throw new Error("Required media must be informative");
    used.add(`${assetId.toLowerCase()}:${metadataId.toLowerCase()}`);
    return publishedMediaViewSchema.parse({
      schemaVersion: 1,
      kind: structure.presentationKind,
      url: url.url,
      alt: structure.presentationKind === "DECORATIVE" ? "" : fields.alt,
      width: variant.width,
      height: variant.height,
      focalPoint: structure.focalPoint,
    });
  }
  return {
    resolve,
    complete: () =>
      context.media.length === used.size &&
      context.media.every((row) =>
        used.has(
          `${row.mediaAssetId.toLowerCase()}:${row.mediaMetadataRevisionId.toLowerCase()}`,
        ),
      ),
  };
}
