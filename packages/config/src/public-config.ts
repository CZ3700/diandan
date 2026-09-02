import { z } from "zod";

import { isPublicSiteOrigin } from "./url-validation.js";

const PUBLIC_CONFIG_KEYS = Object.freeze([
  "schemaVersion",
  "siteOrigin",
] as const);
const PUBLIC_CONFIG_KEY_SET = new Set<string>(PUBLIC_CONFIG_KEYS);
const INVALID_PUBLIC_CONFIG_INPUT = Object.freeze({});

function copyOwnPublicConfig(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return INVALID_PUBLIC_CONFIG_INPUT;
  }

  try {
    if (Array.isArray(input)) {
      return INVALID_PUBLIC_CONFIG_INPUT;
    }

    const prototype = Object.getPrototypeOf(input) as object | null;
    const keys = Reflect.ownKeys(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.length !== PUBLIC_CONFIG_KEYS.length ||
      keys.some(
        (key) => typeof key !== "string" || !PUBLIC_CONFIG_KEY_SET.has(key),
      )
    ) {
      return INVALID_PUBLIC_CONFIG_INPUT;
    }

    const schemaVersion = Object.getOwnPropertyDescriptor(
      input,
      "schemaVersion",
    );
    const siteOrigin = Object.getOwnPropertyDescriptor(input, "siteOrigin");
    if (
      schemaVersion === undefined ||
      !("value" in schemaVersion) ||
      siteOrigin === undefined ||
      !("value" in siteOrigin)
    ) {
      return INVALID_PUBLIC_CONFIG_INPUT;
    }

    return {
      schemaVersion: schemaVersion.value,
      siteOrigin: siteOrigin.value,
    };
  } catch {
    return INVALID_PUBLIC_CONFIG_INPUT;
  }
}

const publicRuntimeConfigObjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  siteOrigin: z.string().refine(isPublicSiteOrigin),
});

export const publicRuntimeConfigSchema = z
  .preprocess(copyOwnPublicConfig, publicRuntimeConfigObjectSchema)
  .readonly();

export type PublicRuntimeConfig = Readonly<
  z.infer<typeof publicRuntimeConfigSchema>
>;

export function parsePublicRuntimeConfig(input: unknown): PublicRuntimeConfig {
  try {
    const result = publicRuntimeConfigSchema.safeParse(input);
    if (result.success) {
      return Object.freeze({
        schemaVersion: result.data.schemaVersion,
        siteOrigin: result.data.siteOrigin,
      });
    }
  } catch {
    // Normalize failures from any parser internals without reflecting input.
  }

  throw new Error("Public runtime configuration is invalid");
}
