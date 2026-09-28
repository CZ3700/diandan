import { z } from "zod";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";
import { homeLayoutAuthorizationCommandSchema } from "./home-layout.js";

export const STOREFRONT_NAVIGATION_HEADER_IDS = [
  "HOME",
  "ARTISTS",
  "GIFTS",
] as const;
export const STOREFRONT_NAVIGATION_FOOTER_IDS = [
  "DESCRIPTION",
  "REGION",
  "ARTISTS",
  "GIFTS",
  "POLICIES",
] as const;
export const storefrontNavigationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    header: z
      .array(z.enum(STOREFRONT_NAVIGATION_HEADER_IDS))
      .length(STOREFRONT_NAVIGATION_HEADER_IDS.length),
    footer: z
      .array(
        z.strictObject({
          id: z.enum(STOREFRONT_NAVIGATION_FOOTER_IDS),
          visible: z.boolean(),
        }),
      )
      .length(STOREFRONT_NAVIGATION_FOOTER_IDS.length),
  })
  .superRefine((navigation, context) => {
    if (
      new Set(navigation.header).size !==
      STOREFRONT_NAVIGATION_HEADER_IDS.length
    )
      context.addIssue({
        code: "custom",
        message: "Every deployed header entry must appear exactly once",
        path: ["header"],
      });
    if (
      new Set(navigation.footer.map((entry) => entry.id)).size !==
      STOREFRONT_NAVIGATION_FOOTER_IDS.length
    )
      context.addIssue({
        code: "custom",
        message: "Every deployed footer entry must appear exactly once",
        path: ["footer"],
      });
    if (
      !navigation.footer.some(
        (entry) => entry.id === "POLICIES" && entry.visible,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Policy links must remain enabled",
        path: ["footer"],
      });
  });
export type StorefrontNavigation = z.infer<typeof storefrontNavigationSchema>;
export function createDefaultStorefrontNavigation(): StorefrontNavigation {
  return {
    schemaVersion: 1,
    header: [...STOREFRONT_NAVIGATION_HEADER_IDS],
    footer: STOREFRONT_NAVIGATION_FOOTER_IDS.map((id) => ({
      id,
      visible: id !== "GIFTS",
    })),
  };
}
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const storefrontNavigationRevisionSchema = z.strictObject({
  revisionId: z.uuid(),
  navigation: storefrontNavigationSchema,
  createdAt: contentTimestampSchema,
});
export const storefrontNavigationPublicationSchema = z.strictObject({
  publicationId: z.uuid(),
  revisionId: z.uuid(),
  version: version.min(1),
  navigation: storefrontNavigationSchema,
  publishedAt: contentTimestampSchema,
  action: z.enum(["PUBLISH", "RESTORE"]),
  restoredFromPublicationId: z.uuid().nullable(),
});
export const storefrontNavigationStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version,
  draft: storefrontNavigationRevisionSchema.nullable(),
  published: storefrontNavigationPublicationSchema.nullable(),
});
const mutation = {
  schemaVersion: z.literal(1),
  expectedVersion: version,
  idempotencyKey: idempotencyKeySchema,
};
export const storefrontNavigationCommandSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({ schemaVersion: z.literal(1), action: z.literal("READ") }),
    z.strictObject({
      ...mutation,
      action: z.literal("SAVE_DRAFT"),
      navigation: storefrontNavigationSchema,
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
  ],
);
export const storefrontNavigationRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: storefrontNavigationCommandSchema,
});
export const storefrontNavigationResponseSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STATE"),
    state: storefrontNavigationStateSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("HISTORY"),
    entries: z.array(storefrontNavigationPublicationSchema).max(20),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(20),
    hasMore: z.boolean(),
  }),
  adminContentFailureSchema,
]);
export const publicStorefrontNavigationResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      kind: z.literal("STOREFRONT_NAVIGATION"),
      source: z.enum(["DEFAULT", "PUBLISHED"]),
      navigation: storefrontNavigationSchema,
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
export const storefrontNavigationPreviewMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("STOREFRONT_NAVIGATION_PREVIEW"),
  channel: z.uuid(),
  navigation: storefrontNavigationSchema,
});
export const storefrontNavigationPreviewReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("STOREFRONT_NAVIGATION_PREVIEW_READY"),
  channel: z.uuid(),
});
export type StorefrontNavigationCommand = z.infer<
  typeof storefrontNavigationCommandSchema
>;
export type StorefrontNavigationRequest = z.infer<
  typeof storefrontNavigationRequestSchema
>;
export type StorefrontNavigationState = z.infer<
  typeof storefrontNavigationStateSchema
>;
export type StorefrontNavigationPublication = z.infer<
  typeof storefrontNavigationPublicationSchema
>;
export type StorefrontNavigationResponse = z.infer<
  typeof storefrontNavigationResponseSchema
>;
export type PublicStorefrontNavigationResponse = z.infer<
  typeof publicStorefrontNavigationResponseSchema
>;
export type StorefrontNavigationPreviewMessage = z.infer<
  typeof storefrontNavigationPreviewMessageSchema
>;
export type StorefrontNavigationPreviewReady = z.infer<
  typeof storefrontNavigationPreviewReadySchema
>;

export const storefrontNavigationAuthorizationCommandSchema =
  homeLayoutAuthorizationCommandSchema;
export type StorefrontNavigationAuthorizationCommand = z.infer<
  typeof storefrontNavigationAuthorizationCommandSchema
>;
