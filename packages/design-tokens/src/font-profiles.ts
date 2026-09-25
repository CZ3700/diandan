import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";

export type FontProfile = Readonly<{
  cssModule: string;
  family: string;
  id: "japanese" | "latin" | "simplified-chinese" | "thai" | "vietnamese";
  script: "Hans" | "Jpan" | "Latn" | "Thai";
}>;

const latinProfile = Object.freeze({
  cssModule: "@fan-support/design-tokens/fonts/latin.css",
  family: "Manrope Variable",
  id: "latin",
  script: "Latn",
} satisfies FontProfile);

const vietnameseProfile = Object.freeze({
  cssModule: "@fan-support/design-tokens/fonts/vietnamese.css",
  family: "Manrope Variable",
  id: "vietnamese",
  script: "Latn",
} satisfies FontProfile);

const simplifiedChineseProfile = Object.freeze({
  cssModule: "@fan-support/design-tokens/fonts/simplified-chinese.css",
  family: "Noto Sans SC Variable",
  id: "simplified-chinese",
  script: "Hans",
} satisfies FontProfile);

const japaneseProfile = Object.freeze({
  cssModule: "@fan-support/design-tokens/fonts/japanese.css",
  family: "Noto Sans JP Variable",
  id: "japanese",
  script: "Jpan",
} satisfies FontProfile);

const thaiProfile = Object.freeze({
  cssModule: "@fan-support/design-tokens/fonts/thai.css",
  family: "Noto Sans Thai Variable",
  id: "thai",
  script: "Thai",
} satisfies FontProfile);

function fontProfileForLocale(locale: SupportedLocale): FontProfile {
  switch (locale) {
    case "en":
    case "es":
    case "pt":
      return latinProfile;
    case "ja":
      return japaneseProfile;
    case "th":
      return thaiProfile;
    case "vi":
      return vietnameseProfile;
    case "zh-CN":
      return simplifiedChineseProfile;
    default: {
      const exhaustiveLocale: never = locale;
      return exhaustiveLocale;
    }
  }
}

export const FONT_PROFILE_BY_LOCALE = Object.freeze(
  Object.fromEntries(
    SUPPORTED_LOCALES.map(
      (locale) => [locale, fontProfileForLocale(locale)] as const,
    ),
  ),
) as Readonly<Record<SupportedLocale, FontProfile>>;
