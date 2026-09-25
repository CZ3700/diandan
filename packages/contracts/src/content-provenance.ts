import { z } from "zod";
import { localeContextSchema, supportedLocaleSchema } from "./locale.js";

/** A published original remains in its actual language on every presentation route. */
export const singleSourceLocaleContextSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    publicationMode: z.literal("DIRECT_OPERATOR_V1"),
    sourceLocale: supportedLocaleSchema,
    requestedLocale: supportedLocaleSchema,
    resolvedLocale: supportedLocaleSchema,
    fallbackUsed: z.boolean(),
    translationRevision: z.uuid(),
  })
  .refine(
    (value) =>
      value.resolvedLocale === value.sourceLocale &&
      value.fallbackUsed === (value.requestedLocale !== value.sourceLocale),
    { message: "published originals retain their exact source language" },
  );

/** Content-only extension; cart, order and notification v1 provenance is unchanged. */
export const contentLocaleContextSchema = z.union([
  localeContextSchema,
  singleSourceLocaleContextSchema,
]);

export type SingleSourceLocaleContext = z.infer<
  typeof singleSourceLocaleContextSchema
>;
export type ContentLocaleContext = z.infer<typeof contentLocaleContextSchema>;
