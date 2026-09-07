// Fictional HTTP test data only; production reads PostgreSQL.
import {
  storefrontHomepageResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";

export function storefrontHomepageFixture(locale: SupportedLocale = "en") {
  const id = "abcdefab-0000-4000-8000-000000000001";
  const localeContext = {
    schemaVersion: 1,
    requestedLocale: locale,
    resolvedLocale: locale,
    fallbackUsed: false,
  };
  const media = {
    schemaVersion: 1,
    kind: "INFORMATIVE",
    url: "https://media.example.test/fictional.webp",
    alt: "Fictional portrait",
    width: 800,
    height: 1000,
    focalPoint: { x: 0.5, y: 0.5 },
  };
  const publication = {
    id,
    revisionId: id,
    manifestHash: "a".repeat(64),
    publishedAt: "2026-09-06T00:00:00Z",
  };
  const common = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLISHED_CONTENT",
    publication,
  };
  const hero = {
    schemaVersion: 1,
    slotKey: "hero",
    kind: "HERO_IDOL",
    idolId: id,
    label: "Featured artist",
    sortOrder: 0,
  };
  const result = storefrontHomepageResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_HOMEPAGE",
    homepage: {
      ...common,
      content: {
        kind: "HOMEPAGE",
        view: {
          schemaVersion: 1,
          localeContext,
          heroTitle: "Fictional homepage",
          heroSubtitle: "A thoughtful gesture",
          ctaLabel: "Meet the artists",
          heroDesktop: media,
          heroMobile: media,
          slots: [hero],
          seoTitle: "Fictional homepage",
          seoDescription: "Fictional published content",
        },
      },
    },
    slots: [
      {
        slotKey: "hero",
        kind: "HERO_IDOL",
        idolId: id,
        status: "AVAILABLE",
        content: {
          ...common,
          content: {
            kind: "IDOL",
            aliases: [],
            view: {
              schemaVersion: 1,
              id,
              handle: "fictional-artist",
              status: "active",
              acceptingGifts: true,
              localeContext,
              displayName: "Fictional artist",
              shortBio: "Short biography",
              fullBio: "Full biography",
              seoTitle: "Fictional artist",
              seoDescription: "Fictional biography",
              themeAccent: "#8899aa",
              heroTextTone: "light",
              portrait: media,
              heroDesktop: media,
              heroMobile: media,
              gallery: [],
            },
          },
        },
      },
    ],
  });
  if (result.outcome !== "SUCCESS") throw new Error("Invalid fixture");
  return result;
}
