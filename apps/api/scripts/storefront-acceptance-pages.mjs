import { SUPPORTED_LOCALES } from "@fan-support/contracts";

export const acceptanceViewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];
export function acceptancePages(fixtures) {
  const scope = new globalThis.URLSearchParams(fixtures.markets[0]);
  return SUPPORTED_LOCALES.flatMap((locale) => [
    {
      locale,
      kind: "home",
      path: `/${locale}`,
      selector: "[data-artist-directory]",
    },
    {
      locale,
      kind: "artists",
      path: `/${locale}/idols`,
      selector: "[data-artist-directory]",
    },
    {
      locale,
      kind: "artist",
      path: `/${locale}/idols/${fixtures.artists[0].handle}?${scope}`,
      selector: ".storefront-story",
    },
    {
      locale,
      kind: "gifts",
      path: `/${locale}/gifts?${scope}`,
      selector: "[data-gift-directory]",
    },
    {
      locale,
      kind: "gift",
      path: `/${locale}/gifts/${fixtures.gifts[0].handle}?${scope}`,
      selector: "[data-gift-detail]",
    },
    {
      locale,
      kind: "policy",
      path: `/${locale}/policies/${fixtures.policies.find((policy) => policy.kind === "DELIVERY").policyKey}`,
      selector: "main h1",
    },
  ]);
}
