import { z } from "zod";

import { isPublicSiteOrigin } from "./url-validation.js";

export const publicRuntimeConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    siteOrigin: z.string().refine(isPublicSiteOrigin),
  })
  .readonly();

export type PublicRuntimeConfig = Readonly<
  z.infer<typeof publicRuntimeConfigSchema>
>;

export function parsePublicRuntimeConfig(input: unknown): PublicRuntimeConfig {
  const result = publicRuntimeConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error("Public runtime configuration is invalid");
  }

  return Object.freeze({
    schemaVersion: result.data.schemaVersion,
    siteOrigin: result.data.siteOrigin,
  });
}
