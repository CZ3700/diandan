import { z } from "zod";
import { schemaVersionSchema } from "./versioning.js";
import { supportedLocaleSchema } from "./locale.js";
import { sourceHashSchema } from "./content-lifecycle.js";
import {
  adminContentFailureSchema,
  adminContentPermissionSchema,
  adminContentRequestSchema,
  adminOpaqueTokenSchema,
} from "./admin-content.js";
import { adminResourcePermissionSchema } from "./resource-management.js";

export const adminSessionPermissionSchema = z.enum([
  ...adminContentPermissionSchema.options,
  ...adminResourcePermissionSchema.options,
  "content.publish",
]);
export const adminSessionCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  action: z.literal("READ_SESSION"),
});
export const adminSessionRequestSchema = adminContentRequestSchema
  .omit({ command: true })
  .extend({ command: adminSessionCommandSchema });
export const adminSessionReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  sessionTokenDigest: sourceHashSchema,
  csrfTokenDigest: sourceHashSchema,
});
const context = z.strictObject({
  schemaVersion: schemaVersionSchema,
  outcome: z.literal("SUCCESS"),
  kind: z.literal("ADMIN_SESSION"),
  actorId: z.uuid(),
  permissions: z
    .array(adminSessionPermissionSchema)
    .max(adminSessionPermissionSchema.options.length)
    .refine((values) => new Set(values).size === values.length),
  localeScopes: z
    .array(supportedLocaleSchema)
    .max(7)
    .refine((values) => new Set(values).size === values.length),
});
export const adminSessionResponseSchema = z.union([
  context,
  adminContentFailureSchema,
]);
/** Same-origin no-store bootstrap only; never serialize this response into HTML or RSC. */
export const adminSessionBootstrapResponseSchema = z.union([
  context.extend({ csrfToken: adminOpaqueTokenSchema }),
  adminContentFailureSchema,
]);
export type AdminSessionPermission = z.infer<
  typeof adminSessionPermissionSchema
>;
export type AdminSessionCommand = z.infer<typeof adminSessionCommandSchema>;
export type AdminSessionRequest = z.infer<typeof adminSessionRequestSchema>;
export type AdminSessionReadCommand = z.infer<
  typeof adminSessionReadCommandSchema
>;
export type AdminSessionResponse = z.infer<typeof adminSessionResponseSchema>;
export type AdminSessionBootstrapResponse = z.infer<
  typeof adminSessionBootstrapResponseSchema
>;
