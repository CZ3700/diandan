import { z } from "zod";
import {
  CATALOG_DISCOVERY_LIMITS,
  catalogPageInfoSchema,
} from "./catalog-discovery.js";
import {
  giftCategorySchema,
  publishedGiftViewSchema,
} from "./catalog-content.js";
import {
  catalogDirectoryFailureSchema,
  catalogVersionSchema,
} from "./catalog-directory-public.js";
import { giftKindSchema } from "./gift-commerce-profile.js";
import { idolIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";

/** Content discovery never chooses a transaction market, currency or offer. */
export const giftBrowseQuerySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  locale: supportedLocaleSchema,
  page: z
    .number()
    .int()
    .min(1)
    .max(CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum)
    .default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum)
    .default(CATALOG_DISCOVERY_LIMITS.giftPageDefault),
  category: giftCategorySchema.optional(),
  kind: giftKindSchema.optional(),
  idolId: idolIdSchema.optional(),
});

export const giftBrowseResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("SUCCESS"),
      catalogVersion: catalogVersionSchema,
      items: z
        .array(publishedGiftViewSchema)
        .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum),
      pageInfo: catalogPageInfoSchema,
    })
    .superRefine((value, context) => {
      const { page, pageSize, totalItems } = value.pageInfo;
      if (
        value.items.length !==
          Math.min(pageSize, Math.max(0, totalItems - (page - 1) * pageSize)) ||
        new Set(value.items.map((item) => item.id.toLowerCase())).size !==
          value.items.length
      )
        context.addIssue({
          code: "custom",
          path: ["items"],
          message:
            "published content must match the requested page and contain unique identities",
        });
    }),
  catalogDirectoryFailureSchema,
]);

export type GiftBrowseQuery = z.infer<typeof giftBrowseQuerySchema>;
export type GiftBrowseResponse = z.infer<typeof giftBrowseResponseSchema>;
