import { describe, expect, test } from "vitest";
import { publishedMediaViewSchema } from "./media-content.js";
import {
  publishedHomepageViewSchema,
  publishedPolicyViewSchema,
} from "./content-models.js";

const original = {
  schemaVersion: 2,
  publicationMode: "DIRECT_OPERATOR_V1",
  sourceLocale: "zh-CN",
  requestedLocale: "en",
  resolvedLocale: "zh-CN",
  fallbackUsed: true,
  translationRevision: "cc000000-0000-4000-8000-000000000001",
};
const media = {
  schemaVersion: 2,
  kind: "INFORMATIVE",
  url: "https://media.example.invalid/image.webp",
  alt: "艺人照片",
  width: 1600,
  height: 2000,
  focalPoint: { x: 0.5, y: 0.5 },
  localeContext: original,
};

describe("daily public language boundaries", () => {
  test("media can truthfully label its original alt language", () => {
    expect(publishedMediaViewSchema.safeParse(media).success).toBe(true);
    expect(
      publishedMediaViewSchema.safeParse({
        ...media,
        localeContext: { ...original, resolvedLocale: "en" },
      }).success,
    ).toBe(false);
  });
  test("daily content accepts original provenance while policy remains strict", () => {
    expect(
      publishedHomepageViewSchema.shape.localeContext.safeParse(original)
        .success,
    ).toBe(true);
    expect(
      publishedPolicyViewSchema.shape.localeContext.safeParse(original).success,
    ).toBe(false);
  });
  test("original media cannot claim private audit or storage authority", () => {
    for (const extra of [
      { actorId: original.translationRevision },
      { objectKey: "private/image" },
      { reviewed: true },
    ]) {
      expect(
        publishedMediaViewSchema.safeParse({ ...media, ...extra }).success,
      ).toBe(false);
    }
  });
});
