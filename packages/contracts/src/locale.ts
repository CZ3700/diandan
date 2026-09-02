import { z } from "zod";

import { schemaVersionSchema } from "./versioning.js";

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

export const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES);

const localeContextBaseShape = {
  schemaVersion: schemaVersionSchema,
  translationRevision: z.string().min(1).optional(),
} as const;

export type LocaleContext = Readonly<{
  schemaVersion: 1;
  requestedLocale: SupportedLocale;
  resolvedLocale: SupportedLocale;
  fallbackUsed: boolean;
  translationRevision?: string;
}>;

const directLocaleContextSchemas = SUPPORTED_LOCALES.map((locale) =>
  z.strictObject({
    ...localeContextBaseShape,
    requestedLocale: z.literal(locale),
    resolvedLocale: z.literal(locale),
    fallbackUsed: z.literal(false),
  }),
);
const fallbackLocaleContextSchemas = SUPPORTED_LOCALES.filter(
  (locale) => locale !== DEFAULT_LOCALE,
).map((locale) =>
  z.strictObject({
    ...localeContextBaseShape,
    requestedLocale: z.literal(locale),
    resolvedLocale: z.literal(DEFAULT_LOCALE),
    fallbackUsed: z.literal(true),
  }),
);
const localeContextVariants = [
  ...directLocaleContextSchemas,
  ...fallbackLocaleContextSchemas,
] as unknown as readonly [
  z.ZodType<LocaleContext>,
  z.ZodType<LocaleContext>,
  ...z.ZodType<LocaleContext>[],
];

export const localeContextSchema = z.union(localeContextVariants);

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
