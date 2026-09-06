import { describe, expect, test } from "vitest";
import {
  publishedContentContextSchema,
  sourceHashSchema,
  SUPPORTED_LOCALES,
  type PublicationPreflightContext,
} from "@fan-support/contracts";
import {
  publicationPreflightFixture,
  preflightFixtureId,
  withPreflightExtensions,
} from "./publication-preflight-fixtures.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
} from "./publication-manifest.js";
import { projectPublishedContent } from "./published-content.js";
import { validatePreflightAssets } from "./publication-preflight-assets.js";

function fixture(
  kind: PublicationPreflightContext["target"]["owner"]["kind"],
  extensions = false,
) {
  const context = extensions
    ? withPreflightExtensions(publicationPreflightFixture(kind))
    : publicationPreflightFixture(kind);
  const candidate = context.candidate;
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
describe("published content projection", () => {
  test("published parents retain pinned historical metadata while new publication stays strict", () => {
    const input = fixture("IDOL");
    const candidate = input.canonical.candidate;
    if (candidate.objectKind !== "IDOL") throw new Error("fixture");
    for (const metadata of candidate.mediaMetadataRevisions) {
      if (metadata.lifecycle.status !== "PUBLISHED")
        throw new Error("fixture metadata is published");
      metadata.lifecycle = {
        ...metadata.lifecycle,
        status: "SUPERSEDED",
        supersededAt: input.canonical.evaluatedAt,
      };
      const snapshot = input.canonical.mediaSnapshots.find(
        (row) => row.revisionId === metadata.id,
      )!;
      snapshot.lifecycle = metadata.lifecycle;
      snapshot.contentHash = sourceHashSchema.parse(
        computeContentAuthoringSnapshotHash(snapshot),
      );
    }
    expect(
      validatePreflightAssets(input.canonical).some(
        (issue) => issue.code === "MEDIA_METADATA_NOT_PUBLISHABLE",
      ),
    ).toBe(true);
    expect(projectPublishedContent(input).outcome).toBe("SUCCESS");
    const invalid = structuredClone(input);
    if (invalid.canonical.candidate.objectKind !== "IDOL")
      throw new Error("fixture");
    for (const metadata of invalid.canonical.candidate.mediaMetadataRevisions) {
      metadata.lifecycle = { status: "DRAFT" };
      const snapshot = invalid.canonical.mediaSnapshots.find(
        (row) => row.revisionId === metadata.id,
      )!;
      snapshot.lifecycle = metadata.lifecycle;
      snapshot.contentHash = sourceHashSchema.parse(
        computeContentAuthoringSnapshotHash(snapshot),
      );
    }
    expect(projectPublishedContent(invalid).outcome).toBe("FAILURE");
  });
  for (const kind of [
    "IDOL",
    "GIFT",
    "HOMEPAGE",
    "POLICY",
    "MEDIA_METADATA",
  ] as const)
    test(`${kind} exposes only the requested locale and safe public view`, () => {
      for (const locale of SUPPORTED_LOCALES) {
        const input = fixture(kind);
        input.locale = locale;
        const response = projectPublishedContent(input);
        expect(response.outcome).toBe("SUCCESS");
        if (response.outcome !== "SUCCESS") continue;
        expect(response.content.kind).toBe(kind);
        expect(
          response.content.kind === "MEDIA_METADATA"
            ? response.content.localeContext.resolvedLocale
            : response.content.view.localeContext.resolvedLocale,
        ).toBe(locale);
        expect(JSON.stringify(response)).not.toMatch(
          /"(?:editorId|reviewerId|objectKey|copies|approvals|translationAudits|rightsReference)"/,
        );
      }
    });
  test("whole-object fail closed for missing proof, bad hash and wrong head", () => {
    const input = fixture("POLICY");
    for (const bad of [
      { ...input, publication: null },
      {
        ...input,
        publication: { ...input.publication, manifestHash: "a".repeat(64) },
      },
      { ...input, canonical: { ...input.canonical, headVersion: 9 } },
    ])
      expect(projectPublishedContent(bad)).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      });
  });
  test("private unapproved or draft revisions cannot be shown", () => {
    const input = fixture("POLICY");
    input.canonical.snapshot.lifecycle = { status: "DRAFT" };
    expect(projectPublishedContent(input).outcome).toBe("FAILURE");
  });
  test("rollback selects a historical bundle and requires an earlier real publication tuple", () => {
    const input = fixture("POLICY");
    const oldPublishedAt = input.publication.publishedAt;
    const lifecycle = {
      status: "SUPERSEDED" as const,
      validatedAt: oldPublishedAt,
      publishedAt: oldPublishedAt,
      supersededAt: "2026-09-04T00:00:00Z",
    };
    input.canonical.snapshot.lifecycle = lifecycle;
    input.canonical.snapshot.contentHash = sourceHashSchema.parse(
      computeContentAuthoringSnapshotHash(input.canonical.snapshot),
    );
    input.canonical.action = "ROLLBACK";
    input.canonical.evaluatedAt = "2026-09-05T00:00:00Z";
    if (input.canonical.candidate.objectKind !== "POLICY")
      throw new Error("fixture");
    input.canonical.candidate.revision.lifecycle = lifecycle;
    input.canonical.candidate.action = "ROLLBACK";
    input.canonical.candidate.evaluatedAt = input.canonical.evaluatedAt;
    input.canonical.candidate.currentPublication!.action = "ROLLBACK";
    input.publication.action = "ROLLBACK";
    input.publication.publishedAt = input.canonical.evaluatedAt;
    expect(projectPublishedContent(input).outcome).toBe("FAILURE");
    input.canonical.previousPublication = {
      publicationId: preflightFixtureId(9600),
      target: input.publication.target,
      action: "PUBLISH",
      publishedAt: oldPublishedAt,
    };
    expect(projectPublishedContent(input).outcome).toBe("SUCCESS");
    input.canonical.previousPublication.publicationId =
      input.publication.publicationId;
    expect(projectPublishedContent(input).outcome).toBe("FAILURE");
  });
  test("publication time binds the precise lifecycle event rather than an adjacent microsecond", () => {
    const input = fixture("POLICY");
    input.publication.publishedAt = "2026-09-03T02:59:59.999999Z";
    expect(projectPublishedContent(input).outcome).toBe("FAILURE");
  });
  test("new detail blocks and aliases project with explicit format and locale scope", () => {
    const gift = projectPublishedContent(fixture("GIFT", true));
    expect(
      gift.outcome === "SUCCESS" &&
        gift.content.kind === "GIFT" &&
        gift.content.details.format,
    ).toBe("BLOCKS");
    const legacy = projectPublishedContent(fixture("GIFT"));
    expect(
      legacy.outcome === "SUCCESS" &&
        legacy.content.kind === "GIFT" &&
        legacy.content.details.format,
    ).toBe("LEGACY_TEXT");
    const input = fixture("IDOL", true);
    input.locale = "ja";
    const idol = projectPublishedContent(input);
    expect(idol.outcome).toBe("SUCCESS");
    if (idol.outcome === "SUCCESS" && idol.content.kind === "IDOL")
      expect(
        idol.content.aliases.every(
          (row) => row.locale === null || row.locale === "ja",
        ),
      ).toBe(true);
  });
  test("current rights revoke a public object while sold-out inventory does not", () => {
    const input = fixture("GIFT");
    if (input.canonical.candidate.objectKind !== "GIFT")
      throw new Error("fixture");
    input.canonical.candidate.inventoryBalances = [];
    input.canonical.candidate.prices = [];
    expect(projectPublishedContent(input).outcome).toBe("SUCCESS");
    input.canonical.candidate.mediaAssets[0]!.rightsStatus = "REJECTED";
    expect(projectPublishedContent(input).outcome).toBe("FAILURE");
  });
});
