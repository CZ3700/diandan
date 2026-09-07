import { z } from "zod";
import { catalogVersionSchema } from "./catalog-directory.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { policyKeySchema } from "./content-models.js";
import { SUPPORTED_LOCALES, supportedLocaleSchema } from "./locale.js";
import { publishedContentResponseSchema } from "./published-content.js";
import { slugSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const STOREFRONT_SEO_LIMITS = Object.freeze({ index: 20, catalog: 50 });
export const storefrontSeoLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("HOMEPAGE") }),
  z.strictObject({ kind: z.literal("IDOL"), handle: slugSchema }),
  z.strictObject({ kind: z.literal("GIFT"), handle: slugSchema }),
  z.strictObject({ kind: z.literal("POLICY"), policyKey: policyKeySchema }),
]);
export const storefrontSeoCursorSchema = z
  .string()
  .min(1)
  .max(768)
  .regex(/^[A-Za-z0-9_-]+$/u);
/** Canonical, locale-neutral owner ordering; cursors are public navigation, never authority. */
export const storefrontSeoKeySchema = z
  .string()
  .max(128)
  .superRefine((key, context) => {
    const valid =
      key === "0:homepage" ||
      (/^[12]:/u.test(key) &&
        z.uuid().safeParse(key.slice(2)).success &&
        key === key.toLowerCase()) ||
      (key.startsWith("3:") && policyKeySchema.safeParse(key.slice(2)).success);
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "invalid stable SEO owner key",
      });
  });
export const storefrontSeoCursorPayloadSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.enum(["INDEX", "CATALOG"]),
  catalogVersion: catalogVersionSchema,
  afterKey: storefrontSeoKeySchema.nullable(),
});
export const storefrontSeoReadCommandSchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      operation: z.literal("ENTITY"),
      locator: storefrontSeoLocatorSchema,
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      operation: z.literal("INDEX"),
      cursor: storefrontSeoCursorSchema.optional(),
    }),
    z.strictObject({
      schemaVersion: schemaVersionSchema,
      operation: z.literal("CATALOG"),
      cursor: storefrontSeoCursorSchema.optional(),
    }),
  ],
);
export const storefrontSeoEntitySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    locator: storefrontSeoLocatorSchema,
    publication: publishedContentResponseSchema.options[0].shape.publication,
    locales: z
      .array(
        z.strictObject({
          locale: supportedLocaleSchema,
          translationRevision: z.uuid(),
          lastModified: contentTimestampSchema,
        }),
      )
      .min(1)
      .max(SUPPORTED_LOCALES.length),
  })
  .superRefine((value, context) => {
    if (
      value.locales.some(
        (row, index) =>
          (index > 0 &&
            SUPPORTED_LOCALES.indexOf(row.locale) <=
              SUPPORTED_LOCALES.indexOf(value.locales[index - 1]!.locale)) ||
          row.lastModified !== value.publication.publishedAt,
      ) ||
      new Set(value.locales.map((row) => row.translationRevision.toLowerCase()))
        .size !== value.locales.length
    )
      context.addIssue({
        code: "custom",
        message:
          "SEO requires a unique canonical ordered locale subset of one publication",
      });
  });
export const storefrontSeoFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_QUERY",
    "INVALID_CURSOR",
    "CATALOG_CHANGED",
    "NOT_FOUND",
    "CONTENT_UNAVAILABLE",
  ]),
});
const pageInfo = z
  .strictObject({
    hasNextPage: z.boolean(),
    endCursor: storefrontSeoCursorSchema.nullable(),
  })
  .refine((value) => value.hasNextPage === (value.endCursor !== null));
const descriptor = z.strictObject({
  cursor: storefrontSeoCursorSchema,
  itemCount: z.number().int().min(1).max(STOREFRONT_SEO_LIMITS.index),
});
export const storefrontSeoResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STOREFRONT_SEO_ENTITY"),
    entity: storefrontSeoEntitySchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STOREFRONT_SEO_INDEX"),
    catalogVersion: catalogVersionSchema,
    items: z.array(storefrontSeoEntitySchema).max(STOREFRONT_SEO_LIMITS.index),
    pageInfo,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STOREFRONT_SEO_CATALOG"),
    catalogVersion: catalogVersionSchema,
    shards: z.array(descriptor).max(STOREFRONT_SEO_LIMITS.catalog),
    pageInfo,
  }),
  storefrontSeoFailureSchema,
]);
const candidate = z.strictObject({
  key: storefrontSeoKeySchema,
  locator: storefrontSeoLocatorSchema,
});
const boundary = z.strictObject({
  firstKey: storefrontSeoKeySchema,
  lastKey: storefrontSeoKeySchema,
  afterKey: storefrontSeoKeySchema.nullable(),
  itemCount: descriptor.shape.itemCount,
});
/** Internal bounded facts; no content hydration is needed to describe sitemap shards. */
export const storefrontSeoSnapshotSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    operation: z.literal("INDEX"),
    catalogVersion: catalogVersionSchema,
    candidates: z.array(candidate).max(STOREFRONT_SEO_LIMITS.index),
    hasNextPage: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    operation: z.literal("CATALOG"),
    catalogVersion: catalogVersionSchema,
    boundaries: z.array(boundary).max(STOREFRONT_SEO_LIMITS.catalog),
    hasNextPage: z.boolean(),
  }),
  storefrontSeoFailureSchema,
]);
export type StorefrontSeoLocator = z.infer<typeof storefrontSeoLocatorSchema>;
export type StorefrontSeoReadCommand = z.infer<
  typeof storefrontSeoReadCommandSchema
>;
export type StorefrontSeoCursorPayload = z.infer<
  typeof storefrontSeoCursorPayloadSchema
>;
export type StorefrontSeoEntity = z.infer<typeof storefrontSeoEntitySchema>;
export type StorefrontSeoFailure = z.infer<typeof storefrontSeoFailureSchema>;
export type StorefrontSeoResponse = z.infer<typeof storefrontSeoResponseSchema>;
export type StorefrontSeoSnapshot = z.infer<typeof storefrontSeoSnapshotSchema>;
