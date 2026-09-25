import { z } from "zod";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locale-values.js";
export {
  DEFAULT_LOCALE,
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  parseSupportedLocale,
  type SupportedLocale,
} from "./locale-values.js";

import { schemaVersionSchema } from "./versioning.js";

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
