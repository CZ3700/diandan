import { z } from "zod";
import { cartRuntimeFailureCodeSchema } from "./cart-runtime.js";
import {
  contentTimestampSchema,
  sourceHashSchema,
} from "./content-lifecycle.js";
import {
  checkoutSessionIdSchema,
  contentPublicationIdSchema,
  contentRevisionIdSchema,
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
  policyRevisionIdSchema,
  policyTranslationRevisionIdSchema,
  translationRevisionIdSchema,
} from "./identifiers.js";
import { DEFAULT_LOCALE, supportedLocaleSchema } from "./locale.js";
import { mediaObjectKeySchema } from "./media-content.js";
import { policyKeySchema } from "./content-models.js";

export const checkoutVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const checkoutPreflightIdSchema = z
  .uuid()
  .brand<"CheckoutPreflightId">();
/** PostgreSQL text limits count Unicode codepoints; preserve the original text. */
export const checkoutText = (limit: number) =>
  z
    .string()
    .min(1)
    .max(limit * 2)
    .refine((value) => {
      const characters = Array.from(value);
      return (
        characters.length <= limit &&
        characters.every((character) => {
          const point = character.codePointAt(0)!;
          return point < 0xd800 || point > 0xdfff;
        })
      );
    })
    .meta({
      minLength: 1,
      maxLength: limit,
      "x-runtime-invariants": [
        "Only valid Unicode scalar values; original text is preserved",
      ],
    });

const provenance = {
  schemaVersion: z.literal(1),
  publicationId: contentPublicationIdSchema,
  revisionId: contentRevisionIdSchema,
  manifestHash: sourceHashSchema,
  sourceHash: sourceHashSchema,
  requestedLocale: supportedLocaleSchema,
  resolvedLocale: supportedLocaleSchema,
  translationRevisionId: translationRevisionIdSchema,
  fallbackUsed: z.boolean(),
};
/** Verified immutable facts, never client authority. Media alt publicationId/manifestHash identify the parent content witness; revisionId remains its actual metadata revision. */
export const checkoutTranslationSnapshotSchema = z.discriminatedUnion("mode", [
  z
    .strictObject({ ...provenance, mode: z.literal("APPROVED") })
    .refine((value) =>
      value.fallbackUsed
        ? value.requestedLocale !== DEFAULT_LOCALE &&
          value.resolvedLocale === DEFAULT_LOCALE
        : value.requestedLocale === value.resolvedLocale,
    ),
  z
    .strictObject({
      ...provenance,
      mode: z.literal("DAILY"),
      publicationMode: z.literal("DIRECT_OPERATOR_V1"),
      sourceLocale: supportedLocaleSchema,
    })
    .refine(
      (value) =>
        value.resolvedLocale === value.sourceLocale &&
        value.fallbackUsed === (value.requestedLocale !== value.sourceLocale),
    ),
]);
export const checkoutMediaSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    assetId: mediaAssetIdSchema,
    checksum: sourceHashSchema,
    objectKey: mediaObjectKeySchema,
    metadataRevisionId: mediaMetadataRevisionIdSchema,
    alt: checkoutText(300),
    altTranslation: checkoutTranslationSnapshotSchema,
  })
  .refine(
    (value) =>
      value.metadataRevisionId.toLowerCase() ===
      value.altTranslation.revisionId.toLowerCase(),
    { message: "Media alt provenance must identify its metadata revision" },
  );
export const checkoutPolicyAcceptanceSchema = z.strictObject({
  policyKey: policyKeySchema,
  policyRevisionId: policyRevisionIdSchema,
  policyTranslationRevisionId: policyTranslationRevisionIdSchema,
  accepted: z.literal(true),
});
export const checkoutPreflightValidateCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("VALIDATE_CHECKOUT"),
  expectedCartVersion: checkoutVersionSchema,
  presentationLocale: supportedLocaleSchema,
});
export const checkoutPreflightCreateCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("CREATE_CHECKOUT"),
  preflightId: checkoutPreflightIdSchema,
  expectedCartVersion: checkoutVersionSchema,
  email: z.email().max(254),
  policyAcceptances: z
    .array(checkoutPolicyAcceptanceSchema)
    .min(1)
    .max(500)
    .refine(
      (values) =>
        new Set(values.map((value) => value.policyKey)).size === values.length,
    ),
});
export const checkoutPreflightReadCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal("READ_CHECKOUT"),
  checkoutSessionId: checkoutSessionIdSchema,
});
export const checkoutPreflightCommandSchema = z.discriminatedUnion(
  "operation",
  [
    checkoutPreflightValidateCommandSchema,
    checkoutPreflightCreateCommandSchema,
    checkoutPreflightReadCommandSchema,
  ],
);
export const checkoutPreflightFailureCodeSchema = z.enum([
  ...cartRuntimeFailureCodeSchema.options,
  "VERSION_CONFLICT",
  "EMPTY_CART",
  "PREFLIGHT_NOT_FOUND",
  "PREFLIGHT_EXPIRED",
  "PREFLIGHT_CHANGED",
  "POLICY_UNAVAILABLE",
  "POLICY_CHANGED",
  "POLICY_ACCEPTANCE_REQUIRED",
  "FULFILLMENT_UNAVAILABLE",
  "INTENT_UNAVAILABLE",
  "CHECKOUT_NOT_FOUND",
  "CHECKOUT_EXPIRED",
]);
export const checkoutPreflightFailureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.literal("FAILURE"),
  code: checkoutPreflightFailureCodeSchema,
});
export const checkoutPreflightValidateRequestSchema =
  checkoutPreflightValidateCommandSchema.omit({ operation: true });
export const checkoutPreflightCreateRequestSchema =
  checkoutPreflightCreateCommandSchema.omit({ operation: true });
export const checkoutPreflightReadRequestSchema =
  checkoutPreflightReadCommandSchema.omit({
    operation: true,
    checkoutSessionId: true,
  });
export const checkoutRecordedTimeSchema = contentTimestampSchema;
export type CheckoutTranslationSnapshot = z.infer<
  typeof checkoutTranslationSnapshotSchema
>;
export type CheckoutMediaSnapshot = z.infer<typeof checkoutMediaSnapshotSchema>;
export type CheckoutPreflightValidateCommand = z.infer<
  typeof checkoutPreflightValidateCommandSchema
>;
export type CheckoutPreflightCreateCommand = z.infer<
  typeof checkoutPreflightCreateCommandSchema
>;
export type CheckoutPreflightReadCommand = z.infer<
  typeof checkoutPreflightReadCommandSchema
>;
export type CheckoutPreflightCommand = z.infer<
  typeof checkoutPreflightCommandSchema
>;
export type CheckoutPreflightFailureCode = z.infer<
  typeof checkoutPreflightFailureCodeSchema
>;
export type CheckoutPreflightFailure = z.infer<
  typeof checkoutPreflightFailureSchema
>;
