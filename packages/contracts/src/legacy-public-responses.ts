/** Frozen v1 decoding and artifact roots. Runtime readers use the current content schemas. */
import { z } from "zod";
import { CATALOG_DISCOVERY_LIMITS } from "./catalog-discovery.js";
import { localeContextSchema } from "./locale.js";
import { legacyPublishedMediaViewSchema } from "./media-content.js";
import {
  legacyPublishedIdolViewSchema,
  legacyPublishedGiftViewSchema,
} from "./catalog-content.js";
import { legacyPublishedHomepageViewSchema } from "./content-models.js";
import {
  publishedContentSchema,
  publishedContentResponseSchema,
  publishedGiftDetailBlockSchema,
  publishedGiftDetailsSchema,
} from "./published-content.js";
import {
  idolDirectoryResponseSchema,
  giftDirectoryResponseSchema,
} from "./catalog-directory-public.js";
import { publishedGiftCommerceResponseSchema } from "./published-gift-commerce.js";
import { storefrontHomepageResponseSchema } from "./storefront-homepage.js";
import {
  storefrontGiftRecipientSchema,
  storefrontGiftResponseSchema,
} from "./storefront-commerce.js";

const blocks = publishedGiftDetailBlockSchema.options;
const legacyBlock = z.discriminatedUnion("kind", [
  blocks[0],
  blocks[1],
  blocks[2],
  blocks[3],
  blocks[4].extend({ media: legacyPublishedMediaViewSchema }),
]);
const legacyDetails = z.discriminatedUnion("format", [
  publishedGiftDetailsSchema.options[0],
  publishedGiftDetailsSchema.options[1].safeExtend({
    blocks: z
      .array(legacyBlock)
      .min(1)
      .max(32)
      .superRefine((rows, context) => {
        if (new Set(rows.map((row) => row.id)).size !== rows.length)
          context.addIssue({
            code: "custom",
            message: "public detail identities must be unique",
          });
      }),
  }),
]);
const content = publishedContentSchema.options;
export const legacyPublishedContentSchema = z.discriminatedUnion("kind", [
  content[0].safeExtend({ view: legacyPublishedIdolViewSchema }),
  content[1].safeExtend({
    view: legacyPublishedGiftViewSchema,
    details: legacyDetails,
  }),
  content[2].extend({ view: legacyPublishedHomepageViewSchema }),
  content[3],
  content[4].extend({
    localeContext: localeContextSchema,
    view: legacyPublishedMediaViewSchema,
  }),
]);
export const legacyPublishedContentResponseSchema = z.union([
  publishedContentResponseSchema.options[0].extend({
    content: legacyPublishedContentSchema,
  }),
  publishedContentResponseSchema.options[1],
]);
export const legacyIdolDirectoryResponseSchema = z.union([
  idolDirectoryResponseSchema.options[0].extend({
    items: z
      .array(legacyPublishedIdolViewSchema)
      .max(CATALOG_DISCOVERY_LIMITS.artistWindowMaximum),
  }),
  idolDirectoryResponseSchema.options[1],
]);
export const legacyGiftDirectoryResponseSchema = z.union([
  giftDirectoryResponseSchema.options[0].extend({
    items: z
      .array(
        giftDirectoryResponseSchema.options[0].shape.items.element.extend({
          gift: legacyPublishedGiftViewSchema,
        }),
      )
      .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum),
  }),
  giftDirectoryResponseSchema.options[1],
]);
export const legacyPublishedGiftCommerceResponseSchema = z.union([
  publishedGiftCommerceResponseSchema.options[0].extend({
    content: legacyPublishedContentSchema.options[1],
  }),
  publishedGiftCommerceResponseSchema.options[1],
]);

const homepage = storefrontHomepageResponseSchema.options[0];
const slots = homepage.shape.slots.element.options;
export const legacyStorefrontHomepageResponseSchema = z.union([
  homepage.safeExtend({
    homepage: homepage.shape.homepage.extend({
      content: legacyPublishedContentSchema.options[2],
    }),
    slots: z
      .array(
        z.union([
          slots[0].extend({
            content: slots[0].shape.content.extend({
              content: legacyPublishedContentSchema.options[0],
            }),
          }),
          slots[1].extend({
            content: slots[1].shape.content.extend({
              content: legacyPublishedContentSchema.options[1],
            }),
          }),
          slots[2],
          slots[3],
        ]),
      )
      .min(1)
      .max(32),
  }),
  storefrontHomepageResponseSchema.options[1],
]);
const recipients = storefrontGiftRecipientSchema.options;
export const legacyStorefrontGiftRecipientSchema = z.discriminatedUnion(
  "kind",
  [
    recipients[0],
    recipients[1].extend({
      idol: recipients[1].shape.idol.safeExtend({
        localeContext: localeContextSchema,
        portrait: legacyPublishedMediaViewSchema,
      }),
    }),
    recipients[2],
  ],
);
export const legacyStorefrontGiftResponseSchema = z.union([
  storefrontGiftResponseSchema.options[0].safeExtend({
    content: legacyPublishedContentSchema.options[1],
    recipient: legacyStorefrontGiftRecipientSchema,
  }),
  storefrontGiftResponseSchema.options[1],
]);
