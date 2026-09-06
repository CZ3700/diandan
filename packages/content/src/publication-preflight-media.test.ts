import { describe, expect, test } from "vitest";
import {
  sourceHashSchema,
  mediaAssetSchema,
  mediaImageProcessingCommandSchema,
  type PublicationPreflightContext,
} from "@fan-support/contracts";
import { fictionalContentModelFixture } from "./model-fixtures.js";
import {
  hashMediaProcessingCommand,
  mediaProcessingObjectKey,
} from "./media-processing.js";
import { validatePreflightMediaLineage } from "./publication-preflight-media.js";
import { publicationPreflightFixture } from "./publication-preflight-fixtures.js";

type Input = Pick<PublicationPreflightContext, "candidate" | "mediaLineage">;
const id = (n: number) =>
  `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function asset(n = 1) {
  return mediaAssetSchema.parse({
    schemaVersion: 1,
    id: id(n),
    checksumSha256: String(n).repeat(64).slice(0, 64),
    mimeType: "image/jpeg",
    width: 3000,
    height: 4000,
    byteSize: 200,
    objectKey: `original/${n}.jpg`,
    processingStatus: "READY",
    rightsStatus: "APPROVED",
    rightsReference: "fixture-rights",
    createdAt: "2026-09-01T00:00:00Z",
  });
}
function sourceInput(): Input {
  const source = asset();
  return {
    candidate: {
      objectKind: "MEDIA_METADATA",
      currentPublication: null,
      currentPublishedRevisionId: null,
      asset: source,
      variants: [],
    },
    mediaLineage: [
      { assetId: source.id, identityKind: "SOURCE", processing: [] },
    ],
  };
}
function masterInput(): Input {
  const source = asset(1);
  const master = mediaAssetSchema.parse({
    ...asset(2),
    mimeType: "image/png",
    width: 1600,
    height: 2000,
    objectKey: mediaProcessingObjectKey(asset(2).checksumSha256, "PNG"),
  });
  const command = mediaImageProcessingCommandSchema.parse({
    schemaVersion: 1,
    profileVersion: 1,
    role: "PORTRAIT",
    fit: "COVER",
    focalPoint: { x: 0.5, y: 0.5 },
    source: {
      assetId: source.id,
      metadataRevisionId: id(4),
      checksumSha256: source.checksumSha256,
      mimeType: source.mimeType,
      objectKey: source.objectKey,
      byteSize: source.byteSize,
      width: source.width,
      height: source.height,
    },
  });
  return {
    candidate: {
      objectKind: "MEDIA_METADATA",
      currentPublication: null,
      currentPublishedRevisionId: null,
      asset: master,
      variants: [],
    },
    mediaLineage: [
      {
        assetId: master.id,
        identityKind: "PROCESSED_MASTER",
        processing: [
          {
            jobId: id(3),
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
    ],
  };
}
const codes = (input: Input) =>
  validatePreflightMediaLineage(input).map((value) => value.code);
describe("publication preflight media lineage", () => {
  test.each(["IDOL", "HOMEPAGE"] as const)(
    "%s dual masters must have disjoint original IDs and checksums",
    (kind) => {
      const input = publicationPreflightFixture(kind);
      const candidate = input.candidate;
      if (
        candidate.objectKind !== "IDOL" &&
        candidate.objectKind !== "HOMEPAGE"
      )
        throw new Error("fixture");
      const pair =
        candidate.objectKind === "IDOL"
          ? {
              desktop: candidate.mediaReferences.find(
                (v) => v.role === "HERO_DESKTOP",
              )!.mediaAssetId,
              mobile: candidate.mediaReferences.find(
                (v) => v.role === "HERO_MOBILE",
              )!.mediaAssetId,
            }
          : (() => {
              const hero = candidate.slots.find((v) => v.kind === "HERO_IDOL")!;
              if (hero.kind !== "HERO_IDOL") throw new Error("fixture");
              return {
                desktop: hero.desktopMediaAssetId,
                mobile: hero.mobileMediaAssetId,
              };
            })();
      const proofs: PublicationPreflightContext["mediaLineage"][number]["processing"][number][] =
        [];
      for (const [index, [assetId, role]] of (
        [
          [pair.desktop, "HERO_DESKTOP"],
          [pair.mobile, "HERO_MOBILE"],
        ] as const
      ).entries()) {
        const master = candidate.mediaAssets.find((v) => v.id === assetId)!;
        master.mimeType = "image/png";
        master.objectKey = mediaProcessingObjectKey(
          master.checksumSha256,
          "PNG",
        );
        const lineage = input.mediaLineage.find(
          (v) => v.assetId === master.id,
        )!;
        const proof = masterInput().mediaLineage[0]!.processing[0]!;
        proof.jobId = id(30 + index);
        proof.command.role = role;
        proof.commandHash = hashMediaProcessingCommand(proof.command) as never;
        proof.outputAssetId = master.id;
        proof.output = {
          mediaAssetId: master.id,
          checksumSha256: master.checksumSha256,
          objectKey: master.objectKey,
          width: master.width,
          height: master.height,
          byteSize: master.byteSize,
        };
        lineage.identityKind = "PROCESSED_MASTER";
        lineage.processing = [proof];
        proofs.push(proof);
      }
      expect(codes(input)).toEqual(["HERO_ORIGINAL_SOURCE_REUSED"]);
      const mobile = proofs[1]!;
      mobile.sourceAsset.id = id(90) as never;
      mobile.command.source.assetId = mobile.sourceAsset.id;
      mobile.commandHash = hashMediaProcessingCommand(mobile.command) as never;
      expect(codes(input)).toEqual(["HERO_ORIGINAL_SOURCE_REUSED"]);
      mobile.sourceAsset.checksumSha256 = "f".repeat(64) as never;
      mobile.command.source.checksumSha256 = mobile.sourceAsset.checksumSha256;
      mobile.commandHash = hashMediaProcessingCommand(mobile.command) as never;
      expect(codes(input)).toEqual([]);
      mobile.jobId = proofs[0]!.jobId;
      expect(codes(input)).toContain("MEDIA_PROVENANCE_MISMATCH");
    },
  );
  test("accepts canonical legacy sources and precisely bound processed masters without mutation", () => {
    for (const input of [sourceInput(), masterInput()]) {
      const before = structuredClone(input);
      expect(codes(input)).toEqual([]);
      expect(input).toEqual(before);
    }
  });
  test("requires one explicit lineage row for each candidate asset", () => {
    const input = sourceInput();
    input.mediaLineage = [];
    expect(codes(input)).toContain("MEDIA_PROVENANCE_MISSING");
    input.mediaLineage = [
      ...sourceInput().mediaLineage,
      ...sourceInput().mediaLineage,
    ];
    expect(codes(input)).toContain("MEDIA_PROVENANCE_MISMATCH");
  });
  test("standalone metadata blockers point to its actual asset field", () => {
    const input = sourceInput();
    input.mediaLineage = [];
    expect(validatePreflightMediaLineage(input)[0]?.path).toEqual([
      "candidate",
      "asset",
    ]);
  });
  test("rejects unrelated lineage and a master with no successful origin", () => {
    const input = masterInput();
    input.mediaLineage[0]!.processing = [];
    expect(codes(input)).toContain("MEDIA_PROVENANCE_MISSING");
    input.mediaLineage.push({
      assetId: id(9),
      identityKind: "SOURCE",
      processing: [],
    });
    expect(codes(input)).toContain("MEDIA_PROVENANCE_MISMATCH");
  });
  test.each(["PENDING", "REJECTED", "EXPIRED"] as const)(
    "a second shared original with %s rights blocks the master",
    (rightsStatus) => {
      const input = masterInput();
      const second = structuredClone(input.mediaLineage[0]!.processing[0]!);
      second.jobId = id(5);
      second.sourceAsset.rightsStatus = rightsStatus;
      input.mediaLineage[0]!.processing.push(second);
      expect(codes(input)).toContain("MEDIA_ORIGINAL_RIGHTS_NOT_APPROVED");
    },
  );
  test.each(["FAILED", "PROCESSING", "PENDING"] as const)(
    "%s jobs never establish processed provenance",
    (status) => {
      const input = masterInput();
      input.mediaLineage[0]!.processing[0]!.status = status;
      expect(codes(input)).toContain("MEDIA_PROVENANCE_MISMATCH");
    },
  );
  test("rejects archived origins, processed-as-source, duplicate jobs, and forged output/source/hash fields", () => {
    const changes: ((input: Input) => void)[] = [
      (v) => {
        v.mediaLineage[0]!.processing[0]!.sourceAsset.processingStatus =
          "ARCHIVED";
      },
      (v) => {
        v.mediaLineage[0]!.processing[0]!.sourceIdentityKind =
          "PROCESSED_MASTER";
      },
      (v) => {
        v.mediaLineage[0]!.processing.push(
          structuredClone(v.mediaLineage[0]!.processing[0]!),
        );
      },
      (v) => {
        v.mediaLineage[0]!.processing[0]!.outputAssetId = id(9);
      },
      (v) => {
        v.mediaLineage[0]!.processing[0]!.output.width++;
      },
      (v) => {
        v.mediaLineage[0]!.processing[0]!.sourceAsset.width++;
      },
      (v) => {
        v.mediaLineage[0]!.processing[0]!.commandHash = "a".repeat(64) as never;
      },
    ];
    for (const change of changes) {
      const input = masterInput();
      change(input);
      expect(codes(input).length).toBeGreaterThan(0);
    }
  });
  test("dual hero source identity cannot be hidden behind distinct masters or IDs", () => {
    const base = fictionalContentModelFixture.idol;
    const input: Input = {
      candidate: {
        schemaVersion: 1,
        action: "PUBLISH",
        evaluatedAt: "2026-09-06T00:00:00Z",
        objectKind: "IDOL",
        currentPublication: null,
        targetOperationalStatus: "active",
        targetAcceptingGifts: true,
        base: base.base,
        revision: base.revision,
        translations: base.translations,
        mediaReferences: base.references,
        mediaAssets: structuredClone(base.assets),
        mediaVariants: base.variants,
        mediaMetadataRevisions: base.metadataRevisions,
        mediaTranslations: base.mediaTranslations,
      },
      mediaLineage: base.assets.map((value) => ({
        assetId: value.id,
        identityKind: "SOURCE",
        processing: [],
      })),
    };
    expect(codes(input)).toEqual([]);
    if (input.candidate.objectKind !== "IDOL") throw new Error("fixture");
    const desktop = input.candidate.mediaAssets.find(
      (v) =>
        v.id ===
        base.references.find((r) => r.role === "HERO_DESKTOP")!.mediaAssetId,
    )!;
    const mobile = input.candidate.mediaAssets.find(
      (v) =>
        v.id ===
        base.references.find((r) => r.role === "HERO_MOBILE")!.mediaAssetId,
    )!;
    mobile.checksumSha256 = desktop.checksumSha256;
    expect(codes(input)).toContain("HERO_ORIGINAL_SOURCE_REUSED");
  });
});
