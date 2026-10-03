import { z } from "zod";
import { keyVersionSchema } from "./commerce.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import { canonicalRequestIdSchema } from "./envelopes.js";
import { idolIdSchema, publicOrderIdSchema } from "./identifiers.js";
import { supportedLocaleSchema } from "./locale.js";
import { publicMediaUrlSchema, slugSchema } from "./presentation.js";

/** Public consent is separate from encrypted private personalization. */
export const wishPublicAliasSchema = z
  .string()
  .max(80)
  .refine((value) => {
    const characters = Array.from(value);
    return (
      value.trim() === value &&
      value.length > 0 &&
      characters.length <= 40 &&
      !/[\p{Cc}\p{Cf}]/u.test(value) &&
      characters.every((character) => {
        const point = character.codePointAt(0)!;
        return point < 0xd800 || point > 0xdfff;
      })
    );
  }, "Public alias must contain 1–40 valid visible Unicode characters without surrounding whitespace or controls")
  .meta({ minLength: 1, maxLength: 40 });
export const wishGalleryVisibilitySchema = z.enum([
  "PRIVATE",
  "PUBLIC_ANONYMOUS",
  "PUBLIC_NAMED",
]);
export const wishGalleryPreferenceSchema = z.discriminatedUnion("visibility", [
  z.strictObject({ visibility: z.literal("PRIVATE") }),
  z.strictObject({ visibility: z.literal("PUBLIC_ANONYMOUS") }),
  z.strictObject({
    visibility: z.literal("PUBLIC_NAMED"),
    publicAlias: wishPublicAliasSchema,
  }),
]);
const media = z.strictObject({
  url: publicMediaUrlSchema,
  alt: z.string().min(1).max(500),
  locale: supportedLocaleSchema,
});
export const wishGalleryEntrySchema = z.strictObject({
  entryId: z.uuid(),
  idol: z.strictObject({
    handle: slugSchema,
    displayName: z.string().min(1).max(80),
    locale: supportedLocaleSchema,
    portrait: media,
  }),
  gift: z.strictObject({
    title: z.string().min(1).max(320),
    locale: supportedLocaleSchema,
    image: media,
  }),
  supportedAt: contentTimestampSchema,
  supporter: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ANONYMOUS") }),
    z.strictObject({ kind: z.literal("NAMED"), alias: wishPublicAliasSchema }),
  ]),
});
const cursor = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/u);
export const wishGalleryCursorSchema = z.strictObject({
  supportedAt: contentTimestampSchema,
  entryId: z.uuid(),
});
export const wishGalleryReadCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  locale: supportedLocaleSchema,
  idolId: idolIdSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: cursor.optional(),
});
export const wishGalleryPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(wishGalleryEntrySchema).max(50),
  nextCursor: cursor.nullable(),
});
// Kept dependency-free from order-access because its line schema embeds wishSupport below.
const candidates = z
  .array(
    z.strictObject({
      schemaVersion: z.literal(1),
      tokenDigest: sourceHashSchema,
      pepperVersion: keyVersionSchema,
    }),
  )
  .min(1)
  .max(4)
  .refine(
    (values) =>
      new Set(values.map((value) => value.pepperVersion)).size ===
      values.length,
  );
export const wishGalleryWithdrawCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  publicOrderId: publicOrderIdSchema,
  entryId: z.uuid(),
  sessionCandidates: candidates,
  requestId: canonicalRequestIdSchema,
  correlationId: canonicalRequestIdSchema,
  taskName: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9]*(?:[-_:][a-z0-9]+)*$/u),
});
export const wishGalleryWithdrawnSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entryId: z.uuid(),
  withdrawn: z.literal(true),
});
const supportFacts = {
  entryId: z.uuid(),
  supportedAt: contentTimestampSchema,
  withdrawn: z.boolean(),
  revoked: z.boolean(),
};
export const wishSupportRecordSchema = z.discriminatedUnion("visibility", [
  wishGalleryPreferenceSchema.options[0].extend(supportFacts),
  wishGalleryPreferenceSchema.options[1].extend(supportFacts),
  wishGalleryPreferenceSchema.options[2].extend(supportFacts),
]);
export const wishGalleryFailureCodeSchema = z.enum([
  "INVALID_REQUEST",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
]);
const failure = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("FAILURE"),
  code: wishGalleryFailureCodeSchema,
});
export const wishGalleryReadResponseSchema = z.union([
  failure,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    page: wishGalleryPageSchema,
  }),
]);
export const wishGalleryWithdrawResponseSchema = z.union([
  failure,
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    withdrawn: wishGalleryWithdrawnSchema,
  }),
]);
export type WishGalleryPreference = z.infer<typeof wishGalleryPreferenceSchema>;
export type WishGalleryReadCommand = z.infer<
  typeof wishGalleryReadCommandSchema
>;
export type WishGalleryPage = z.infer<typeof wishGalleryPageSchema>;
export type WishGalleryEntry = z.infer<typeof wishGalleryEntrySchema>;
export type WishGalleryWithdrawCommand = z.infer<
  typeof wishGalleryWithdrawCommandSchema
>;
export type WishGalleryWithdrawn = z.infer<typeof wishGalleryWithdrawnSchema>;
export type WishSupportRecord = z.infer<typeof wishSupportRecordSchema>;
export type WishGalleryFailureCode = z.infer<
  typeof wishGalleryFailureCodeSchema
>;
export type WishGalleryReadResponse = z.infer<
  typeof wishGalleryReadResponseSchema
>;
export type WishGalleryWithdrawResponse = z.infer<
  typeof wishGalleryWithdrawResponseSchema
>;
