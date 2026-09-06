import { describe, expect, test } from "vitest";
import {
  publicationPreflightFixture,
  withPreflightExtensions,
} from "./publication-preflight-fixtures.js";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
  serializePublicationManifest,
  verifyPublicationManifest,
} from "./publication-manifest.js";
import {
  mediaAssetSchema,
  mediaVariantSchema,
  publicationManifestSchema,
  mediaImageProcessingCommandSchema,
  sourceHashSchema,
  translationApprovalEvidenceSchema,
} from "@fan-support/contracts";
import {
  hashMediaProcessingCommand,
  mediaProcessingObjectKey,
} from "./media-processing.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { preflightFixtureId } from "./publication-preflight-fixtures.js";

test("publication proof records eligible derivatives while new unfinished variants stay private", () => {
  const context = publicationPreflightFixture("MEDIA_METADATA");
  if (context.candidate.objectKind !== "MEDIA_METADATA")
    throw new Error("fixture");
  const current = buildPublicationManifest(context);
  context.candidate.variants.push(
    mediaVariantSchema.parse({
      ...context.candidate.variants[0]!,
      id: preflightFixtureId(9901),
      width: 1,
      height: 1,
      objectKey: "fixtures/private-processing.avif",
      status: "PROCESSING",
    }),
  );
  expect(buildPublicationManifest(context).media.variants).toEqual(
    current.media.variants,
  );
  expect(verifyPublicationManifest(current, context)).toBe(true);
});

describe("stable publication bundle", () => {
  for (const kind of [
    "IDOL",
    "GIFT",
    "HOMEPAGE",
    "POLICY",
    "MEDIA_METADATA",
  ] as const)
    test(`${kind} retains full proof and verifies against canonical facts`, () => {
      const context = publicationPreflightFixture(kind);
      const manifest = buildPublicationManifest(context);
      expect(manifest.target).toEqual(context.target);
      expect(manifest.revision.content).toEqual(context.snapshot.content);
      expect(computePublicationManifestHash(manifest)).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(verifyPublicationManifest(manifest, context)).toBe(true);
      const decoded = publicationManifestSchema.parse(
        JSON.parse(serializePublicationManifest(manifest)),
      );
      expect(computePublicationManifestHash(decoded)).toBe(
        computePublicationManifestHash(manifest),
      );
    });
  test("lifecycle, head, time, prices and rights do not alter immutable hash", () => {
    const context = publicationPreflightFixture("GIFT");
    const expected = computePublicationManifestHash(
      buildPublicationManifest(context),
    );
    context.evaluatedAt = "2027-01-01T00:00:00Z";
    context.headVersion += 1;
    context.snapshot.headVersion += 1;
    context.snapshot.lifecycle = { status: "DRAFT" };
    if (context.candidate.objectKind !== "GIFT") throw new Error("fixture");
    context.candidate.mediaAssets[0]!.rightsStatus = "REJECTED";
    context.candidate.mediaAssets[0]!.rightsReference =
      "changed current reference";
    context.candidate.prices = [];
    context.candidate.inventoryBalances = [];
    expect(
      computePublicationManifestHash(buildPublicationManifest(context)),
    ).toBe(expected);
    expect(
      verifyPublicationManifest(buildPublicationManifest(context), context),
    ).toBe(false);
  });
  test("unordered evidence and localized rows are canonical sets, text bytes are not normalized", () => {
    const manifest = buildPublicationManifest(
      publicationPreflightFixture("POLICY"),
    );
    const expected = computePublicationManifestHash(manifest);
    manifest.revision.content.translations.reverse();
    manifest.revision.translationAudits.reverse();
    manifest.approvals.reverse();
    expect(computePublicationManifestHash(manifest)).toBe(expected);
    if (manifest.revision.content.kind !== "POLICY") throw new Error("fixture");
    manifest.revision.content.translations[0]!.fields.title = "Cafe\u0301";
    const decomposed = computePublicationManifestHash(manifest);
    manifest.revision.content.translations[0]!.fields.title = "Café";
    expect(computePublicationManifestHash(manifest)).not.toBe(decomposed);
  });
  test("UUID case and equivalent UTC instants canonicalize without rewriting text", () => {
    const manifest = buildPublicationManifest(
      publicationPreflightFixture("POLICY"),
    );
    const expected = computePublicationManifestHash(manifest);
    manifest.revision.createdAt = manifest.revision.createdAt.replace(
      "Z",
      "+00:00",
    );
    manifest.revision.revisionId = manifest.revision.revisionId.toUpperCase();
    expect(computePublicationManifestHash(manifest)).toBe(expected);
  });
  test("a later legitimate shared-source edge is checked without invalidating the frozen bundle", () => {
    const context = publicationPreflightFixture("MEDIA_METADATA");
    if (context.candidate.objectKind !== "MEDIA_METADATA")
      throw new Error("fixture");
    const master = context.candidate.asset;
    master.width = 1200;
    master.height = 1200;
    master.mimeType = "image/png";
    master.objectKey = mediaProcessingObjectKey(
      master.checksumSha256,
      "PNG",
    ) as typeof master.objectKey;
    const source = mediaAssetSchema.parse({
      ...master,
      id: preflightFixtureId(8001),
      checksumSha256: "c".repeat(64),
      objectKey: "original/source.jpeg",
      mimeType: "image/jpeg",
      width: 2400,
      height: 2400,
    });
    const command = mediaImageProcessingCommandSchema.parse({
      schemaVersion: 1,
      profileVersion: 1,
      source: {
        assetId: source.id,
        metadataRevisionId: preflightFixtureId(8002),
        checksumSha256: source.checksumSha256,
        objectKey: source.objectKey,
        mimeType: source.mimeType,
        byteSize: source.byteSize,
        width: source.width,
        height: source.height,
      },
      role: "GIFT_PRIMARY",
      fit: "COVER",
      focalPoint: { x: 0.5, y: 0.5 },
    });
    context.mediaLineage = [
      {
        assetId: master.id,
        identityKind: "PROCESSED_MASTER",
        processing: [
          {
            jobId: preflightFixtureId(8003),
            status: "SUCCEEDED",
            command,
            commandHash: sourceHashSchema.parse(
              hashMediaProcessingCommand(command),
            ),
            sourceAsset: source,
            sourceIdentityKind: "SOURCE",
            outputAssetId: master.id,
            output: {
              mediaAssetId: master.id,
              checksumSha256: master.checksumSha256,
              objectKey: master.objectKey,
              width: master.width,
              height: master.height,
              byteSize: master.byteSize,
            },
          },
        ],
      },
    ];
    const manifest = buildPublicationManifest(context);
    expect(verifyPublicationManifest(manifest, context)).toBe(true);
    const extra = structuredClone(context.mediaLineage[0]!.processing[0]!);
    extra.jobId = preflightFixtureId(8004);
    extra.sourceAsset.id = preflightFixtureId(
      8005,
    ) as typeof extra.sourceAsset.id;
    extra.command.source.assetId = extra.sourceAsset.id;
    extra.commandHash = sourceHashSchema.parse(
      hashMediaProcessingCommand(extra.command),
    );
    context.mediaLineage[0]!.processing.push(extra);
    expect(verifyPublicationManifest(manifest, context)).toBe(true);
    extra.sourceAsset.rightsStatus = "REJECTED";
    expect(verifyPublicationManifest(manifest, context)).toBe(false);
    extra.sourceAsset.rightsStatus = "APPROVED";
    context.mediaLineage[0]!.processing.shift();
    expect(verifyPublicationManifest(manifest, context)).toBe(false);
  });
  test("unchanged approval copies require their exact historical edge, never an inherited hint alone", () => {
    const context = publicationPreflightFixture("POLICY");
    const audit = context.snapshot.translationAudits.find(
      (row) => row.locale === "ja",
    )!;
    const source = {
      ...structuredClone(audit),
      id: preflightFixtureId(8100),
      reviewId: preflightFixtureId(8101),
    };
    const revisionId = preflightFixtureId(8102);
    audit.inheritedFrom = {
      revisionId,
      translationId: source.id,
      reviewId: source.reviewId,
    };
    const approval = context.approvals.find(
      (row) => row.translationRevisionId === audit.id,
    )!;
    context.copies = [
      {
        target: { ...context.target, locale: "ja" },
        targetTranslationId: audit.id,
        targetReviewId: audit.reviewId,
        authoringReceiptId: preflightFixtureId(8103),
        source: {
          target: { ...context.target, revisionId, locale: "ja" },
          text: {
            kind: "POLICY",
            fields: context.snapshot.content.translations.find(
              (row) => row.locale === "ja",
            )!.fields,
          } as never,
          audit: source,
        },
        sourceApproval: translationApprovalEvidenceSchema.parse({
          ...approval,
          approvalId: source.reviewId,
          translationRevisionId: source.id,
          policyRevisionId: revisionId,
        }),
      },
    ];
    context.snapshot.contentHash = sourceHashSchema.parse(
      computeContentAuthoringSnapshotHash(context.snapshot),
    );
    const manifest = buildPublicationManifest(context);
    expect(verifyPublicationManifest(manifest, context)).toBe(true);
    const decoded = publicationManifestSchema.parse(
      JSON.parse(serializePublicationManifest(manifest)),
    );
    expect(decoded.copies[0]!.sourceApproval.reviewedFieldPaths).toEqual(
      manifest.copies[0]!.sourceApproval.reviewedFieldPaths,
    );
    const altered = structuredClone(manifest);
    altered.copies[0]!.source.audit.reviewId = preflightFixtureId(8104);
    expect(verifyPublicationManifest(altered, context)).toBe(false);
    context.copies = [];
    expect(
      verifyPublicationManifest(buildPublicationManifest(context), context),
    ).toBe(false);
  });
  test("extension block order and immutable asset tuples alter the bundle", () => {
    const context = withPreflightExtensions(
      publicationPreflightFixture("GIFT"),
    );
    const manifest = buildPublicationManifest(context);
    const original = computePublicationManifestHash(manifest);
    manifest.media.assets[0]!.byteSize += 1;
    expect(computePublicationManifestHash(manifest)).not.toBe(original);
    expect(verifyPublicationManifest(manifest, context)).toBe(false);
  });
  test("missing, forged and extra revision approvals fail exact verification", () => {
    const context = publicationPreflightFixture("POLICY");
    const manifest = buildPublicationManifest(context);
    manifest.approvals.pop();
    expect(verifyPublicationManifest(manifest, context)).toBe(false);
    expect(verifyPublicationManifest({}, context)).toBe(false);
    const forged = buildPublicationManifest(context);
    forged.revision.translationAudits[0]!.sourceHash = "b".repeat(
      64,
    ) as (typeof forged.revision.translationAudits)[0]["sourceHash"];
    expect(verifyPublicationManifest(forged, context)).toBe(false);
  });
});
