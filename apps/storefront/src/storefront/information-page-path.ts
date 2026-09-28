import type {
  InformationPageKey,
  SupportedLocale,
} from "@fan-support/contracts";
const paths = { ABOUT: "about", FAQ: "faq", SUPPORT: "support" } as const;
export function informationPagePath(
  locale: SupportedLocale,
  key: InformationPageKey,
): string {
  return `/${locale}/${paths[key]}`;
}
export function informationPageKeyFromPath(
  path: unknown,
): InformationPageKey | null {
  return path === "about"
    ? "ABOUT"
    : path === "faq"
      ? "FAQ"
      : path === "support"
        ? "SUPPORT"
        : null;
}
