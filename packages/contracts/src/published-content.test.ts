import { describe, expect, test } from "vitest";
import * as content from "./published-content.js";
import { SUPPORTED_LOCALES } from "./locale.js";

const id = "81000000-0000-4000-8000-000000000001";
const localeContext = {
  schemaVersion: 1,
  requestedLocale: "ja",
  resolvedLocale: "ja",
  fallbackUsed: false,
};
const view = {
  schemaVersion: 1,
  policyKey: "terms",
  kind: "TERMS",
  localeContext,
  title: "Terms",
  summary: "Summary",
  body: "Policy",
  effectiveAt: "2026-09-06T10:00:00.123456Z",
};
const publication = {
  id,
  revisionId: id,
  manifestHash: "a".repeat(64),
  publishedAt: view.effectiveAt,
};

describe("published content boundary", () => {
  test("accepts all five public locators and seven explicit locales", () => {
    for (const locator of [
      { kind: "IDOL", handle: "artist" },
      { kind: "GIFT", handle: "flowers" },
      { kind: "HOMEPAGE" },
      { kind: "POLICY", policyKey: "terms" },
      { kind: "MEDIA_METADATA", mediaAssetId: id },
    ])
      for (const locale of SUPPORTED_LOCALES)
        expect(
          content.publishedContentReadCommandSchema.safeParse({
            schemaVersion: 1,
            locator,
            locale,
          }).success,
        ).toBe(true);
  });
  test("cannot select unpublished revisions or inject internal authority", () => {
    const command = {
      schemaVersion: 1,
      locator: { kind: "POLICY", policyKey: "terms" },
      locale: "ja",
    };
    for (const extra of [
      { revisionId: id },
      { publicationId: id },
      { actorId: id },
      { approved: true },
      { owner: { kind: "HOMEPAGE" } },
    ])
      expect(
        content.publishedContentReadCommandSchema.safeParse({
          ...command,
          ...extra,
        }).success,
      ).toBe(false);
  });
  test("keeps v1 views inside additive public response with no private audit", () => {
    const response = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PUBLISHED_CONTENT",
      publication,
      content: { kind: "POLICY", view },
    };
    expect(content.publishedContentResponseSchema.parse(response)).toEqual(
      response,
    );
    for (const extra of [
      { editorId: id },
      { manifest: {} },
      { objectKey: "private/source" },
    ])
      expect(
        content.publishedContentResponseSchema.safeParse({
          ...response,
          ...extra,
        }).success,
      ).toBe(false);
  });
  test("requires explicit legacy text or safe resolved ordered blocks", () => {
    expect(
      content.publishedGiftDetailsSchema.safeParse({
        format: "LEGACY_TEXT",
        text: "Old description",
      }).success,
    ).toBe(true);
    const details = {
      format: "BLOCKS",
      blocks: [
        { id: "heading", kind: "HEADING", level: 2, text: "Gift" },
        {
          id: "care",
          kind: "LIST",
          style: "UNORDERED",
          items: [{ id: "water", text: "Add water" }],
        },
      ],
    };
    expect(content.publishedGiftDetailsSchema.parse(details)).toEqual(details);
    expect(
      content.publishedGiftDetailsSchema.safeParse({
        ...details,
        text: "silent fallback",
      }).success,
    ).toBe(false);
    expect(
      content.publishedGiftDetailsSchema.safeParse({
        format: "BLOCKS",
        blocks: [
          { id: "bad", kind: "PARAGRAPH", text: "<script>alert(1)</script>" },
        ],
      }).success,
    ).toBe(false);
    expect(
      content.publishedGiftDetailsSchema.safeParse({
        format: "BLOCKS",
        blocks: [
          {
            id: "image",
            kind: "MEDIA",
            mediaAssetId: id,
            objectKey: "private/source",
          },
        ],
      }).success,
    ).toBe(false);
  });
  test("canonical context requires persisted proof separate from current facts", () => {
    expect(
      Object.keys(content.legacyPublishedContentContextSchema.shape).sort(),
    ).toEqual(
      ["schemaVersion", "locale", "publication", "canonical", "media"].sort(),
    );
  });
});
