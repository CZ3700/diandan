import { expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  sourceHashSchema,
  publicMediaUrlSchema,
} from "@fan-support/contracts";
import { buildSeoMetadata, provenSeoLocales } from "./seo-metadata";
const publication = {
  id: "a1000000-0000-4000-8000-000000000001",
  revisionId: "a2000000-0000-4000-8000-000000000001",
  manifestHash: sourceHashSchema.parse("a".repeat(64)),
  publishedAt: "2026-09-07T00:00:00Z",
};
const entity = {
  schemaVersion: 1 as const,
  locator: { kind: "HOMEPAGE" as const },
  publication,
  locales: SUPPORTED_LOCALES.map((locale, i) => ({
    locale,
    translationRevision: `a3000000-0000-4000-8000-00000000000${i}`,
    lastModified: publication.publishedAt,
  })),
};
test("metadata combines localized publication content with reciprocal proven URLs", () => {
  const metadata = buildSeoMetadata({
    origin: "https://store.test",
    siteName: "Test studio",
    locale: "zh-CN",
    identity: { canonicalPath: "/zh-CN", noindex: false },
    title: "本地标题",
    description: "本地说明",
    availableLocales: SUPPORTED_LOCALES,
    indexable: true,
    production: true,
    image: {
      url: publicMediaUrlSchema.parse("https://media.test/photo.webp"),
      width: 1200,
      height: 800,
      alt: "照片",
    },
  });
  expect(metadata).toMatchObject({
    title: "本地标题",
    description: "本地说明",
    robots: { index: true },
    alternates: {
      canonical: "https://store.test/zh-CN",
      languages: {
        "zh-CN": "https://store.test/zh-CN",
        "x-default": "https://store.test/en",
      },
    },
    openGraph: {
      title: "本地标题",
      locale: "zh_CN",
      images: [{ alt: "照片" }],
    },
  });
  expect(
    buildSeoMetadata({
      origin: "https://store.test",
      siteName: "Test",
      locale: "en",
      identity: { canonicalPath: "/en", noindex: false },
      title: "Test",
      description: "Test",
      availableLocales: SUPPORTED_LOCALES,
      indexable: true,
      production: false,
    }).robots,
  ).toMatchObject({ index: false });
});
test("publication races or fallback fail closed without another version's alternates", () => {
  const context = {
    schemaVersion: 1 as const,
    requestedLocale: "en" as const,
    resolvedLocale: "en" as const,
    fallbackUsed: false,
    translationRevision: entity.locales[0]!.translationRevision,
  };
  expect(provenSeoLocales(entity, publication, context)).toEqual(
    SUPPORTED_LOCALES,
  );
  expect(
    provenSeoLocales(
      entity,
      { ...publication, manifestHash: sourceHashSchema.parse("b".repeat(64)) },
      context,
    ),
  ).toEqual([]);
  expect(
    provenSeoLocales(entity, publication, {
      ...context,
      translationRevision: "another-translation",
    }),
  ).toEqual([]);
  expect(
    provenSeoLocales(entity, publication, { ...context, fallbackUsed: true }),
  ).toEqual([]);
});
