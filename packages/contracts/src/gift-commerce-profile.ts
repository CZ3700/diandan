import { z } from "zod";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { schemaVersionSchema } from "./versioning.js";

/** Presentation classification. It never determines stock policy, payment, or delivery state. */
export const giftKindSchema = z.enum([
  "VIRTUAL",
  "PHYSICAL",
  "WISH",
  "MERCHANDISE",
  "OTHER",
]);
export const giftRevisionProfileSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  giftId: z.uuid(),
  giftRevisionId: z.uuid(),
  giftKind: giftKindSchema,
  createdBy: z.uuid(),
  createdAt: contentTimestampSchema,
  profileHash: sourceHashSchema,
});
export const giftPublicationProfileSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    publicationId: z.uuid(),
    giftId: z.uuid(),
    giftRevisionId: z.uuid(),
    manifestHash: sourceHashSchema,
    profile: giftRevisionProfileSchema,
  })
  .superRefine((value, context) => {
    if (
      value.giftId.toLowerCase() !== value.profile.giftId.toLowerCase() ||
      value.giftRevisionId.toLowerCase() !==
        value.profile.giftRevisionId.toLowerCase()
    )
      context.addIssue({
        code: "custom",
        message: "publication classification must bind the exact gift revision",
        path: ["profile"],
      });
  });
/** LEGACY is established from persisted migration provenance, never inferred from a missing profile. */
export const giftRevisionProfileStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("LEGACY"), giftRevisionId: z.uuid() }),
  z.strictObject({
    kind: z.literal("PROFILE"),
    profile: giftRevisionProfileSchema,
  }),
]);
export type GiftKind = z.infer<typeof giftKindSchema>;
export type GiftRevisionProfile = z.infer<typeof giftRevisionProfileSchema>;
export type GiftPublicationProfile = z.infer<
  typeof giftPublicationProfileSchema
>;
export type GiftRevisionProfileState = z.infer<
  typeof giftRevisionProfileStateSchema
>;
