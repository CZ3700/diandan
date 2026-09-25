import {
  idolDirectoryResponseSchema,
  type IdolDirectoryResponse,
} from "@fan-support/contracts";

// Synthetic unit data only; never imported by a public page or runtime component.
export function directoryFixturePage(
  numbers: number[],
  version = "a",
  hasNextPage = false,
): IdolDirectoryResponse {
  const media = {
    schemaVersion: 1,
    kind: "INFORMATIVE",
    url: "https://media.invalid/portrait.webp",
    alt: "Fictional portrait",
    width: 1600,
    height: 2000,
    focalPoint: { x: 0.5, y: 0.5 },
  };
  return idolDirectoryResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    catalogVersion: version.repeat(64),
    items: numbers.map((number) => ({
      schemaVersion: 1,
      id: `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
      handle: `fictional-${number}`,
      status: "active",
      acceptingGifts: true,
      localeContext: {
        schemaVersion: 1,
        requestedLocale: "en",
        resolvedLocale: "en",
        fallbackUsed: false,
      },
      displayName: `Fictional ${number}`,
      shortBio: "Fictional artist.",
      fullBio: "Fictional artist biography.",
      seoTitle: "Fictional artist",
      seoDescription: "Fixture description.",
      themeAccent: "#d8b26e",
      heroTextTone: "light",
      portrait: media,
      heroDesktop: media,
      heroMobile: media,
      gallery: [],
    })),
    pageInfo: {
      schemaVersion: 1,
      hasNextPage,
      endCursor: hasNextPage ? "fixture_cursor" : null,
    },
  });
}
