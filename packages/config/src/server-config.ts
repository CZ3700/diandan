import { z } from "zod";

import {
  resolveConfigLayers,
  type RuntimeConfigSources,
} from "./config-layers.js";
import { ConfigValidationError } from "./configuration-error.js";
import {
  parsePublicRuntimeConfig,
  type PublicRuntimeConfig,
} from "./public-config.js";
import {
  isHttpOrigin,
  isLoopbackHttpOrigin,
  isObjectStorageEndpoint,
  isPostgresUrl,
  isPublicSiteOrigin,
} from "./url-validation.js";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

export const deploymentEnvironmentSchema = z.enum([
  "development",
  "test",
  "preview",
  "staging",
  "production",
]);

export type NodeEnvironment = z.infer<typeof nodeEnvironmentSchema>;
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;

function expectedNodeEnvironment(
  deploymentEnvironment: DeploymentEnvironment,
): NodeEnvironment {
  if (deploymentEnvironment === "development") {
    return "development";
  }
  if (deploymentEnvironment === "test") {
    return "test";
  }

  return "production";
}

const serverRuntimeConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    nodeEnvironment: nodeEnvironmentSchema,
    deploymentEnvironment: deploymentEnvironmentSchema,
    siteOrigin: z.string().refine(isPublicSiteOrigin),
  })
  .superRefine((config, context) => {
    if (
      config.nodeEnvironment !==
      expectedNodeEnvironment(config.deploymentEnvironment)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nodeEnvironment"],
        message: "incompatible runtime tier",
      });
      context.addIssue({
        code: "custom",
        path: ["deploymentEnvironment"],
        message: "incompatible runtime tier",
      });
    }

    if (
      isLoopbackHttpOrigin(config.siteOrigin) &&
      config.deploymentEnvironment !== "development" &&
      config.deploymentEnvironment !== "test"
    ) {
      context.addIssue({
        code: "custom",
        path: ["siteOrigin"],
        message: "HTTP is limited to local development and test tiers",
      });
    }
  })
  .readonly();

const databaseRuntimeConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    url: z.string().refine(isPostgresUrl),
  })
  .readonly();

const internalApiRuntimeConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    deploymentEnvironment: deploymentEnvironmentSchema,
    internalApiOrigin: z.string().refine(isObjectStorageEndpoint),
  })
  .superRefine((config, context) => {
    if (
      isHttpOrigin(config.internalApiOrigin) &&
      config.deploymentEnvironment !== "development" &&
      config.deploymentEnvironment !== "test" &&
      config.deploymentEnvironment !== "preview"
    ) {
      context.addIssue({
        code: "custom",
        path: ["internalApiOrigin"],
        message: "HTTP is limited to development, test, and preview tiers",
      });
    }
  })
  .readonly();

function isObjectStorageBucket(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(value) &&
    !value.includes("..") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)
  );
}

function isObjectStorageRegion(value: string): boolean {
  return value.length <= 64 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}

function isCredential(value: string, minimumLength: number): boolean {
  return (
    value.length >= minimumLength &&
    value.length <= 512 &&
    value.trim() === value &&
    !hasControlCharacter(value)
  );
}

const objectStorageRuntimeConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    deploymentEnvironment: deploymentEnvironmentSchema,
    objectStorageEndpoint: z.string().refine(isObjectStorageEndpoint),
    objectStorageBucket: z.string().refine(isObjectStorageBucket),
    objectStorageRegion: z.string().refine(isObjectStorageRegion),
    objectStorageAccessKeyId: z
      .string()
      .refine((value) => isCredential(value, 3)),
    objectStorageSecretAccessKey: z
      .string()
      .refine((value) => isCredential(value, 8)),
    objectStorageForcePathStyle: z.enum(["true", "false"]),
  })
  .superRefine((config, context) => {
    if (
      isHttpOrigin(config.objectStorageEndpoint) &&
      config.deploymentEnvironment !== "development" &&
      config.deploymentEnvironment !== "test"
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageEndpoint"],
        message: "HTTP is limited to local development and test tiers",
      });
    }
  })
  .readonly();

export type ServerRuntimeConfig = Readonly<
  z.infer<typeof serverRuntimeConfigSchema>
>;
export type DatabaseRuntimeConfig = Readonly<
  z.infer<typeof databaseRuntimeConfigSchema>
>;
export type InternalApiRuntimeConfig = Readonly<{
  schemaVersion: 1;
  origin: string;
}>;
export type ObjectStorageRuntimeConfig = Readonly<{
  schemaVersion: 1;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}>;

const SERVER_FIELDS = Object.freeze([
  "deploymentEnvironment",
  "nodeEnvironment",
  "siteOrigin",
] as const);
const DATABASE_FIELDS = Object.freeze(["databaseUrl"] as const);
const INTERNAL_API_FIELDS = Object.freeze([
  "deploymentEnvironment",
  "internalApiOrigin",
] as const);
const OBJECT_STORAGE_FIELDS = Object.freeze([
  "deploymentEnvironment",
  "objectStorageAccessKeyId",
  "objectStorageBucket",
  "objectStorageEndpoint",
  "objectStorageForcePathStyle",
  "objectStorageRegion",
  "objectStorageSecretAccessKey",
] as const);
const SERVER_CONFIG_KEYS = Object.freeze([
  "NODE_ENV",
  "FAN_SUPPORT_DEPLOYMENT_ENV",
  "FAN_SUPPORT_SITE_ORIGIN",
] as const);
const DATABASE_CONFIG_KEYS = Object.freeze([
  "FAN_SUPPORT_DATABASE_URL",
] as const);
const INTERNAL_API_CONFIG_KEYS = Object.freeze([
  "FAN_SUPPORT_DEPLOYMENT_ENV",
  "FAN_SUPPORT_INTERNAL_API_ORIGIN",
] as const);
const OBJECT_STORAGE_CONFIG_KEYS = Object.freeze([
  "FAN_SUPPORT_DEPLOYMENT_ENV",
  "FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT",
  "FAN_SUPPORT_OBJECT_STORAGE_BUCKET",
  "FAN_SUPPORT_OBJECT_STORAGE_REGION",
  "FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID",
  "FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE",
] as const);

function errorFields(
  issues: readonly Readonly<{ path: readonly PropertyKey[] }>[],
  allowedFields: readonly string[],
): readonly string[] {
  const allowed = new Set(allowedFields);
  const fields = new Set<string>();

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && allowed.has(field)) {
      fields.add(field);
    }
  }

  return fields.size > 0 ? [...fields].sort() : [...allowedFields].sort();
}

export function resolveServerRuntimeConfig(
  sources: RuntimeConfigSources,
): ServerRuntimeConfig {
  const layered = resolveConfigLayers(sources, SERVER_CONFIG_KEYS);
  const result = serverRuntimeConfigSchema.safeParse({
    schemaVersion: 1,
    nodeEnvironment: layered.NODE_ENV,
    deploymentEnvironment: layered.FAN_SUPPORT_DEPLOYMENT_ENV,
    siteOrigin: layered.FAN_SUPPORT_SITE_ORIGIN,
  });

  if (!result.success) {
    throw new ConfigValidationError(
      errorFields(result.error.issues, SERVER_FIELDS),
    );
  }

  return Object.freeze({
    schemaVersion: result.data.schemaVersion,
    nodeEnvironment: result.data.nodeEnvironment,
    deploymentEnvironment: result.data.deploymentEnvironment,
    siteOrigin: result.data.siteOrigin,
  });
}

export function resolveDatabaseRuntimeConfig(
  sources: RuntimeConfigSources,
): DatabaseRuntimeConfig {
  const layered = resolveConfigLayers(sources, DATABASE_CONFIG_KEYS);
  const result = databaseRuntimeConfigSchema.safeParse({
    schemaVersion: 1,
    url: layered.FAN_SUPPORT_DATABASE_URL,
  });

  if (!result.success) {
    throw new ConfigValidationError(DATABASE_FIELDS);
  }

  return Object.freeze({
    schemaVersion: result.data.schemaVersion,
    url: result.data.url,
  });
}

export function resolveInternalApiRuntimeConfig(
  sources: RuntimeConfigSources,
): InternalApiRuntimeConfig {
  const layered = resolveConfigLayers(sources, INTERNAL_API_CONFIG_KEYS);
  const result = internalApiRuntimeConfigSchema.safeParse({
    schemaVersion: 1,
    deploymentEnvironment: layered.FAN_SUPPORT_DEPLOYMENT_ENV,
    internalApiOrigin: layered.FAN_SUPPORT_INTERNAL_API_ORIGIN,
  });

  if (!result.success) {
    throw new ConfigValidationError(
      errorFields(result.error.issues, INTERNAL_API_FIELDS),
    );
  }

  return Object.freeze({
    schemaVersion: result.data.schemaVersion,
    origin: result.data.internalApiOrigin,
  });
}

export function resolveObjectStorageRuntimeConfig(
  sources: RuntimeConfigSources,
): ObjectStorageRuntimeConfig {
  const layered = resolveConfigLayers(sources, OBJECT_STORAGE_CONFIG_KEYS);
  const result = objectStorageRuntimeConfigSchema.safeParse({
    schemaVersion: 1,
    deploymentEnvironment: layered.FAN_SUPPORT_DEPLOYMENT_ENV,
    objectStorageEndpoint: layered.FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT,
    objectStorageBucket: layered.FAN_SUPPORT_OBJECT_STORAGE_BUCKET,
    objectStorageRegion: layered.FAN_SUPPORT_OBJECT_STORAGE_REGION,
    objectStorageAccessKeyId: layered.FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID,
    objectStorageSecretAccessKey:
      layered.FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY,
    objectStorageForcePathStyle:
      layered.FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE,
  });

  if (!result.success) {
    throw new ConfigValidationError(
      errorFields(result.error.issues, OBJECT_STORAGE_FIELDS),
    );
  }

  return Object.freeze({
    schemaVersion: result.data.schemaVersion,
    endpoint: result.data.objectStorageEndpoint,
    bucket: result.data.objectStorageBucket,
    region: result.data.objectStorageRegion,
    accessKeyId: result.data.objectStorageAccessKeyId,
    secretAccessKey: result.data.objectStorageSecretAccessKey,
    forcePathStyle: result.data.objectStorageForcePathStyle === "true",
  });
}

export function toPublicRuntimeConfig(
  config: ServerRuntimeConfig,
): PublicRuntimeConfig {
  let siteOrigin: unknown;
  try {
    if (
      typeof config !== "object" ||
      config === null ||
      Array.isArray(config)
    ) {
      throw new ConfigValidationError(["siteOrigin"]);
    }

    const descriptor = Object.getOwnPropertyDescriptor(config, "siteOrigin");
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new ConfigValidationError(["siteOrigin"]);
    }
    siteOrigin = descriptor.value;
  } catch {
    throw new ConfigValidationError(["siteOrigin"]);
  }

  try {
    return parsePublicRuntimeConfig({ schemaVersion: 1, siteOrigin });
  } catch {
    throw new ConfigValidationError(["siteOrigin"]);
  }
}

export { ConfigValidationError } from "./configuration-error.js";
export type { ConfigSource, RuntimeConfigSources } from "./config-layers.js";
