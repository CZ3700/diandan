import { z } from "zod";
import {
  giftKindSchema,
  giftPublicationProfileSchema,
} from "./gift-commerce-profile.js";
import { sourceHashSchema } from "./content-lifecycle.js";
import {
  publishedContentReadCommandSchema,
  publishedContentLocatorSchema,
  publishedContentContextSchema,
  publishedContentFailureSchema,
  publishedContentResponseSchema,
  publishedContentSchema,
} from "./published-content.js";

export const publishedGiftCommerceReadCommandSchema =
  publishedContentReadCommandSchema.extend({
    locator: publishedContentLocatorSchema.options[1],
  });
export const publishedGiftClassificationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("LEGACY") }),
  z.strictObject({
    kind: z.literal("CLASSIFIED"),
    giftKind: giftKindSchema,
    profileHash: sourceHashSchema,
  }),
]);
export const publishedGiftCommerceResponseSchema = z.union([
  publishedContentResponseSchema.options[0].extend({
    kind: z.literal("PUBLISHED_GIFT_COMMERCE"),
    content: publishedContentSchema.options[1],
    classification: publishedGiftClassificationSchema,
  }),
  publishedContentFailureSchema,
]);
export const publishedGiftCommerceContextResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      context: publishedContentContextSchema,
      profileVersion: z.union([z.literal(1), z.literal(2)]),
      profile: giftPublicationProfileSchema.nullable(),
    })
    .superRefine((value, ctx) => {
      const target = value.context.publication.target;
      if (
        target.owner.kind !== "GIFT" ||
        value.context.canonical.candidate.objectKind !== "GIFT" ||
        (value.profileVersion === 1) !== (value.profile === null) ||
        (value.profile !== null &&
          (value.profile.publicationId.toLowerCase() !==
            value.context.publication.publicationId.toLowerCase() ||
            value.profile.giftId.toLowerCase() !==
              target.owner.giftId.toLowerCase() ||
            value.profile.giftRevisionId.toLowerCase() !==
              target.revisionId.toLowerCase() ||
            value.profile.manifestHash !==
              value.context.publication.manifestHash))
      )
        ctx.addIssue({
          code: "custom",
          path: ["profile"],
          message:
            "classification must bind this gift publication and its unchanged manifest",
        });
    }),
  publishedContentFailureSchema,
]);
export type PublishedGiftCommerceReadCommand = z.infer<
  typeof publishedGiftCommerceReadCommandSchema
>;
export type PublishedGiftCommerceResponse = z.infer<
  typeof publishedGiftCommerceResponseSchema
>;
export type PublishedGiftCommerceContextResponse = z.infer<
  typeof publishedGiftCommerceContextResponseSchema
>;
