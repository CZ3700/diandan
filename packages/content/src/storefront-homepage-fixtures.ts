// Fictional, package-local test support. Never exported from the runtime entry point.
import {
  publishedContentContextSchema,
  sourceHashSchema,
  type PublicationPreflightContext,
  homepageSlotSchema,
} from "@fan-support/contracts";
import {
  publicationPreflightFixture,
  preflightFixtureId,
  withPreflightExtensions,
} from "./publication-preflight-fixtures.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { computeHomepageTranslationContentHash } from "./hashing.js";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
} from "./publication-manifest.js";
export function storefrontPublishedFixture(
  kind: PublicationPreflightContext["target"]["owner"]["kind"],
  extensions = false,
  featured = false,
) {
  const context = extensions
    ? withPreflightExtensions(publicationPreflightFixture(kind))
    : publicationPreflightFixture(kind);
  const candidate = context.candidate;
  if (featured) appendFeaturedSlots(context);
  const publicationId = preflightFixtureId(9500);
  const lifecycle = {
    status: "PUBLISHED" as const,
    validatedAt: context.evaluatedAt,
    publishedAt: context.evaluatedAt,
  };
  context.snapshot.lifecycle = lifecycle;
  context.snapshot.contentHash = sourceHashSchema.parse(
    computeContentAuthoringSnapshotHash(context.snapshot),
  );
  context.headVersion = 1;
  if (candidate.objectKind !== "MEDIA_METADATA") {
    candidate.revision.lifecycle = lifecycle;
    Object.assign(candidate, {
      currentPublication: {
        schemaVersion: 1,
        id: publicationId,
        action: "PUBLISH",
        objectKind: candidate.objectKind,
        targetRevisionId: context.target.revisionId,
        ...Object.fromEntries(
          Object.entries(context.target.owner).filter(
            ([key]) => key !== "kind",
          ),
        ),
      },
    });
  } else
    candidate.currentPublication = {
      id: publicationId,
      action: "PUBLISH",
      mediaAssetId: candidate.asset.id,
      targetRevisionId: context.target.revisionId,
    };
  if (candidate.objectKind === "IDOL" || candidate.objectKind === "GIFT") {
    candidate.base.publishedRevisionId = context.target
      .revisionId as typeof candidate.base.publishedRevisionId;
    candidate.base.status = "active";
  } else
    candidate.currentPublishedRevisionId = context.target
      .revisionId as typeof candidate.currentPublishedRevisionId;
  const manifest = buildPublicationManifest(context);
  const metadata =
    kind === "MEDIA_METADATA" ? [context.snapshot] : context.mediaSnapshots;
  const variants =
    candidate.objectKind === "POLICY"
      ? []
      : candidate.objectKind === "MEDIA_METADATA"
        ? candidate.variants
        : candidate.mediaVariants;
  return publishedContentContextSchema.parse({
    schemaVersion: 1,
    locale: "en",
    canonical: context,
    publication: {
      schemaVersion: 1,
      publicationId,
      target: context.target,
      action: "PUBLISH",
      publishedAt: context.evaluatedAt,
      headVersion: 1,
      manifestHash: computePublicationManifestHash(manifest),
      manifest,
    },
    media: metadata.map((row) => {
      if (row.target.kind !== "MEDIA_METADATA") throw new Error("fixture");
      const assetId = row.target.mediaAssetId;
      const variant = variants
        .filter((entry) => entry.mediaAssetId === assetId)
        .toSorted((a, b) => b.width - a.width)[0]!;
      return {
        mediaAssetId: assetId,
        mediaMetadataRevisionId: row.revisionId,
        mediaVariantId: variant.id,
        url: `https://media.example.test/${variant.objectKey}`,
      };
    }),
  });
}

function appendFeaturedSlots(context: PublicationPreflightContext) {
  const { candidate, snapshot } = context;
  if (
    candidate.objectKind !== "HOMEPAGE" ||
    snapshot.content.kind !== "HOMEPAGE"
  )
    throw new Error("Homepage fixture required");
  const hero = candidate.slots.find((row) => row.kind === "HERO_IDOL")!;
  const gift = publicationPreflightFixture("GIFT").candidate;
  if (gift.objectKind !== "GIFT") throw new Error("Gift fixture required");
  candidate.referencedGifts.push(gift.base);
  const added = [
    homepageSlotSchema.parse({
      schemaVersion: 1,
      homepageRevisionId: candidate.revision.id,
      slotKey: "featured-artist",
      kind: "FEATURED_IDOL",
      idolId: hero.idolId,
      sortOrder: 1,
    }),
    homepageSlotSchema.parse({
      schemaVersion: 1,
      homepageRevisionId: candidate.revision.id,
      slotKey: "featured-gift",
      kind: "FEATURED_GIFT",
      giftId: gift.base.id,
      sortOrder: 2,
    }),
  ];
  candidate.slots.push(...added);
  snapshot.content.structure.slots.push(
    ...added.map(({ schemaVersion, homepageRevisionId, ...row }) => {
      void schemaVersion;
      void homepageRevisionId;
      return row;
    }),
  );
  for (const translation of snapshot.content.translations)
    translation.fields.slotLabels.push(
      ...added.map((row) => ({
        slotKey: row.slotKey,
        label: `${translation.locale} ${row.slotKey}`,
      })),
    );
  const source = snapshot.content.translations.find(
    (row) => row.locale === "en",
  )!;
  const englishHash = computeHomepageTranslationContentHash(source.fields);
  for (const translation of snapshot.content.translations) {
    const contentHash = computeHomepageTranslationContentHash(
      translation.fields,
    );
    const row = candidate.translations.find(
      (row) => row.locale === translation.locale,
    )!;
    const audit = snapshot.translationAudits.find(
      (row) => row.locale === translation.locale,
    )!;
    const review = {
      ...row.review,
      reviewedContentHash: contentHash,
      reviewedSourceHash: englishHash,
    };
    Object.assign(row, translation.fields, {
      sourceHash: contentHash,
      translatedFromSourceHash: englishHash,
      review,
    });
    Object.assign(audit, {
      sourceHash: contentHash,
      translatedFromSourceHash: englishHash,
      review,
    });
    const approval = context.approvals.find(
      (proof) => proof.translationRevisionId === row.id,
    )!;
    Object.assign(approval, {
      approvedContentHash: contentHash,
      approvedSourceHash: englishHash,
    });
  }
}
