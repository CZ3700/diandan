import { z } from "zod";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { homeLayoutAuthorizationCommandSchema } from "./home-layout.js";
import { storefrontLogoViewSchema } from "./storefront-logo.js";
export const storefrontBrandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lightLogoAssetId: z.uuid().nullable(),
  darkLogoAssetId: z.uuid().nullable(),
});
export const storefrontBrandViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lightLogo: storefrontLogoViewSchema.nullable(),
  darkLogo: storefrontLogoViewSchema.nullable(),
});
export type StorefrontBrand = z.infer<typeof storefrontBrandSchema>;
export type StorefrontBrandView = z.infer<typeof storefrontBrandViewSchema>;
export function createDefaultStorefrontBrand(): StorefrontBrand {
  return { schemaVersion: 1, lightLogoAssetId: null, darkLogoAssetId: null };
}
export function createDefaultStorefrontBrandView(): StorefrontBrandView {
  return { schemaVersion: 1, lightLogo: null, darkLogo: null };
}
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
function boundBrandView(
  value: { brand: StorefrontBrand; view: StorefrontBrandView },
  context: z.RefinementCtx,
) {
  for (const slot of ["light", "dark"] as const) {
    const assetId = value.brand[`${slot}LogoAssetId`];
    const logo = value.view[`${slot}Logo`];
    if (
      (assetId === null) !== (logo === null) ||
      (assetId && logo && assetId.toLowerCase() !== logo.assetId.toLowerCase())
    )
      context.addIssue({
        code: "custom",
        path: ["view", `${slot}Logo`],
        message: "Logo does not match its registered asset",
      });
  }
}
export const storefrontBrandRevisionSchema = z
  .strictObject({
    revisionId: z.uuid(),
    brand: storefrontBrandSchema,
    view: storefrontBrandViewSchema,
    createdAt: contentTimestampSchema,
  })
  .superRefine(boundBrandView);
export const storefrontBrandPublicationSchema = z
  .strictObject({
    publicationId: z.uuid(),
    revisionId: z.uuid(),
    version: version.min(1),
    brand: storefrontBrandSchema,
    view: storefrontBrandViewSchema,
    publishedAt: contentTimestampSchema,
    action: z.enum(["PUBLISH", "RESTORE"]),
    restoredFromPublicationId: z.uuid().nullable(),
  })
  .superRefine(boundBrandView);
export const storefrontBrandStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version,
  draft: storefrontBrandRevisionSchema.nullable(),
  published: storefrontBrandPublicationSchema.nullable(),
});
const mutation = {
  schemaVersion: z.literal(1),
  expectedVersion: version,
  idempotencyKey: idempotencyKeySchema,
};
export const storefrontBrandCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ schemaVersion: z.literal(1), action: z.literal("READ") }),
  z.strictObject({
    schemaVersion: z.literal(1),
    action: z.literal("PREPARE_LOGO"),
    uploadId: z.uuid(),
    idempotencyKey: idempotencyKeySchema,
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("SAVE_DRAFT"),
    brand: storefrontBrandSchema,
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("PUBLISH"),
    draftRevisionId: z.uuid(),
  }),
  z.strictObject({
    ...mutation,
    action: z.literal("RESTORE"),
    publicationId: z.uuid(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    action: z.literal("HISTORY"),
    page: z.number().int().min(1).max(100000),
    pageSize: z.number().int().min(1).max(20),
  }),
]);
export const storefrontBrandRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: storefrontBrandCommandSchema,
});
export const storefrontBrandResponseSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("LOGO"),
    logo: storefrontLogoViewSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STATE"),
    state: storefrontBrandStateSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("HISTORY"),
    entries: z.array(storefrontBrandPublicationSchema).max(20),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(20),
    hasMore: z.boolean(),
  }),
  adminContentFailureSchema,
]);
export const publicStorefrontBrandResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      kind: z.literal("STOREFRONT_BRAND"),
      source: z.enum(["DEFAULT", "PUBLISHED"]),
      brand: storefrontBrandViewSchema,
      version,
      publicationId: z.uuid().nullable(),
    })
    .superRefine((value, context) => {
      if (
        (value.source === "DEFAULT" &&
          (value.version !== 0 || value.publicationId !== null)) ||
        (value.source === "PUBLISHED" &&
          (value.version === 0 || value.publicationId === null))
      )
        context.addIssue({
          code: "custom",
          message: "Invalid publication provenance",
        });
    }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("FAILURE"),
    code: z.literal("CONTENT_UNAVAILABLE"),
  }),
]);
export const storefrontBrandPreviewMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("STOREFRONT_BRAND_PREVIEW"),
  channel: z.uuid(),
  brand: storefrontBrandViewSchema,
});
export const storefrontBrandPreviewReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("STOREFRONT_BRAND_PREVIEW_READY"),
  channel: z.uuid(),
});
export type StorefrontBrandCommand = z.infer<
  typeof storefrontBrandCommandSchema
>;
export type StorefrontBrandRequest = z.infer<
  typeof storefrontBrandRequestSchema
>;
export type StorefrontBrandState = z.infer<typeof storefrontBrandStateSchema>;
export type StorefrontBrandPublication = z.infer<
  typeof storefrontBrandPublicationSchema
>;
export type StorefrontBrandResponse = z.infer<
  typeof storefrontBrandResponseSchema
>;
export type PublicStorefrontBrandResponse = z.infer<
  typeof publicStorefrontBrandResponseSchema
>;
export type StorefrontBrandPreviewMessage = z.infer<
  typeof storefrontBrandPreviewMessageSchema
>;
export type StorefrontBrandPreviewReady = z.infer<
  typeof storefrontBrandPreviewReadySchema
>;

export const storefrontBrandAuthorizationCommandSchema =
  homeLayoutAuthorizationCommandSchema.extend({
    permission: z.enum([
      "content.read",
      "content.edit",
      "content.publish",
      "content.media.upload",
      "content.media.rights",
    ]),
  });
export type StorefrontBrandAuthorizationCommand = z.infer<
  typeof storefrontBrandAuthorizationCommandSchema
>;
