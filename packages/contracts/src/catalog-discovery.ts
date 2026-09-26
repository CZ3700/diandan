import { z } from "zod";

import { giftCategorySchema } from "./catalog-content.js";
import { sourceHashSchema } from "./content-lifecycle.js";
import { currencySchema, marketSchema, minorAmountSchema } from "./commerce.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import { idolIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";

export const CATALOG_DISCOVERY_LIMITS = Object.freeze({
  artistWindowDefault: 12,
  artistWindowMaximum: 40,
  giftPageDefault: 12,
  giftPageMaximum: 48,
  giftPageNumberMaximum: 1_000,
  searchCodePointsMaximum: 80,
  searchProjectionCodePointsMaximum: 240,
});

export const artistSearchProjectionInputSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => [...value].length <= 80 && value.trim().length > 0);

export const artistSearchTermSchema = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) =>
      [...value].length <= CATALOG_DISCOVERY_LIMITS.searchCodePointsMaximum &&
      value === value.trim() &&
      !/[\p{Cc}\p{Cf}]/u.test(value),
    "search terms must be bounded, trimmed text without control characters",
  );

// NFC canonical decomposition and lowercasing can expand one scalar to three.
// The projection has its own bound; valid source queries are never truncated.
const artistSearchProjectionSchema = z
  .string()
  .min(1)
  .max(480)
  .refine(
    (value) =>
      [...value].length <=
        CATALOG_DISCOVERY_LIMITS.searchProjectionCodePointsMaximum &&
      !/[\p{Cc}\p{Cf}]/u.test(value),
    "normalized artist search exceeds its bounded projection",
  );

export const idolDiscoveryQuerySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    locale: supportedLocaleSchema,
    q: artistSearchTermSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(CATALOG_DISCOVERY_LIMITS.artistWindowMaximum)
      .default(CATALOG_DISCOVERY_LIMITS.artistWindowDefault),
    after: z
      .string()
      .min(1)
      .max(768)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional(),
    anchorId: idolIdSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.after !== undefined && value.anchorId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "cursor and direct anchor are mutually exclusive",
        path: ["anchorId"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "only published visible idols may be read",
      "cursor decoding must bind the canonical query and current catalog version",
      "anchor lookup reads a target window without loading preceding pages",
    ],
  });

export const giftDiscoverySortSchema = z.enum([
  "RECOMMENDED",
  "PRICE_ASC",
  "PRICE_DESC",
]);
export const giftDiscoveryAvailabilitySchema = z.enum([
  "ALL",
  "PURCHASABLE",
  "UNAVAILABLE",
]);
const pageNumberSchema = z
  .number()
  .int()
  .min(1)
  .max(CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum);
const pageSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum);

export const giftDiscoveryQuerySchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    locale: supportedLocaleSchema,
    market: marketSchema,
    currency: currencySchema,
    idolId: idolIdSchema.optional(),
    page: pageNumberSchema.default(1),
    pageSize: pageSizeSchema.default(CATALOG_DISCOVERY_LIMITS.giftPageDefault),
    sort: giftDiscoverySortSchema.default("RECOMMENDED"),
    category: giftCategorySchema.optional(),
    kind: giftKindSchema.optional(),
    priceMinMinor: minorAmountSchema.optional(),
    priceMaxMinor: minorAmountSchema.optional(),
    availability: giftDiscoveryAvailabilitySchema.default("ALL"),
  })
  .superRefine((value, context) => {
    if (
      value.priceMinMinor !== undefined &&
      value.priceMaxMinor !== undefined &&
      value.priceMinMinor > value.priceMaxMinor
    ) {
      context.addIssue({
        code: "custom",
        message: "minimum price exceeds maximum",
        path: ["priceMaxMinor"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "market and currency are explicit and never inferred from locale",
      "price sorting and filtering share the lowest eligible purchasable variant price",
      "unavailable unpriced items sort after priced items; checkout revalidates all offers",
      "a database snapshot and a unique final order key are required for stable pages",
    ],
  });

export const catalogPageInfoSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    page: pageNumberSchema,
    pageSize: pageSizeSchema,
    totalItems: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    totalPages: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
    paginationLimited: z.boolean(),
  })
  .superRefine((value, context) => {
    const totalPages = Math.ceil(value.totalItems / value.pageSize);
    if (
      value.totalPages !== totalPages ||
      value.hasPreviousPage !== value.page > 1 ||
      value.hasNextPage !==
        (value.page < totalPages &&
          value.page < CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum) ||
      value.paginationLimited !==
        totalPages > CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum
    ) {
      context.addIssue({
        code: "custom",
        message:
          "pagination metadata must agree with the same query total and page size",
      });
    }
  });

const sortFieldSchema = z.enum([
  "MATCH_RANK",
  "DISPLAY_ORDER",
  "PUBLISHED_AT",
  "PRICE_MINOR",
  "ID",
]);
const orderTermSchema = z.strictObject({
  field: sortFieldSchema,
  direction: z.enum(["ASC", "DESC"]),
  nulls: z.literal("LAST").optional(),
});

export const idolDiscoveryPlanSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    query: idolDiscoveryQuerySchema,
    searchTerm: artistSearchProjectionSchema.optional(),
    matchPriority: z.tuple([
      z.literal("EXACT"),
      z.literal("PREFIX"),
      z.literal("CONTAINS"),
    ]),
    orderBy: z.array(orderTermSchema).min(2).max(3),
    take: z
      .number()
      .int()
      .min(2)
      .max(CATALOG_DISCOVERY_LIMITS.artistWindowMaximum + 1),
  })
  .meta({
    "x-runtime-invariants": [
      "created by the catalog planner; never accept a query plan as a client command",
      "take includes one lookahead record; repository performs pagination before media hydration",
    ],
  });

export const giftDiscoveryPlanSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    query: giftDiscoveryQuerySchema,
    offset: z
      .number()
      .int()
      .min(0)
      .max(
        (CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum - 1) *
          CATALOG_DISCOVERY_LIMITS.giftPageMaximum,
      ),
    take: pageSizeSchema,
    orderBy: z.array(orderTermSchema).length(2),
  })
  .meta({
    "x-runtime-invariants": [
      "created by the catalog planner; never accept a query plan as a client command",
      "repository filters and orders before LIMIT/OFFSET and reads total in the same snapshot",
    ],
  });

export const changeGiftDiscoveryQuerySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  query: giftDiscoveryQuerySchema,
  changes: z.strictObject({
    locale: supportedLocaleSchema.optional(),
    page: pageNumberSchema.optional(),
    pageSize: pageSizeSchema.optional(),
    sort: giftDiscoverySortSchema.optional(),
    idolId: idolIdSchema.nullable().optional(),
    category: giftCategorySchema.nullable().optional(),
    kind: giftKindSchema.nullable().optional(),
    priceMinMinor: minorAmountSchema.nullable().optional(),
    priceMaxMinor: minorAmountSchema.nullable().optional(),
    availability: giftDiscoveryAvailabilitySchema.optional(),
  }),
});

export const catalogPageRequestSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  page: pageNumberSchema,
  pageSize: pageSizeSchema,
  totalItems: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const discoveryCacheShape = {
  schemaVersion: schemaVersionSchema,
  catalogVersion: sourceHashSchema,
};
export const discoveryCacheInputSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...discoveryCacheShape,
      kind: z.literal("IDOLS"),
      query: idolDiscoveryQuerySchema,
    }),
    z.strictObject({
      ...discoveryCacheShape,
      kind: z.literal("GIFTS"),
      query: giftDiscoveryQuerySchema,
    }),
  ])
  .meta({
    "x-runtime-invariants": [
      "catalogVersion must reflect the server-derived publication and applicable price/availability snapshot, not a client-provided version",
      "cache identity grants no authorization or publication status",
    ],
  });
export const discoveryCacheKeySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  key: z.string().regex(/^catalog:v1:[a-f0-9]{64}$/u),
});

export type DiscoveryCacheKey = z.infer<typeof discoveryCacheKeySchema>;

export type IdolDiscoveryQuery = z.infer<typeof idolDiscoveryQuerySchema>;
export type GiftDiscoveryQuery = z.infer<typeof giftDiscoveryQuerySchema>;
export type CatalogPageInfo = z.infer<typeof catalogPageInfoSchema>;
export type IdolDiscoveryPlan = z.infer<typeof idolDiscoveryPlanSchema>;
export type GiftDiscoveryPlan = z.infer<typeof giftDiscoveryPlanSchema>;
