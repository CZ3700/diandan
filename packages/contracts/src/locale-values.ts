export const SUPPORTED_LOCALES = Object.freeze([
  "en",
  "zh-CN",
  "th",
  "vi",
  "ja",
  "es",
  "pt",
] as const);

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE = "en" satisfies SupportedLocale;

export const LOCALE_NATIVE_NAMES = Object.freeze({
  en: "English",
  "zh-CN": "简体中文",
  th: "ไทย",
  vi: "Tiếng Việt",
  ja: "日本語",
  es: "Español",
  pt: "Português",
} satisfies Readonly<Record<SupportedLocale, string>>);

const supportedLocaleSet = new Set<string>(SUPPORTED_LOCALES);

export function parseSupportedLocale(
  value: unknown,
): SupportedLocale | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const canonicalLocales = Intl.getCanonicalLocales(value);
    const canonicalLocale = canonicalLocales[0];
    if (
      canonicalLocales.length !== 1 ||
      canonicalLocale === undefined ||
      !supportedLocaleSet.has(canonicalLocale)
    ) {
      return undefined;
    }

    return canonicalLocale as SupportedLocale;
  } catch {
    return undefined;
  }
}
