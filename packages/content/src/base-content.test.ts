import { describe, expect, test } from "vitest";
import {
  baseContentTargetSchema,
  contentAuthoringContentSchema,
  contentAuthoringSnapshotSchema,
  contentAuthoringTargetSchema,
  type ContentAuthoringContent,
  type ContentAuthoringSnapshot,
  type BaseContentTarget,
  type AppendBaseContentReviewCommand,
} from "@fan-support/contracts";
import {
  computeGiftTranslationContentHash,
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import {
  prepareIdolAliasDraft,
  prepareGiftDetailDraft,
} from "./content-drafts.js";
import {
  projectBaseContentReview,
  projectBaseContentPreview,
  validateBaseContentReviewAction,
  validateBaseContentReviewResponse,
} from "./base-content.js";
const id = (n: number) =>
  `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const editedAt = "2026-09-01T10:00:00.123456Z";
const reviewedAt = "2026-09-01T11:00:00.654321Z";
const createdAt = "2026-09-06T10:00:00.000Z";
const kinds = ["IDOL", "GIFT", "HOMEPAGE", "POLICY", "MEDIA_METADATA"] as const;
type Kind = ContentAuthoringContent["kind"];

function fixture(kind: Kind) {
  const localeRows = (fields: (locale: string) => unknown) =>
    ["en", "ja"].map((locale) => ({
      locale,
      origin: "HUMAN",
      fields: fields(locale),
    }));
  const identity = {
    IDOL: { idolId: id(2) },
    GIFT: { giftId: id(2) },
    HOMEPAGE: {},
    POLICY: { policyKey: "test-policy" },
    MEDIA_METADATA: { mediaAssetId: id(2) },
  };
  const target = contentAuthoringTargetSchema.parse({
    kind,
    ...identity[kind],
  });
  let payload: unknown;
  switch (kind) {
    case "IDOL":
      payload = {
        kind,
        structure: {
          themeAccent: "#D4AF37",
          heroTextTone: "light",
          displayOrder: 0,
        },
        media: [],
        translations: localeRows((locale) => ({
          displayName: `Name ${locale}`,
          shortBio: `Bio ${locale}`,
          fullBio: `Biography ${locale}`,
          seoTitle: `Title ${locale}`,
          seoDescription: `Description ${locale}`,
        })),
      };
      break;
    case "GIFT":
      payload = {
        kind,
        structure: {
          category: "OTHER",
          contents: [{ componentCode: "CARD", quantity: 1, unit: "ITEM" }],
          deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
          requiresSafetyNotice: false,
          shippingMode: "internal_to_idol",
        },
        media: [],
        translations: localeRows((locale) => ({
          title: `Gift ${locale}`,
          shortDescription: `Gift summary ${locale}`,
          description: `Gift details ${locale}`,
          fulfillmentDescription: `Prepared gift ${locale}`,
          variantLabels: [
            { giftVariantId: id(3), label: `Standard ${locale}` },
          ],
          seoTitle: `Title ${locale}`,
          seoDescription: `Description ${locale}`,
        })),
      };
      break;
    case "HOMEPAGE":
      payload = {
        kind,
        structure: {
          slots: [
            {
              kind: "FEATURED_IDOL",
              slotKey: "featured",
              idolId: id(3),
              sortOrder: 0,
            },
          ],
        },
        translations: localeRows((locale) => ({
          heroTitle: `Hero ${locale}`,
          heroSubtitle: `Subtitle ${locale}`,
          ctaLabel: `Browse ${locale}`,
          slotLabels: [{ slotKey: "featured", label: `Featured ${locale}` }],
          seoTitle: `Title ${locale}`,
          seoDescription: `Description ${locale}`,
        })),
      };
      break;
    case "POLICY":
      payload = {
        kind,
        structure: { kind: "TERMS", effectiveAt: createdAt },
        translations: localeRows((locale) => ({
          title: `Policy ${locale}`,
          summary: `Summary ${locale}`,
          body: `Policy body ${locale}`,
        })),
      };
      break;
    case "MEDIA_METADATA":
      payload = {
        kind,
        structure: {
          presentationKind: "INFORMATIVE",
          focalPoint: { x: 0.5, y: 0.5 },
        },
        translations: localeRows((locale) => ({ alt: `Portrait ${locale}` })),
      };
      break;
  }
  return { target, content: contentAuthoringContentSchema.parse(payload) };
}
function textHash(content: ContentAuthoringContent, locale: string): string {
  switch (content.kind) {
    case "IDOL":
      return computeIdolTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "GIFT":
      return computeGiftTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "HOMEPAGE":
      return computeHomepageTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "POLICY":
      return computePolicyTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "MEDIA_METADATA":
      return computeMediaTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
  }
}
function source(kind: Kind): ContentAuthoringSnapshot {
  const { target, content } = fixture(kind);
  const englishHash = textHash(content, "en");
  const snapshot = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target,
    revisionId: id(10),
    revisionNumber: 1,
    headVersion: 1,
    lifecycle: { status: "DRAFT" },
    createdBy: id(4),
    createdAt: editedAt,
    contentHash: "0".repeat(64),
    content,
    extensions: {},
    translationAudits: content.translations.map((row, index) => ({
      id: id(20 + index),
      reviewId: id(30 + index),
      reviewSequence: 3,
      locale: row.locale,
      origin: row.origin,
      sourceHash: textHash(content, row.locale),
      translatedFromSourceHash: englishHash,
      editorId: id(4),
      editedAt,
      review: {
        status: "APPROVED",
        reviewerId: id(5),
        reviewedAt,
        reviewedContentHash: textHash(content, row.locale),
        reviewedSourceHash: englishHash,
      },
    })),
  });
  snapshot.contentHash = computeContentAuthoringSnapshotHash(
    snapshot,
  ) as ContentAuthoringSnapshot["contentHash"];
  return snapshot;
}

function target(
  snapshot: ContentAuthoringSnapshot,
  locale: BaseContentTarget["locale"] = "ja",
): BaseContentTarget {
  return { owner: snapshot.target, revisionId: snapshot.revisionId, locale };
}
function refresh(snapshot: ContentAuthoringSnapshot) {
  snapshot.contentHash = computeContentAuthoringSnapshotHash(
    snapshot,
  ) as ContentAuthoringSnapshot["contentHash"];
  return snapshot;
}
function review(snapshot = source("IDOL")) {
  const result = projectBaseContentReview(snapshot, target(snapshot));
  if (result.outcome !== "SUCCESS") throw new Error("fixture projection");
  return result;
}
function action(
  value = review(),
  actorId = id(9),
): AppendBaseContentReviewCommand {
  return {
    schemaVersion: 1,
    action: "APPROVE",
    target: value.context.target,
    expectedVersion: value.context.audit.reviewSequence,
    expectedContentHash: value.context.audit.sourceHash,
    expectedSourceHash: value.context.currentEnglishSourceHash,
    reasonCode: "CONTENT_REVIEWED",
    actorId,
    requestId: id(99),
  };
}
function inReview() {
  const s = source("IDOL");
  s.translationAudits[1]!.review = {
    status: "IN_REVIEW",
    submittedAt: createdAt,
  };
  s.translationAudits[1]!.reviewSequence = 2;
  return refresh(s);
}
describe("base content projections", () => {
  test("new review validates actual ICU without hiding legacy text on read", () => {
    const s = inReview();
    if (s.content.kind !== "IDOL") throw new Error("fixture");
    s.content.translations[1]!.fields.shortBio = "Hello {name}";
    s.translationAudits[1]!.sourceHash = textHash(
      s.content,
      "ja",
    ) as typeof s.contentHash;
    refresh(s);
    const r = review(s);
    expect(
      validateBaseContentReviewAction(action(r), r.context, r),
    ).toMatchObject({ code: "INVALID_CONTENT" });
  });
  test.each(kinds)(
    "%s gives only selected locale and actual English, without mutating source",
    (kind) => {
      const s = source(kind);
      const before = structuredClone(s);
      const result = projectBaseContentReview(s, target(s));
      expect(result.outcome).toBe("SUCCESS");
      if (result.outcome !== "SUCCESS") return;
      expect(result.content.fields).toEqual(s.content.translations[1]!.fields);
      expect(result.source.fields).toEqual(s.content.translations[0]!.fields);
      expect(result.context.audit.id).toBe(s.translationAudits[1]!.id);
      expect(validateBaseContentReviewResponse(result, target(s))).toBeNull();
      expect(s).toEqual(before);
      const p = projectBaseContentPreview(s, target(s));
      expect(p.outcome).toBe("SUCCESS");
      if (p.outcome !== "SUCCESS") return;
      expect(p.content.fields).toEqual(result.content.fields);
      expect(Object.keys(p).sort()).toEqual([
        "content",
        "outcome",
        "schemaVersion",
        "target",
      ]);
      for (const secret of [
        s.createdBy,
        s.createdAt,
        s.translationAudits[1]!.id,
        s.translationAudits[0]!.reviewId,
      ])
        expect(JSON.stringify(p)).not.toContain(secret);
    },
  );
  test("STALE remains readable and privately previewable but cannot enter a new review", () => {
    const s = inReview();
    s.translationAudits[1]!.translatedFromSourceHash = "a".repeat(
      64,
    ) as typeof s.contentHash;
    refresh(s);
    const r = review(s);
    expect(r.context.stale).toBe(true);
    expect(projectBaseContentPreview(s, target(s)).outcome).toBe("SUCCESS");
    expect(
      validateBaseContentReviewAction(action(r), r.context, r),
    ).toMatchObject({ code: "STALE_CONTENT" });
  });
  test("inherited approval remains visible even when copier was original reviewer", () => {
    const s = source("IDOL");
    s.createdBy = id(5) as typeof s.createdBy;
    s.translationAudits[1]!.inheritedFrom = {
      revisionId: id(70),
      translationId: id(71),
      reviewId: id(72),
    };
    refresh(s);
    expect(projectBaseContentReview(s, target(s)).outcome).toBe("SUCCESS");
  });
  test("actual field, English and whole snapshot corruption is rejected", () => {
    const s = source("IDOL");
    if (s.content.kind !== "IDOL") throw new Error("fixture");
    s.content.translations[1]!.fields.shortBio = "tampered";
    expect(projectBaseContentReview(s, target(s))).toMatchObject({
      code: "CONTENT_UNAVAILABLE",
    });
    const r = review();
    if (r.source.kind !== "IDOL") throw new Error("fixture");
    r.source.fields.shortBio = "tampered";
    expect(
      validateBaseContentReviewResponse(r, r.context.target),
    ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
    const s2 = source("IDOL");
    s2.createdBy = id(99) as typeof s2.createdBy;
    expect(projectBaseContentReview(s2, target(s2))).toMatchObject({
      code: "CONTENT_UNAVAILABLE",
    });
  });
  test("wrong owner, revision, absent locale fail without returning data", () => {
    const s = source("IDOL");
    for (const t of [
      { ...target(s), owner: { kind: "IDOL" as const, idolId: id(100) } },
      { ...target(s), revisionId: id(100) },
      target(s, "th"),
    ]) {
      expect(
        projectBaseContentReview(s, baseContentTargetSchema.parse(t)),
      ).toMatchObject({ outcome: "FAILURE" });
      expect(
        projectBaseContentPreview(s, baseContentTargetSchema.parse(t)),
      ).toMatchObject({ code: "PREVIEW_UNAVAILABLE" });
    }
  });
  test("private alias projection admits only neutral and selected language", () => {
    const s = source("IDOL");
    if (s.content.kind !== "IDOL") throw new Error("fixture");
    const result = prepareIdolAliasDraft(
      {
        schemaVersion: 1,
        id: id(60),
        idolRevisionId: s.revisionId,
        aliases: [
          { id: "neutral", locale: null, text: "Neutral" },
          { id: "ja", locale: "ja", text: "Japanese" },
          { id: "en", locale: "en", text: "English" },
        ],
        actorId: id(4),
        reasonCode: "CONTENT_CREATED",
        requestId: id(61),
      },
      editedAt,
    );
    if (result.outcome !== "SUCCESS") throw new Error("fixture");
    s.content.aliases = result.aliasSet.aliases;
    s.extensions.aliases = result.aliasSet;
    refresh(s);
    const p = projectBaseContentPreview(s, target(s));
    expect(p).toMatchObject({
      content: { aliases: [{ id: "neutral" }, { id: "ja" }] },
    });
    expect(JSON.stringify(p)).not.toContain("English");
  });
  test("existing gift details missing selected translation never fall back to legacy fields", () => {
    const s = source("GIFT");
    if (s.content.kind !== "GIFT") throw new Error("fixture");
    const d = prepareGiftDetailDraft(
      {
        schemaVersion: 1,
        document: {
          schemaVersion: 1,
          id: id(60),
          giftRevisionId: s.revisionId,
          blocks: [{ id: "intro", kind: "PARAGRAPH" }],
        },
        translations: [
          {
            id: id(61),
            locale: "en",
            origin: "HUMAN",
            blocks: [
              { blockId: "intro", kind: "PARAGRAPH", text: "Actual English" },
            ],
          },
        ],
        actorId: id(4),
        reasonCode: "CONTENT_CREATED",
        requestId: id(62),
      },
      editedAt,
    );
    if (d.outcome !== "SUCCESS") throw new Error("fixture");
    s.extensions.details = d;
    s.content.details = {
      blocks: d.document.blocks,
      translations: d.translations.map((row) => ({
        locale: row.locale,
        origin: row.origin,
        blocks: row.blocks,
      })),
    };
    refresh(s);
    expect(projectBaseContentReview(s, target(s)).outcome).toBe("SUCCESS");
    expect(projectBaseContentPreview(s, target(s))).toMatchObject({
      code: "PREVIEW_UNAVAILABLE",
    });
    const p = projectBaseContentPreview(s, target(s, "en"));
    expect(p).toMatchObject({
      content: {
        details: { translation: { blocks: [{ text: "Actual English" }] } },
      },
    });
    expect(JSON.stringify(p)).not.toContain(d.translations[0]!.editorId);
  });
  test.each([
    "STALE_VERSION",
    "STALE_CONTENT",
    "REVISION_NOT_DRAFT",
    "INVALID_REVIEW_STATE",
    "SELF_REVIEW",
  ] as const)("new action guards %s", (code) => {
    const r = review(inReview());
    const c = action(r);
    if (code === "STALE_VERSION") c.expectedVersion++;
    if (code === "STALE_CONTENT")
      c.expectedSourceHash = "a".repeat(64) as typeof c.expectedSourceHash;
    if (code === "REVISION_NOT_DRAFT")
      r.context.lifecycle = { status: "VALIDATED", validatedAt: createdAt };
    if (code === "INVALID_REVIEW_STATE")
      r.context.audit.review = { status: "DRAFT" };
    if (code === "SELF_REVIEW") c.actorId = r.context.structureEditorId;
    expect(validateBaseContentReviewAction(c, r.context, r)).toMatchObject({
      code,
    });
  });
  test("submission belongs to translation editor and approval excludes both authors", () => {
    const r = review(inReview());
    expect(validateBaseContentReviewAction(action(r), r.context, r)).toBeNull();
    r.context.structureEditorId = id(80);
    expect(
      validateBaseContentReviewAction(
        action(r, r.context.audit.editorId),
        r.context,
        r,
      ),
    ).toMatchObject({ code: "SELF_REVIEW" });
    r.context.audit.review = { status: "DRAFT" };
    r.context.audit.reviewSequence = 1;
    const c = { ...action(r), action: "SUBMIT" as const };
    expect(validateBaseContentReviewAction(c, r.context, r)).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      validateBaseContentReviewAction(
        { ...c, actorId: r.context.audit.editorId },
        r.context,
        r,
      ),
    ).toBeNull();
  });
});
