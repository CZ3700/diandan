import { z } from "zod";
import {
  adminContentFailureSchema,
  adminAuthorizationCommandSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import { idempotencyKeySchema } from "./identifiers.js";

export const HOME_LAYOUT_SECTION_IDS = [
  "HERO",
  "KINDS",
  "ARTISTS",
  "GIFTS",
  "POLICIES",
  "HOW_IT_WORKS",
  "STUDIO_PROMISE",
  "FINAL_CTA",
] as const;
export const REQUIRED_HOME_LAYOUT_SECTION_IDS = [
  "HERO",
  "ARTISTS",
  "GIFTS",
] as const;
export const homeLayoutSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sections: z
      .array(
        z.strictObject({
          id: z.enum(HOME_LAYOUT_SECTION_IDS),
          visible: z.boolean(),
        }),
      )
      .length(HOME_LAYOUT_SECTION_IDS.length),
  })
  .superRefine((layout, context) => {
    if (
      new Set(layout.sections.map((section) => section.id)).size !==
      HOME_LAYOUT_SECTION_IDS.length
    )
      context.addIssue({
        code: "custom",
        message: "Each deployed section must appear exactly once",
        path: ["sections"],
      });
    if (
      REQUIRED_HOME_LAYOUT_SECTION_IDS.some(
        (id) =>
          !layout.sections.some(
            (section) => section.id === id && section.visible,
          ),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Required entry sections must remain visible",
        path: ["sections"],
      });
  });
export type HomeLayout = z.infer<typeof homeLayoutSchema>;
export function createDefaultHomeLayout(): HomeLayout {
  return {
    schemaVersion: 1,
    sections: HOME_LAYOUT_SECTION_IDS.map((id) => ({ id, visible: true })),
  };
}
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const homeLayoutRevisionSchema = z.strictObject({
  revisionId: z.uuid(),
  layout: homeLayoutSchema,
  createdAt: contentTimestampSchema,
});
export const homeLayoutPublicationSchema = z.strictObject({
  publicationId: z.uuid(),
  revisionId: z.uuid(),
  version: version.min(1),
  layout: homeLayoutSchema,
  publishedAt: contentTimestampSchema,
  action: z.enum(["PUBLISH", "RESTORE"]),
  restoredFromPublicationId: z.uuid().nullable(),
});
export const homeLayoutStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version,
  draft: homeLayoutRevisionSchema.nullable(),
  published: homeLayoutPublicationSchema.nullable(),
});
const mutation = {
  schemaVersion: z.literal(1),
  expectedVersion: version,
  idempotencyKey: idempotencyKeySchema,
};
export const homeLayoutCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ schemaVersion: z.literal(1), action: z.literal("READ") }),
  z.strictObject({
    ...mutation,
    action: z.literal("SAVE_DRAFT"),
    layout: homeLayoutSchema,
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
export const homeLayoutRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: homeLayoutCommandSchema,
});
export const homeLayoutResponseSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("STATE"),
    state: homeLayoutStateSchema,
    replayed: z.boolean(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    outcome: z.literal("SUCCESS"),
    kind: z.literal("HISTORY"),
    entries: z.array(homeLayoutPublicationSchema).max(20),
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(20),
    hasMore: z.boolean(),
  }),
  adminContentFailureSchema,
]);
export const publicHomeLayoutResponseSchema = z.union([
  z
    .strictObject({
      schemaVersion: z.literal(1),
      outcome: z.literal("SUCCESS"),
      kind: z.literal("HOME_LAYOUT"),
      source: z.enum(["DEFAULT", "PUBLISHED"]),
      layout: homeLayoutSchema,
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
export const homeLayoutPreviewMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("HOME_LAYOUT_PREVIEW"),
  channel: z.uuid(),
  layout: homeLayoutSchema,
});
export const homeLayoutPreviewReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal("HOME_LAYOUT_PREVIEW_READY"),
  channel: z.uuid(),
});
export type HomeLayoutCommand = z.infer<typeof homeLayoutCommandSchema>;
export type HomeLayoutRequest = z.infer<typeof homeLayoutRequestSchema>;
export type HomeLayoutState = z.infer<typeof homeLayoutStateSchema>;
export type HomeLayoutPublication = z.infer<typeof homeLayoutPublicationSchema>;
export type HomeLayoutResponse = z.infer<typeof homeLayoutResponseSchema>;
export type PublicHomeLayoutResponse = z.infer<
  typeof publicHomeLayoutResponseSchema
>;
export type HomeLayoutPreviewMessage = z.infer<
  typeof homeLayoutPreviewMessageSchema
>;
export type HomeLayoutPreviewReady = z.infer<
  typeof homeLayoutPreviewReadySchema
>;

export const homeLayoutAuthorizationCommandSchema =
  adminAuthorizationCommandSchema.extend({
    permission: z.enum(["content.read", "content.edit", "content.publish"]),
    locales: z.tuple([]),
  });
export type HomeLayoutAuthorizationCommand = z.infer<
  typeof homeLayoutAuthorizationCommandSchema
>;
