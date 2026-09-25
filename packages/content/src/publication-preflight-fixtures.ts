import {
  baseContentTextSchema,
  contentAuthoringSnapshotSchema,
  publicationPreflightContextSchema,
  translationApprovalEvidenceSchema,
  type ContentAuthoringSnapshot,
  type PublicationPreflightContext,
} from "@fan-support/contracts";
import {
  fictionalGiftPublicationCandidate,
  fictionalGiftApprovalEvidence,
} from "./fixtures.js";
import { fictionalContentModelFixture } from "./model-fixtures.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import {
  idolAliasSetSchema,
  sourceHashSchema,
  giftDetailDocumentSchema,
  giftDetailDraftResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { computeIdolAliasContentHash } from "./content-drafts.js";
import { computeGiftDetailTranslationContentHash } from "./gift-details.js";

// Test support only: deliberately fictional, never exported from the package entry point.

type Kind = PublicationPreflightContext["target"]["owner"]["kind"];
const fields = {
  IDOL: ["displayName", "shortBio", "fullBio", "seoTitle", "seoDescription"],
  GIFT: [
    "title",
    "subtitle",
    "shortDescription",
    "description",
    "fulfillmentDescription",
    "variantLabels",
    "safetyNotice",
    "seoTitle",
    "seoDescription",
  ],
  HOMEPAGE: [
    "heroTitle",
    "heroSubtitle",
    "ctaLabel",
    "announcement",
    "slotLabels",
    "seoTitle",
    "seoDescription",
  ],
  POLICY: ["title", "summary", "body"],
  MEDIA_METADATA: ["alt", "title", "caption"],
} as const;
const parent = {
  IDOL: "idolRevisionId",
  GIFT: "giftRevisionId",
  HOMEPAGE: "homepageRevisionId",
  POLICY: "policyRevisionId",
  MEDIA_METADATA: "mediaMetadataRevisionId",
} as const;
const structure = {
  IDOL: ["themeAccent", "heroTextTone", "displayOrder"],
  GIFT: [
    "category",
    "contents",
    "deliveryEstimate",
    "requiresSafetyNotice",
    "shippingMode",
  ],
  HOMEPAGE: [],
  POLICY: ["kind", "effectiveAt"],
  MEDIA_METADATA: ["presentationKind", "focalPoint"],
} as const;
function pick(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}
export function preflightFixtureId(index: number) {
  return `71000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}
function approvals(kind: Kind, rows: readonly unknown[], offset: number) {
  return rows.map((value, index) => {
    const row = value as Record<string, unknown>;
    const review = row["review"] as Record<string, unknown>;
    return translationApprovalEvidenceSchema.parse({
      schemaVersion: 1,
      approvalId: preflightFixtureId(offset + index),
      objectKind: kind,
      translationRevisionId: row["id"],
      [parent[kind]]: row[parent[kind]],
      ...pick(row, ["locale", "origin", "importBatchId", "editorId"]),
      approvedSourceHash: row["translatedFromSourceHash"],
      approvedContentHash: row["sourceHash"],
      reviewerId: review["reviewerId"],
      reviewedAt: review["reviewedAt"],
      reviewedFieldPaths: fields[kind],
    });
  });
}
function fixtureOwner(kind: Kind, revision: Record<string, unknown>) {
  switch (kind) {
    case "IDOL":
      return { kind, idolId: revision["idolId"] };
    case "GIFT":
      return { kind, giftId: revision["giftId"] };
    case "POLICY":
      return { kind, policyKey: revision["policyKey"] };
    case "MEDIA_METADATA":
      return { kind, mediaAssetId: revision["mediaAssetId"] };
    case "HOMEPAGE":
      return { kind };
  }
}
function candidateFixture(kind: Kind): Record<string, unknown> {
  const fixture = fictionalContentModelFixture;
  const common = {
    schemaVersion: 1,
    objectKind: kind,
    action: "PUBLISH",
    currentPublication: null,
    evaluatedAt: "2026-09-03T03:00:00Z",
  };
  switch (kind) {
    case "GIFT":
      return structuredClone(fictionalGiftPublicationCandidate);
    case "IDOL":
      return {
        ...common,
        targetOperationalStatus: "active",
        targetAcceptingGifts: true,
        base: {
          ...fixture.idol.base,
          status: "draft",
          acceptingGifts: false,
          draftRevisionId: fixture.idol.revision.id,
          publishedRevisionId: null,
        },
        revision: fixture.idol.revision,
        translations: fixture.idol.translations,
        mediaReferences: fixture.idol.media,
        mediaAssets: fixture.idol.assets,
        mediaVariants: fixture.idol.variants,
        mediaMetadataRevisions: fixture.idol.metadataRevisions,
        mediaTranslations: fixture.idol.mediaTranslations,
      };
    case "POLICY":
      return {
        ...common,
        currentPublishedRevisionId: null,
        revision: fixture.policy.revision,
        translations: fixture.policy.translations,
      };
    case "HOMEPAGE": {
      const hero = fixture.homepage.slots.find(
        (slot) => slot.kind === "HERO_IDOL",
      )!;
      const ids = [hero.desktopMediaAssetId, hero.mobileMediaAssetId];
      const metadataIds = [
        hero.desktopMediaMetadataRevisionId,
        hero.mobileMediaMetadataRevisionId,
      ];
      return {
        ...common,
        currentPublishedRevisionId: null,
        revision: fixture.homepage.revision,
        translations: fixture.homepage.translations,
        slots: fixture.homepage.slots,
        referencedIdols: [fixture.idol.base],
        referencedGifts: [],
        referencedPolicies: [],
        mediaAssets: fixture.idol.assets.filter((asset) =>
          ids.includes(asset.id),
        ),
        mediaVariants: fixture.idol.variants.filter((variant) =>
          ids.includes(variant.mediaAssetId),
        ),
        mediaMetadataRevisions: fixture.idol.metadataRevisions.filter((row) =>
          metadataIds.includes(row.id),
        ),
        mediaTranslations: fixture.idol.mediaTranslations.filter((row) =>
          metadataIds.includes(row.mediaMetadataRevisionId),
        ),
      };
    }
    case "MEDIA_METADATA":
      return {
        objectKind: kind,
        currentPublishedRevisionId: null,
        currentPublication: null,
        asset: fictionalGiftPublicationCandidate.mediaAssets[0],
        variants: fictionalGiftPublicationCandidate.mediaVariants,
      };
  }
}
function snapshot(
  kind: Kind,
  revision: Record<string, unknown>,
  rows: readonly unknown[],
  proofs: PublicationPreflightContext["approvals"],
  extras: Record<string, unknown> = {},
): ContentAuthoringSnapshot {
  const owner = fixtureOwner(kind, revision);
  const value = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target: owner,
    revisionId: revision["id"],
    revisionNumber: revision["revision"],
    headVersion: revision["revision"],
    lifecycle: revision["lifecycle"],
    createdBy: revision["createdBy"],
    createdAt: revision["createdAt"],
    contentHash: "a".repeat(64),
    content: {
      kind,
      structure: pick(revision, structure[kind]),
      ...extras,
      translations: rows.map((value) => {
        const row = value as Record<string, unknown>;
        return {
          ...pick(row, ["locale", "origin", "importBatchId"]),
          fields: baseContentTextSchema.parse({
            kind,
            fields: pick(row, fields[kind]),
          }).fields,
        };
      }),
    },
    translationAudits: rows.map((value) => {
      const row = value as Record<string, unknown>;
      return {
        ...pick(row, [
          "id",
          "locale",
          "origin",
          "importBatchId",
          "sourceHash",
          "translatedFromSourceHash",
          "editorId",
          "editedAt",
          "review",
        ]),
        reviewId: proofs.find(
          (proof) => proof.translationRevisionId === row["id"],
        )!.approvalId,
        reviewSequence: 3,
      };
    }),
    extensions: {},
  });
  return contentAuthoringSnapshotSchema.parse({
    ...value,
    contentHash: computeContentAuthoringSnapshotHash(value),
  });
}
export function publicationPreflightFixture(
  kind: Kind = "GIFT",
): PublicationPreflightContext {
  const candidate = candidateFixture(kind);
  const revision = structuredClone(
    (kind === "MEDIA_METADATA"
      ? fictionalGiftPublicationCandidate.mediaMetadataRevisions[0]
      : candidate["revision"]) as Record<string, unknown>,
  );
  revision["lifecycle"] = { status: "DRAFT" };
  const rows = (
    kind === "MEDIA_METADATA"
      ? fictionalGiftPublicationCandidate.mediaTranslations
      : candidate["translations"]
  ) as unknown[];
  if (kind !== "MEDIA_METADATA") candidate["revision"] = revision;
  const allApprovals =
    kind === "GIFT"
      ? structuredClone(fictionalGiftApprovalEvidence)
      : approvals(kind, rows, 100);
  const metadata = (candidate["mediaMetadataRevisions"] ?? []) as Record<
    string,
    unknown
  >[];
  const mediaRows = (candidate["mediaTranslations"] ?? []) as Record<
    string,
    unknown
  >[];
  if (kind !== "GIFT")
    allApprovals.push(...approvals("MEDIA_METADATA", mediaRows, 500));
  let extra: Record<string, unknown> = {};
  if (kind === "IDOL" || kind === "GIFT") {
    extra = {
      media: (candidate["mediaReferences"] as Record<string, unknown>[]).map(
        (row) =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => key !== "schemaVersion" && key !== parent[kind],
            ),
          ),
      ),
    };
  } else if (kind === "HOMEPAGE") {
    extra = {
      structure: {
        slots: (candidate["slots"] as Record<string, unknown>[]).map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([key]) =>
                key !== "schemaVersion" && key !== "homepageRevisionId",
            ),
          ),
        ),
      },
    };
  }
  const main = snapshot(kind, revision, rows, allApprovals, extra);
  const mediaSnapshots = metadata.map((rev) =>
    snapshot(
      "MEDIA_METADATA",
      rev,
      mediaRows.filter((row) => row["mediaMetadataRevisionId"] === rev["id"]),
      allApprovals,
    ),
  );
  const assets = (
    kind === "MEDIA_METADATA"
      ? [candidate["asset"]]
      : (candidate["mediaAssets"] ?? [])
  ) as Record<string, unknown>[];
  return publicationPreflightContextSchema.parse({
    schemaVersion: 1,
    target: { owner: main.target, revisionId: main.revisionId },
    action: "PUBLISH",
    headVersion: 0,
    previousPublication: null,
    evaluatedAt: "2026-09-03T03:00:00Z",
    snapshot: main,
    candidate,
    mediaSnapshots,
    approvals: allApprovals,
    copies: [],
    extensionApprovals: [],
    mediaLineage: assets.map((asset) => ({
      assetId: asset["id"],
      identityKind: "SOURCE",
      processing: [],
    })),
  });
}
export function withPreflightExtensions(
  context: PublicationPreflightContext,
): PublicationPreflightContext {
  const value = structuredClone(context);
  const snapshot = value.snapshot;
  const editor = snapshot.createdBy;
  const reviewer = preflightFixtureId(900);
  const editedAt = "2026-09-03T02:00:00Z";
  const reviewedAt = "2026-09-03T02:15:00Z";
  if (snapshot.content.kind === "IDOL") {
    const aliases = [
      { id: "stage-name", locale: null, text: "Fictional stage name" },
    ];
    const hash = computeIdolAliasContentHash(aliases);
    snapshot.content.aliases = aliases;
    snapshot.extensions.aliases = idolAliasSetSchema.parse({
      schemaVersion: 1,
      id: preflightFixtureId(901),
      idolRevisionId: snapshot.revisionId,
      aliases,
      contentHash: hash,
      editorId: editor,
      editedAt,
      review: {
        status: "APPROVED",
        reviewerId: reviewer,
        reviewedAt,
        reviewedContentHash: hash,
      },
    });
    value.extensionApprovals.push({
      kind: "IDOL_ALIASES",
      revisionId: snapshot.revisionId,
      subjectId: preflightFixtureId(901),
      reviewId: preflightFixtureId(902),
      sequence: 3,
      auditLogId: preflightFixtureId(903),
      editorId: editor,
      structureEditorId: editor,
      reviewerId: reviewer,
      editedAt,
      reviewedAt,
      contentHash: sourceHashSchema.parse(hash),
      sourceHash: null,
    });
  } else if (snapshot.content.kind === "GIFT") {
    const document = giftDetailDocumentSchema.parse({
      schemaVersion: 1,
      id: preflightFixtureId(910),
      giftRevisionId: snapshot.revisionId,
      blocks: [{ id: "description", kind: "PARAGRAPH" }],
    });
    const blocks = [
      {
        blockId: "description",
        kind: "PARAGRAPH" as const,
        text: "A fictional independently reviewed detail.",
      },
    ];
    const hash = sourceHashSchema.parse(
      computeGiftDetailTranslationContentHash(document, { blocks }),
    );
    const translations = SUPPORTED_LOCALES.map((locale, index) => ({
      schemaVersion: 1,
      id: preflightFixtureId(920 + index),
      documentId: document.id,
      giftRevisionId: snapshot.revisionId,
      locale,
      origin: "HUMAN" as const,
      blocks,
      sourceHash: hash,
      translatedFromSourceHash: hash,
      editorId: editor,
      editedAt,
      review: {
        status: "APPROVED" as const,
        reviewerId: reviewer,
        reviewedAt,
        reviewedContentHash: hash,
        reviewedSourceHash: hash,
      },
    }));
    const details = giftDetailDraftResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      document,
      translations,
    });
    if (details.outcome === "FAILURE") throw new Error("invalid test details");
    snapshot.extensions.details = details;
    snapshot.content.details = {
      blocks: document.blocks,
      translations: translations.map(({ locale, origin, blocks }) => ({
        locale,
        origin,
        blocks,
      })),
    };
    value.extensionApprovals.push(
      ...translations.map((row, index) => ({
        kind: "GIFT_DETAILS" as const,
        revisionId: snapshot.revisionId,
        subjectId: row.id,
        reviewId: preflightFixtureId(940 + index),
        sequence: 3 as const,
        auditLogId: preflightFixtureId(950 + index),
        editorId: editor,
        structureEditorId: editor,
        reviewerId: reviewer,
        editedAt,
        reviewedAt,
        contentHash: hash,
        sourceHash: hash,
        locale: row.locale,
      })),
    );
  }
  return publicationPreflightContextSchema.parse({
    ...value,
    snapshot: {
      ...snapshot,
      contentHash: computeContentAuthoringSnapshotHash(snapshot),
    },
  });
}
