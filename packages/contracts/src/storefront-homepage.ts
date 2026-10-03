import { z } from "zod";
import { publishedHomepageSlotSchema } from "./content-models.js";
import {
  publishedContentContextSchema,
  publishedContentFailureSchema,
  publishedContentResponseSchema,
  publishedContentSchema,
} from "./published-content.js";
import { supportedLocaleSchema } from "./locale.js";
import { schemaVersionSchema } from "./versioning.js";

export const storefrontHomepageReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  locale: supportedLocaleSchema,
});

const success = publishedContentResponseSchema.options[0];
const homepage = success.extend({ content: publishedContentSchema.options[2] });
const idol = success.extend({ content: publishedContentSchema.options[0] });
const gift = success.extend({ content: publishedContentSchema.options[1] });
const slotKey = publishedHomepageSlotSchema.options[0].shape.slotKey;
const idolReference = {
  slotKey,
  kind: z.enum(["HERO_IDOL", "FEATURED_IDOL"]),
  idolId: publishedHomepageSlotSchema.options[0].shape.idolId,
};
const giftReference = {
  slotKey,
  kind: z.literal("FEATURED_GIFT"),
  giftId: publishedHomepageSlotSchema.options[2].shape.giftId,
};
const unavailable = z.union([
  z.strictObject({ ...idolReference, status: z.literal("UNAVAILABLE") }),
  z.strictObject({ ...giftReference, status: z.literal("UNAVAILABLE") }),
]);
const publicSlot = z.union([
  z.strictObject({
    ...idolReference,
    status: z.literal("AVAILABLE"),
    content: idol,
  }),
  z.strictObject({
    ...giftReference,
    status: z.literal("AVAILABLE"),
    content: gift,
  }),
  ...unavailable.options,
]);
const contextSlot = z.union([
  z.strictObject({
    ...idolReference,
    status: z.literal("AVAILABLE"),
    context: publishedContentContextSchema,
  }),
  z.strictObject({
    ...giftReference,
    status: z.literal("AVAILABLE"),
    context: publishedContentContextSchema,
  }),
  ...unavailable.options,
]);

/** Internal immutable proof never crosses the public HTTP boundary. */
export const storefrontHomepageContextResponseSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    homepage: publishedContentContextSchema,
    slots: z.array(contextSlot).min(1).max(32),
  }),
  publishedContentFailureSchema,
]);

export const storefrontHomepageResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: schemaVersionSchema,
      outcome: z.literal("SUCCESS"),
      kind: z.literal("STOREFRONT_HOMEPAGE"),
      homepage,
      slots: z.array(publicSlot).min(1).max(32),
    })
    .superRefine((value, context) => {
      const expected = value.homepage.content.view.slots.filter(
        (row) => row.kind !== "POLICY_LINK",
      );
      const requested =
        value.homepage.content.view.localeContext.requestedLocale;
      const keys = new Set<string>();
      if (
        expected.length !== value.slots.length ||
        expected.filter((row) => row.kind === "HERO_IDOL").length !== 1
      )
        context.addIssue({
          code: "custom",
          path: ["slots"],
          message:
            "homepage slots require the exact published selection and one hero",
        });
      value.slots.forEach((slot, index) => {
        const row = expected[index];
        const id = slot.kind === "FEATURED_GIFT" ? slot.giftId : slot.idolId;
        const expectedId =
          row?.kind === "FEATURED_GIFT" ? row.giftId : row?.idolId;
        if (
          !row ||
          row.slotKey !== slot.slotKey ||
          row.kind !== slot.kind ||
          expectedId?.toLowerCase() !== id.toLowerCase() ||
          keys.has(slot.slotKey)
        )
          context.addIssue({
            code: "custom",
            path: ["slots", index],
            message:
              "slot must preserve its published identity and availability",
          });
        keys.add(slot.slotKey);
        if (
          slot.status === "AVAILABLE" &&
          (slot.content.content.view.id.toLowerCase() !== id.toLowerCase() ||
            slot.content.content.view.localeContext.requestedLocale !==
              requested)
        )
          context.addIssue({
            code: "custom",
            path: ["slots", index, "content"],
            message:
              "slot content must match its identity and requested locale",
          });
      });
    }),
  publishedContentFailureSchema,
]);

export type StorefrontHomepageReadCommand = z.infer<
  typeof storefrontHomepageReadCommandSchema
>;
export type StorefrontHomepageContextResponse = z.infer<
  typeof storefrontHomepageContextResponseSchema
>;
export type StorefrontHomepageResponse = z.infer<
  typeof storefrontHomepageResponseSchema
>;
