/** Historical internal proof contracts remain available alongside daily publication v3. */
import { z } from "zod";
import { legacyPublishedContentContextSchema } from "./published-content.js";
import { publishedGiftCommerceContextResponseSchema } from "./published-gift-commerce.js";
import { storefrontHomepageContextResponseSchema } from "./storefront-homepage.js";
import { storefrontGiftContextResponseSchema } from "./storefront-commerce.js";

export const legacyPublishedGiftCommerceContextResponseSchema = z.union([
  publishedGiftCommerceContextResponseSchema.options[0].safeExtend({
    context: legacyPublishedContentContextSchema,
    profileVersion: z.union([z.literal(1), z.literal(2)]),
  }),
  publishedGiftCommerceContextResponseSchema.options[1],
]);
const homepage = storefrontHomepageContextResponseSchema.options[0];
const slots = homepage.shape.slots.element.options;
export const legacyStorefrontHomepageContextResponseSchema = z.union([
  homepage.extend({
    homepage: legacyPublishedContentContextSchema,
    slots: z
      .array(
        z.union([
          slots[0].extend({ context: legacyPublishedContentContextSchema }),
          slots[1].extend({ context: legacyPublishedContentContextSchema }),
          slots[2],
          slots[3],
        ]),
      )
      .min(1)
      .max(32),
  }),
  storefrontHomepageContextResponseSchema.options[1],
]);
const gift = storefrontGiftContextResponseSchema.options[0];
const recipient = gift.shape.recipient.options;
export const legacyStorefrontGiftContextResponseSchema = z.union([
  gift.safeExtend({
    gift: legacyPublishedGiftCommerceContextResponseSchema.options[0],
    recipient: z.discriminatedUnion("kind", [
      recipient[0],
      recipient[1],
      recipient[2].extend({ context: legacyPublishedContentContextSchema }),
    ]),
  }),
  storefrontGiftContextResponseSchema.options[1],
]);
