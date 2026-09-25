import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";

describe("content authoring boundary", () => {
  it("provides a distinct versioned command without changing the old admin command", () => {
    expect(contracts).toHaveProperty("contentAuthoringCommandSchema");
    expect(contracts).toHaveProperty("contentAuthoringSnapshotSchema");
  });
});

const id = "00000000-0000-4000-8000-000000000001";
const en = {
  locale: "en",
  origin: "HUMAN",
  fields: {
    displayName: "Fixture",
    shortBio: "Fixture bio",
    fullBio: "<p>Fixture</p>",
    seoTitle: "Fixture",
    seoDescription: "Fixture description",
  },
};
const create = {
  schemaVersion: 1,
  action: "CREATE",
  target: { kind: "IDOL", idolId: id },
  expectedVersion: 0,
  reasonCode: "CONTENT_CREATE",
  idempotencyKey: "authoring-create-1",
  content: {
    kind: "IDOL",
    structure: {
      themeAccent: "#aabbcc",
      heroTextTone: "light",
      displayOrder: 0,
    },
    media: [],
    translations: [en],
  },
};
it("keeps authored policy instants within PostgreSQL precision and readable UTC years", () => {
  const policy = (effectiveAt: string) => ({
    ...create,
    target: { kind: "POLICY", policyKey: "delivery" },
    content: {
      kind: "POLICY",
      structure: { kind: "DELIVERY", effectiveAt },
      translations: [
        {
          locale: "en",
          origin: "HUMAN",
          fields: {
            title: "Delivery",
            summary: "Delivery details",
            body: "<p>Delivery</p>",
          },
        },
      ],
    },
  });
  for (const value of [
    "2026-01-02T00:00:00.1234567Z",
    "9999-12-31T23:59:59.999999-14:00",
    "0001-01-01T00:00:00+14:00",
    "0000-01-01T00:00:00Z",
  ])
    expect(
      contracts.contentAuthoringCommandSchema.safeParse(policy(value)).success,
      value,
    ).toBe(false);
  for (const value of [
    "2026-01-02T00:00:00.123456Z",
    "0001-01-01T00:00:00Z",
    "9999-12-31T23:59:59.999999Z",
    "2026-01-02T08:00:00.123456+08:00",
  ])
    expect(
      contracts.contentAuthoringCommandSchema.safeParse(policy(value)).success,
      value,
    ).toBe(true);
});
it("accepts creating a first English draft and copying one locale with canonical concurrency evidence", () => {
  expect(
    contracts.contentAuthoringCommandSchema.safeParse(create).success,
  ).toBe(true);
  expect(
    contracts.contentAuthoringCommandSchema.safeParse({
      schemaVersion: 1,
      action: "COPY",
      target: create.target,
      expectedVersion: 1,
      sourceRevisionId: id,
      expectedSourceHash: "a".repeat(64),
      reasonCode: "CONTENT_COPY",
      idempotencyKey: "authoring-copy-1",
      changes: { kind: "IDOL", translations: [{ ...en, locale: "ja" }] },
    }).success,
  ).toBe(true);
});
it("rejects browser-supplied author, review, hash, revision and unknown versions", () => {
  for (const key of [
    "createdBy",
    "editorId",
    "review",
    "sourceHash",
    "revisionId",
  ]) {
    expect(
      contracts.contentAuthoringCommandSchema.safeParse({
        ...create,
        [key]: id,
      }).success,
    ).toBe(false);
    expect(
      contracts.contentAuthoringCommandSchema.safeParse({
        ...create,
        content: { ...create.content, translations: [{ ...en, [key]: id }] },
      }).success,
    ).toBe(false);
  }
  expect(
    contracts.contentAuthoringCommandSchema.safeParse({
      ...create,
      schemaVersion: 2,
    }).success,
  ).toBe(false);
  expect(contracts.adminContentCommandSchema.safeParse(create).success).toBe(
    false,
  );
});
it("requires a real English row, unique locales, matching owner kind and strict import origin", () => {
  for (const translations of [
    [],
    [{ ...en, locale: "ja" }],
    [en, en],
    [{ ...en, origin: "IMPORT" }],
    [{ ...en, importBatchId: id }],
    [{ ...en, locale: "en-XA" }],
  ])
    expect(
      contracts.contentAuthoringCommandSchema.safeParse({
        ...create,
        content: { ...create.content, translations },
      }).success,
    ).toBe(false);
  expect(
    contracts.contentAuthoringCommandSchema.safeParse({
      ...create,
      target: { kind: "GIFT", giftId: id },
    }).success,
  ).toBe(false);
  expect(
    contracts.contentAuthoringCommandSchema.safeParse({
      ...create,
      content: {
        ...create.content,
        translations: [{ ...en, origin: "IMPORT", importBatchId: id }],
      },
    }).success,
  ).toBe(true);
});
it("rejects invalid revisions and uncontrolled rich text", () => {
  for (const expectedVersion of [
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    expect(
      contracts.contentAuthoringCommandSchema.safeParse({
        ...create,
        expectedVersion,
      }).success,
    ).toBe(false);
  expect(
    contracts.contentAuthoringCommandSchema.safeParse({
      ...create,
      content: {
        ...create.content,
        translations: [
          {
            ...en,
            fields: { ...en.fields, fullBio: '<p onclick="x">bad</p>' },
          },
        ],
      },
    }).success,
  ).toBe(false);
});
it("keeps media metadata edits scoped to an existing asset and separate from binary rights", () => {
  const media = {
    ...create,
    target: { kind: "MEDIA_METADATA", mediaAssetId: id },
    content: {
      kind: "MEDIA_METADATA",
      structure: {
        presentationKind: "INFORMATIVE",
        focalPoint: { x: 0.5, y: 0.5 },
      },
      translations: [
        { locale: "en", origin: "HUMAN", fields: { alt: "Fixture photo" } },
      ],
    },
  };
  expect(contracts.contentAuthoringCommandSchema.safeParse(media).success).toBe(
    true,
  );
  expect(
    contracts.contentAuthoringCommandSchema.safeParse({
      ...media,
      content: {
        ...media.content,
        structure: { ...media.content.structure, rightsStatus: "APPROVED" },
      },
    }).success,
  ).toBe(false);
});

it("preserves distinct desktop/mobile hero identities when authoring homepage slots", () => {
  const mediaId = "00000000-0000-4000-8000-000000000002";
  const command = {
    ...create,
    target: { kind: "HOMEPAGE" },
    content: {
      kind: "HOMEPAGE",
      structure: {
        slots: [
          {
            kind: "HERO_IDOL",
            slotKey: "hero",
            idolId: id,
            desktopMediaAssetId: id,
            mobileMediaAssetId: mediaId,
            desktopMediaMetadataRevisionId: id,
            mobileMediaMetadataRevisionId: mediaId,
            sortOrder: 0,
          },
        ],
      },
      translations: [
        {
          locale: "en",
          origin: "HUMAN",
          fields: {
            heroTitle: "Fixture",
            heroSubtitle: "Fixture",
            ctaLabel: "Browse",
            slotLabels: [{ slotKey: "hero", label: "Fixture" }],
            seoTitle: "Fixture",
            seoDescription: "Fixture",
          },
        },
      ],
    },
  };
  expect(
    contracts.contentAuthoringCommandSchema.safeParse(command).success,
  ).toBe(true);
  for (const property of [
    "mobileMediaAssetId",
    "mobileMediaMetadataRevisionId",
  ])
    expect(
      contracts.contentAuthoringCommandSchema.safeParse({
        ...command,
        content: {
          ...command.content,
          structure: {
            slots: [{ ...command.content.structure.slots[0], [property]: id }],
          },
        },
      }).success,
    ).toBe(false);
});

it("accepts exact database focal precision and rejects silent rounding", () => {
  const command = {
    ...create,
    target: { kind: "MEDIA_METADATA", mediaAssetId: id },
    content: {
      kind: "MEDIA_METADATA",
      structure: {
        presentationKind: "INFORMATIVE",
        focalPoint: { x: 0.27819, y: 0.33333 },
      },
      translations: [
        { locale: "en", origin: "HUMAN", fields: { alt: "Fixture photo" } },
      ],
    },
  };
  expect(
    contracts.contentAuthoringCommandSchema.safeParse(command).success,
  ).toBe(true);
  expect(
    contracts.contentAuthoringCommandSchema.safeParse({
      ...command,
      content: {
        ...command.content,
        structure: {
          ...command.content.structure,
          focalPoint: { x: 0.123456, y: 0.5 },
        },
      },
    }).success,
  ).toBe(false);
});
