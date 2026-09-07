import { afterEach, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  publicMediaUrlSchema,
  sourceHashSchema,
} from "@fan-support/contracts";
import { storefrontPublishedFixture } from "./storefront-homepage-fixtures.js";
import * as manifests from "./publication-manifest.js";
import * as published from "./published-content.js";
import * as mediaProjection from "./published-content-media.js";
import { projectStorefrontSeoEntity } from "./storefront-seo.js";

afterEach(() => vi.restoreAllMocks());

test("SEO verifies one shared publication proof while projecting every locale", () => {
  const fixture = storefrontPublishedFixture("IDOL");
  const verify = vi.spyOn(manifests, "verifyPublicationManifest");
  const hash = vi.spyOn(manifests, "computePublicationManifestHash");
  const media = vi.spyOn(mediaProjection, "publishedMediaResolver");
  const result = projectStorefrontSeoEntity(fixture);
  expect(result.outcome).toBe("SUCCESS");
  if (result.outcome !== "SUCCESS") throw new Error("SEO fixture unavailable");
  expect(result.entity.locales.map(({ locale }) => locale)).toEqual(
    SUPPORTED_LOCALES,
  );
  expect(verify).toHaveBeenCalledTimes(1);
  expect(hash).toHaveBeenCalledTimes(1);
  expect(media).toHaveBeenCalledTimes(SUPPORTED_LOCALES.length);
  expect(media.mock.calls.map(([context]) => context.locale)).toEqual(
    SUPPORTED_LOCALES,
  );
});

test("all-locale projection exactly preserves complete single-locale views", () => {
  for (const kind of [
    "HOMEPAGE",
    "IDOL",
    "GIFT",
    "POLICY",
    "MEDIA_METADATA",
  ] as const) {
    const fixture = storefrontPublishedFixture(
      kind,
      kind === "IDOL" || kind === "GIFT",
    );
    const before = JSON.stringify(fixture);
    const views = published.projectPublishedContentLocales(fixture);
    expect(views.every((view) => view.outcome === "SUCCESS")).toBe(true);
    expect(views).toEqual(
      SUPPORTED_LOCALES.map((locale) =>
        published.projectPublishedContent({ ...fixture, locale }),
      ),
    );
    expect(JSON.stringify(fixture)).toBe(before);
  }
});

test("the shared proof never bypasses the media resolver or survives another call", () => {
  const fixture = storefrontPublishedFixture("IDOL");
  expect(projectStorefrontSeoEntity(fixture).outcome).toBe("SUCCESS");
  // The URL is outside the frozen manifest; only the unchanged media resolver
  // checks its binding to the actual variant object key.
  fixture.media[0]!.url = publicMediaUrlSchema.parse(
    "https://media.example.test/wrong-object.webp",
  );
  expect(projectStorefrontSeoEntity(fixture)).toMatchObject({
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
  expect(
    published
      .projectPublishedContentLocales(fixture)
      .every((view) => view.outcome === "FAILURE"),
  ).toBe(true);
});

test("every locale, media proof and current publication remains fail closed", () => {
  const invalid = [];
  for (const locale of SUPPORTED_LOCALES) {
    const translation = storefrontPublishedFixture("IDOL");
    const translations = translation.canonical.snapshot.content.translations;
    translations.splice(
      translations.findIndex((row) => row.locale === locale),
      1,
    );
    invalid.push(translation);
    const media = storefrontPublishedFixture("IDOL");
    const mediaTranslations =
      media.canonical.mediaSnapshots[0]!.content.translations;
    mediaTranslations.splice(
      mediaTranslations.findIndex((row) => row.locale === locale),
      1,
    );
    invalid.push(media);
  }
  const rights = storefrontPublishedFixture("IDOL");
  if (rights.canonical.candidate.objectKind !== "IDOL")
    throw new Error("IDOL fixture required");
  rights.canonical.candidate.mediaAssets[0]!.rightsStatus = "REJECTED";
  invalid.push(rights);
  const head = storefrontPublishedFixture("IDOL");
  head.canonical.headVersion++;
  invalid.push(head);
  const hash = storefrontPublishedFixture("POLICY");
  hash.publication.manifestHash = sourceHashSchema.parse("0".repeat(64));
  invalid.push(hash);
  const originLocale = storefrontPublishedFixture("IDOL");
  originLocale.locale = "pt";
  invalid.push(originLocale);
  for (const fixture of invalid)
    expect(projectStorefrontSeoEntity(fixture)).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
});
