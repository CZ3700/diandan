import { describe, expect, test } from "vitest";
import {
  contentAuthoringCommandSchema,
  contentAuthoringContentSchema,
  contentAuthoringSnapshotSchema,
  contentAuthoringTargetSchema,
  type ContentAuthoringContent,
  type ContentAuthoringSnapshot,
  type ContentAuthoringTarget,
} from "@fan-support/contracts";
import {
  computeGiftTranslationContentHash,
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";
import {
  computeContentAuthoringSnapshotHash,
  prepareContentAuthoring,
  type ContentAuthoringMutation,
} from "./content-authoring.js";
import {
  prepareIdolAliasDraft,
  prepareGiftDetailDraft,
} from "./content-drafts.js";

const id = (n: number) =>
  `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const editedAt = "2026-09-01T10:00:00.123456Z";
const reviewedAt = "2026-09-01T11:00:00.654321Z";
const createdAt = "2026-09-06T10:00:00.000Z";
const context = { actorId: id(1), createdAt };
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
function create(kind: Kind): ContentAuthoringMutation {
  const data = fixture(kind);
  return contentAuthoringCommandSchema.parse({
    schemaVersion: 1,
    action: "CREATE",
    ...data,
    expectedVersion: 0,
    reasonCode: "CONTENT_CREATED",
    idempotencyKey: "content-create-001",
  }) as ContentAuthoringMutation;
}
function copy(
  snapshot: ContentAuthoringSnapshot,
  changes: unknown = { kind: snapshot.content.kind },
): ContentAuthoringMutation {
  return contentAuthoringCommandSchema.parse({
    schemaVersion: 1,
    action: "COPY",
    target: snapshot.target,
    sourceRevisionId: snapshot.revisionId,
    expectedSourceHash: snapshot.contentHash,
    expectedVersion: snapshot.headVersion,
    reasonCode: "CONTENT_EDITED",
    idempotencyKey: "content-copy-001",
    changes,
  }) as ContentAuthoringMutation;
}
function refresh(snapshot: ContentAuthoringSnapshot) {
  snapshot.contentHash = computeContentAuthoringSnapshotHash(
    snapshot,
  ) as ContentAuthoringSnapshot["contentHash"];
  return snapshot;
}

describe("content authoring plans", () => {
  test.each(kinds)(
    "%s creation computes real English lineage and begins every locale in DRAFT",
    (kind) => {
      const command = create(kind);
      const plan = prepareContentAuthoring(command, null, context);
      expect(plan.content).toEqual(fixture(kind).content);
      for (const audit of plan.translationAudits)
        expect(audit).toEqual({
          locale: audit.locale,
          origin: "HUMAN",
          sourceHash: textHash(plan.content, audit.locale),
          translatedFromSourceHash: textHash(plan.content, "en"),
          editorId: context.actorId,
          editedAt: createdAt,
          review: { status: "DRAFT" },
        });
    },
  );
  test.each(kinds)(
    "%s copy inherits exact original approved evidence without pretending a new review occurred",
    (kind) => {
      const original = source(kind);
      const plan = prepareContentAuthoring(copy(original), original, context);
      expect(plan.content).toEqual(original.content);
      for (const [index, audit] of plan.translationAudits.entries()) {
        const {
          id: translationId,
          reviewId,
          reviewSequence,
          ...expected
        } = original.translationAudits[index]!;
        expect(reviewSequence).toBe(3);
        expect(audit).toEqual({
          ...expected,
          inheritedFrom: {
            revisionId: original.revisionId,
            translationId,
            reviewId,
          },
        });
      }
      expect(original.translationAudits[0]!.editedAt).toBe(editedAt);
    },
  );
  test("one explicit translation edit preserves unrelated approval and changes only its editor", () => {
    const original = source("IDOL");
    if (original.content.kind !== "IDOL") throw new Error("fixture");
    const japanese = original.content.translations.find(
      (row) => row.locale === "ja",
    )!;
    const plan = prepareContentAuthoring(
      copy(original, {
        kind: "IDOL",
        translations: [
          {
            ...japanese,
            fields: {
              ...japanese.fields,
              shortBio: "Updated Japanese biography",
            },
          },
        ],
      }),
      original,
      context,
    );
    expect(
      plan.translationAudits.find((row) => row.locale === "en")!.review.status,
    ).toBe("APPROVED");
    expect(
      plan.translationAudits.find((row) => row.locale === "ja"),
    ).toMatchObject({
      editorId: context.actorId,
      editedAt: createdAt,
      review: { status: "DRAFT" },
    });
    expect(
      plan.translationAudits.find((row) => row.locale === "ja")!.inheritedFrom,
    ).toBeUndefined();
  });
  test("new media keeps unchanged base text approval separate from the new revision structure", () => {
    const original = source("IDOL");
    const plan = prepareContentAuthoring(
      copy(original, {
        kind: "IDOL",
        media: [
          {
            role: "PORTRAIT",
            mediaAssetId: id(80),
            mediaMetadataRevisionId: id(81),
            sortOrder: 0,
          },
        ],
      }),
      original,
      context,
    );
    expect(
      plan.translationAudits.every((row) => row.review.status === "APPROVED"),
    ).toBe(true);
    expect(plan).not.toHaveProperty("lifecycle");
    expect(plan.content).toMatchObject({ media: [{ mediaAssetId: id(80) }] });
  });
  test("a previously stale approval never becomes current through a verbatim copy", () => {
    const original = source("IDOL");
    const japanese = original.translationAudits.find(
      (row) => row.locale === "ja",
    )!;
    japanese.translatedFromSourceHash = "a".repeat(
      64,
    ) as typeof japanese.translatedFromSourceHash;
    if (japanese.review.status !== "APPROVED") throw new Error("fixture");
    japanese.review.reviewedSourceHash = japanese.translatedFromSourceHash;
    refresh(original);
    expect(
      prepareContentAuthoring(
        copy(original),
        original,
        context,
      ).translationAudits.find((row) => row.locale === "ja"),
    ).toMatchObject({
      translatedFromSourceHash: japanese.translatedFromSourceHash,
      review: { status: "DRAFT" },
    });
  });
  test("new locale text binds actual current English and starts independently in DRAFT", () => {
    const original = source("IDOL");
    if (original.content.kind !== "IDOL") throw new Error("fixture");
    const row = original.content.translations[1]!;
    const plan = prepareContentAuthoring(
      copy(original, {
        kind: "IDOL",
        translations: [{ ...row, locale: "es" }],
      }),
      original,
      context,
    );
    expect(
      plan.translationAudits.find((row) => row.locale === "es"),
    ).toMatchObject({
      translatedFromSourceHash: textHash(original.content, "en"),
      review: { status: "DRAFT" },
    });
  });
  test("an explicit Unicode normalization edit does not inherit byte-distinct review evidence", () => {
    const original = source("IDOL");
    if (original.content.kind !== "IDOL") throw new Error("fixture");
    const japanese = original.content.translations.find(
      (row) => row.locale === "ja",
    )!;
    japanese.fields.shortBio = "Cafe\u0301";
    const audit = original.translationAudits.find(
      (row) => row.locale === "ja",
    )!;
    audit.sourceHash = textHash(
      original.content,
      "ja",
    ) as typeof audit.sourceHash;
    if (audit.review.status !== "APPROVED") throw new Error("fixture");
    audit.review.reviewedContentHash = audit.sourceHash;
    refresh(original);
    const plan = prepareContentAuthoring(
      copy(original, {
        kind: "IDOL",
        translations: [
          { ...japanese, fields: { ...japanese.fields, shortBio: "Café" } },
        ],
      }),
      original,
      context,
    );
    expect(
      plan.translationAudits.find((row) => row.locale === "ja")!.review.status,
    ).toBe("DRAFT");
    expect(
      plan.content.translations.find((row) => row.locale === "ja")!.fields,
    ).toMatchObject({ shortBio: "Café" });
  });
  test("changed English leaves untouched foreign copy visibly stale rather than rebinding it", () => {
    const original = source("IDOL");
    if (original.content.kind !== "IDOL") throw new Error("fixture");
    const english = original.content.translations.find(
      (row) => row.locale === "en",
    )!;
    const plan = prepareContentAuthoring(
      copy(original, {
        kind: "IDOL",
        translations: [
          {
            ...english,
            fields: { ...english.fields, shortBio: "New English {name}" },
          },
        ],
      }),
      original,
      context,
    );
    const en = plan.translationAudits.find((row) => row.locale === "en")!;
    const ja = plan.translationAudits.find((row) => row.locale === "ja")!;
    expect(en.translatedFromSourceHash).toBe(en.sourceHash);
    expect(ja.translatedFromSourceHash).toBe(
      original.translationAudits[0]!.sourceHash,
    );
    expect(ja.translatedFromSourceHash).not.toBe(en.sourceHash);
    expect(ja.review.status).toBe("DRAFT");
    expect(ja.inheritedFrom).toBeUndefined();
  });
  test.each(["MACHINE", "IMPORT"] as const)(
    "an explicit %s override never inherits approval even with equal text",
    (origin) => {
      const original = source("IDOL");
      const japanese = original.content.translations.find(
        (row) => row.locale === "ja",
      )!;
      const plan = prepareContentAuthoring(
        copy(original, {
          kind: "IDOL",
          translations: [
            {
              ...japanese,
              origin,
              ...(origin === "IMPORT" ? { importBatchId: id(70) } : {}),
            },
          ],
        }),
        original,
        context,
      );
      const audit = plan.translationAudits.find((row) => row.locale === "ja")!;
      expect(audit.review.status).toBe("DRAFT");
      expect(audit.origin).toBe(origin);
      expect(audit.inheritedFrom).toBeUndefined();
    },
  );
  test("unchanged previously reviewed imports retain their original provenance", () => {
    const original = source("IDOL");
    original.content.translations[1]!.origin = "IMPORT";
    original.content.translations[1]!.importBatchId = id(70);
    original.translationAudits[1]!.origin = "IMPORT";
    original.translationAudits[1]!.importBatchId = id(70);
    refresh(original);
    expect(
      prepareContentAuthoring(copy(original), original, context)
        .translationAudits[1],
    ).toMatchObject({
      origin: "IMPORT",
      importBatchId: id(70),
      review: { status: "APPROVED" },
    });
  });
  test.each(["DRAFT", "IN_REVIEW"] as const)(
    "unapproved %s sources rebind to the new editor and DRAFT",
    (status) => {
      const original = source("IDOL");
      original.translationAudits[1]!.review =
        status === "DRAFT" ? { status } : { status, submittedAt: reviewedAt };
      original.translationAudits[1]!.reviewSequence =
        status === "DRAFT" ? 1 : 2;
      refresh(original);
      expect(
        prepareContentAuthoring(copy(original), original, context)
          .translationAudits[1],
      ).toMatchObject({
        editorId: context.actorId,
        editedAt: createdAt,
        review: { status: "DRAFT" },
      });
    },
  );
  test("new revision copying never trusts a client assertion about old content or approval", () => {
    const original = source("IDOL");
    const command = copy(original);
    expect(() =>
      prepareContentAuthoring(
        {
          ...command,
          expectedSourceHash: "f".repeat(64),
        } as ContentAuthoringMutation,
        original,
        context,
      ),
    ).toThrow("invalid content authoring input");
    expect(() =>
      prepareContentAuthoring(
        command,
        {
          ...original,
          target: { kind: "IDOL", idolId: id(90) } as ContentAuthoringTarget,
        },
        context,
      ),
    ).toThrow();
    const forged = structuredClone(original);
    forged.translationAudits[0]!.sourceHash = "f".repeat(
      64,
    ) as ContentAuthoringSnapshot["contentHash"];
    expect(() => computeContentAuthoringSnapshotHash(forged)).toThrow();
  });
  test("snapshot hash binds structure, content, review sequence and timestamps but not head version or its own hash", () => {
    const original = source("IDOL");
    const hash = computeContentAuthoringSnapshotHash(original);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      computeContentAuthoringSnapshotHash({
        ...original,
        headVersion: 9,
        contentHash: "f".repeat(64) as ContentAuthoringSnapshot["contentHash"],
      }),
    ).toBe(hash);
    const changed = structuredClone(original);
    if (changed.content.kind !== "IDOL") throw new Error("fixture");
    changed.content.structure.displayOrder++;
    expect(computeContentAuthoringSnapshotHash(changed)).not.toBe(hash);
    expect(
      computeContentAuthoringSnapshotHash({
        ...original,
        translationAudits: original.translationAudits.map((row) => ({
          ...row,
          reviewId: id(95),
        })),
      }),
    ).not.toBe(hash);
  });
  test("informative media needs real alternative text while decorative media preserves empty alt", () => {
    const command = create("MEDIA_METADATA");
    if (
      command.action !== "CREATE" ||
      command.content.kind !== "MEDIA_METADATA"
    )
      throw new Error("fixture");
    command.content.translations[0]!.fields.alt = "";
    expect(() => prepareContentAuthoring(command, null, context)).toThrow();
    command.content.structure.presentationKind = "DECORATIVE";
    command.content.translations[1]!.fields.alt = "";
    expect(
      prepareContentAuthoring(command, null, context).translationAudits[0]!
        .review.status,
    ).toBe("DRAFT");
  });
  test("explicit source and translated ICU variables must match", () => {
    const command = create("IDOL");
    if (command.action !== "CREATE" || command.content.kind !== "IDOL")
      throw new Error("fixture");
    command.content.translations[0]!.fields.shortBio = "Hello {name}";
    expect(() => prepareContentAuthoring(command, null, context)).toThrow();
  });
  test("cloned aliases retain actual content while their old approval stays outside the plan", () => {
    const original = source("IDOL");
    if (original.content.kind !== "IDOL") throw new Error("fixture");
    const alias = prepareIdolAliasDraft(
      {
        schemaVersion: 1,
        id: id(60),
        idolRevisionId: original.revisionId,
        aliases: [{ id: "name", locale: null, text: "Stage name" }],
        actorId: id(4),
        reasonCode: "CONTENT_CREATED",
        requestId: id(61),
      },
      editedAt,
    );
    if (alias.outcome !== "SUCCESS") throw new Error("fixture");
    original.content.aliases = alias.aliasSet.aliases;
    original.extensions.aliases = alias.aliasSet;
    refresh(original);
    const plan = prepareContentAuthoring(copy(original), original, context);
    expect(plan.content).toMatchObject({ aliases: alias.aliasSet.aliases });
    expect(JSON.stringify(plan)).not.toContain(alias.aliasSet.id);
    const altered = structuredClone(original);
    altered.extensions.aliases!.editedAt = createdAt;
    expect(computeContentAuthoringSnapshotHash(altered)).not.toBe(
      original.contentHash,
    );
  });
  test("detail clones bind their own structure and English fields, never legacy description review", () => {
    const original = source("GIFT");
    if (original.content.kind !== "GIFT") throw new Error("fixture");
    const details = prepareGiftDetailDraft(
      {
        schemaVersion: 1,
        document: {
          schemaVersion: 1,
          id: id(60),
          giftRevisionId: original.revisionId,
          blocks: [{ id: "intro", kind: "PARAGRAPH" }],
        },
        translations: [
          {
            id: id(61),
            locale: "en",
            origin: "HUMAN",
            blocks: [
              { blockId: "intro", kind: "PARAGRAPH", text: "Actual detail" },
            ],
          },
        ],
        actorId: id(4),
        reasonCode: "CONTENT_CREATED",
        requestId: id(62),
      },
      editedAt,
    );
    if (details.outcome !== "SUCCESS") throw new Error("fixture");
    original.extensions.details = details;
    original.content.details = {
      blocks: details.document.blocks,
      translations: details.translations.map((row) => ({
        locale: row.locale,
        origin: row.origin,
        blocks: row.blocks,
      })),
    };
    refresh(original);
    const plan = prepareContentAuthoring(copy(original), original, context);
    expect(plan.content).toMatchObject({ details: original.content.details });
    expect(JSON.stringify(plan.content)).not.toContain(details.document.id);
    const copiedDetails = original.content.details;
    expect(() =>
      prepareContentAuthoring(
        copy(original, {
          kind: "GIFT",
          details: {
            ...copiedDetails,
            blocks: [{ id: "different", kind: "PARAGRAPH" }],
          },
        }),
        original,
        context,
      ),
    ).toThrow();
  });
});
