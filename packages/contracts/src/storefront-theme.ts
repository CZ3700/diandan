import { z } from "zod";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { homeLayoutAuthorizationCommandSchema } from "./home-layout.js";

export const storefrontPresentationSchema = z.strictObject({
  heroLayout: z.enum(["IMMERSIVE", "SPLIT"]),
  giftLayout: z.enum(["GRID", "SHOWCASE"]),
  motion: z.enum(["STANDARD", "SUBTLE", "NONE"]),
  motionSpeed: z.enum(["STANDARD", "QUICK"]),
});
export type StorefrontPresentation = z.infer<
  typeof storefrontPresentationSchema
>;
export function createDefaultStorefrontPresentation(): StorefrontPresentation {
  return {
    heroLayout: "IMMERSIVE",
    giftLayout: "GRID",
    motion: "STANDARD",
    motionSpeed: "STANDARD",
  };
}
export const storefrontDetailTemplatesSchema = z.strictObject({
  artist: z.enum(["IMMERSIVE", "SPLIT"]),
  gift: z.enum(["IMAGE_LEFT", "IMAGE_RIGHT"]),
});
export type StorefrontDetailTemplates = z.infer<
  typeof storefrontDetailTemplatesSchema
>;
export function createDefaultStorefrontDetailTemplates(): StorefrontDetailTemplates {
  return { artist: "IMMERSIVE", gift: "IMAGE_LEFT" };
}
const legacyStorefrontThemeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  palette: z.enum(["BLACK_GOLD", "GRAPHITE_PEARL", "MIDNIGHT_BLUE"]),
  typography: z.enum(["STANDARD", "LARGE"]),
  density: z.enum(["STANDARD", "COMPACT", "AIRY"]),
  corners: z.enum(["SOFT", "SHARP", "ROUND"]),
});
// Keep old JSON and receipt hashes exact; display defaults never become persisted fields.
export const storefrontThemeSchema = z.union([
  legacyStorefrontThemeSchema,
  legacyStorefrontThemeSchema.extend({
    presentation: storefrontPresentationSchema,
  }),
  legacyStorefrontThemeSchema.extend({
    detailTemplates: storefrontDetailTemplatesSchema,
  }),
  legacyStorefrontThemeSchema.extend({
    presentation: storefrontPresentationSchema,
    detailTemplates: storefrontDetailTemplatesSchema,
  }),
]);
export type StorefrontTheme = z.infer<typeof storefrontThemeSchema>;
export function resolveStorefrontDetailTemplates(
  theme: StorefrontTheme,
): StorefrontDetailTemplates {
  return "detailTemplates" in theme
    ? { ...theme.detailTemplates }
    : createDefaultStorefrontDetailTemplates();
}
export function resolveStorefrontPresentation(
  theme: StorefrontTheme,
): StorefrontPresentation {
  return "presentation" in theme
    ? { ...theme.presentation }
    : createDefaultStorefrontPresentation();
}
export function createDefaultStorefrontTheme(): StorefrontTheme {
  return {
    schemaVersion: 1,
    palette: "BLACK_GOLD",
    typography: "STANDARD",
    density: "STANDARD",
    corners: "SOFT",
  };
}
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const storefrontThemeRevisionSchema = z.strictObject({
  revisionId: z.uuid(),
  theme: storefrontThemeSchema,
  createdAt: contentTimestampSchema,
});
export const storefrontThemePublicationSchema = z.strictObject({
  publicationId: z.uuid(),
  revisionId: z.uuid(),
  version: version.min(1),
  theme: storefrontThemeSchema,
  publishedAt: contentTimestampSchema,
  action: z.enum(["PUBLISH", "RESTORE"]),
  restoredFromPublicationId: z.uuid().nullable(),
});
export const storefrontThemeStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version,
  draft: storefrontThemeRevisionSchema.nullable(),
  published: storefrontThemePublicationSchema.nullable(),
});
const mutation = {
  schemaVersion: z.literal(1),
  expectedVersion: version,
  idempotencyKey: idempotencyKeySchema,
};
export const storefrontThemeCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ schemaVersion: z.literal(1), action: z.literal("READ") }),
  z.strictObject({
    ...mutation,
    action: z.literal("SAVE_DRAFT"),
    theme: storefrontThemeSchema,
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
export const storefrontThemeRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: storefrontThemeCommandSchema,
});
export const storefrontThemeResponseSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STATE"),
    state: storefrontThemeStateSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("HISTORY"),
    entries: z.array(storefrontThemePublicationSchema).max(20),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(20),
    hasMore: z.boolean(),
  }),
  adminContentFailureSchema,
]);
export const publicStorefrontThemeResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      kind: z.literal("STOREFRONT_THEME"),
      source: z.enum(["DEFAULT", "PUBLISHED"]),
      theme: storefrontThemeSchema,
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
export const storefrontThemePreviewMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("STOREFRONT_THEME_PREVIEW"),
  channel: z.uuid(),
  theme: storefrontThemeSchema,
});
export const storefrontThemePreviewReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("STOREFRONT_THEME_PREVIEW_READY"),
  channel: z.uuid(),
});
export type StorefrontThemeCommand = z.infer<
  typeof storefrontThemeCommandSchema
>;
export type StorefrontThemeRequest = z.infer<
  typeof storefrontThemeRequestSchema
>;
export type StorefrontThemeState = z.infer<typeof storefrontThemeStateSchema>;
export type StorefrontThemePublication = z.infer<
  typeof storefrontThemePublicationSchema
>;
export type StorefrontThemeResponse = z.infer<
  typeof storefrontThemeResponseSchema
>;
export type PublicStorefrontThemeResponse = z.infer<
  typeof publicStorefrontThemeResponseSchema
>;
export type StorefrontThemePreviewMessage = z.infer<
  typeof storefrontThemePreviewMessageSchema
>;
export type StorefrontThemePreviewReady = z.infer<
  typeof storefrontThemePreviewReadySchema
>;

export const storefrontThemeAuthorizationCommandSchema =
  homeLayoutAuthorizationCommandSchema;
export type StorefrontThemeAuthorizationCommand = z.infer<
  typeof storefrontThemeAuthorizationCommandSchema
>;
