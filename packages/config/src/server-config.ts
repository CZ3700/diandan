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
  isPreviewSiteOrigin,
  isPublicMediaOrigin,
  isPublicSiteOrigin,
  isSupportedBrowserSiteOrigin,
} from "./url-validation.js";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);
const DEFAULT_OBJECT_STORAGE_MAX_UPLOAD_BYTES = 10 * 1_024 * 1_024;
const PREVIEW_INTERNAL_API_ORIGIN = "http://api:3002";
const PREVIEW_OBJECT_STORAGE_ENDPOINT = "https://edge:7443";
const PREVIEW_OBJECT_STORAGE_PRESIGN_ENDPOINT = "https://localhost:7443";
const PREVIEW_PUBLIC_MEDIA_ORIGIN = "https://localhost:7444";
const PREVIEW_SOURCE_BUCKET = "fan-support-media-source";
const PREVIEW_DERIVATIVE_BUCKET = "fan-support-media-derivative";
const PREVIEW_OBJECT_STORAGE_REGION = "us-east-1";

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
    siteOrigin: z.string().refine(isSupportedBrowserSiteOrigin),
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

    const allowsLoopbackHttp =
      isLoopbackHttpOrigin(config.siteOrigin) &&
      (config.deploymentEnvironment === "development" ||
        config.deploymentEnvironment === "test");
    const allowsPreviewHttps =
      config.deploymentEnvironment === "preview" &&
      isPreviewSiteOrigin(config.siteOrigin);
    const allowsPublicHttps =
      config.deploymentEnvironment !== "preview" &&
      isPublicSiteOrigin(config.siteOrigin) &&
      !isLoopbackHttpOrigin(config.siteOrigin);

    if (!allowsLoopbackHttp && !allowsPreviewHttps && !allowsPublicHttps) {
      context.addIssue({
        code: "custom",
        path: ["siteOrigin"],
        message: "site origin is incompatible with the deployment tier",
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
      config.deploymentEnvironment === "preview" &&
      config.internalApiOrigin !== PREVIEW_INTERNAL_API_ORIGIN
    ) {
      context.addIssue({
        code: "custom",
        path: ["internalApiOrigin"],
        message: "preview requires the exact local API origin",
      });
      return;
    }
    if (
      (config.deploymentEnvironment === "staging" ||
        config.deploymentEnvironment === "production") &&
      !isPublicSiteOrigin(config.internalApiOrigin)
    ) {
      context.addIssue({
        code: "custom",
        path: ["internalApiOrigin"],
        message:
          "staging and production require a canonical public HTTPS API origin",
      });
      return;
    }
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

function parseMaxUploadBytes(value: unknown): unknown {
  if (value === undefined || value === "") {
    return DEFAULT_OBJECT_STORAGE_MAX_UPLOAD_BYTES;
  }
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function isHttpsObjectStorageEndpoint(value: string): boolean {
  return isObjectStorageEndpoint(value) && !isHttpOrigin(value);
}

const objectStorageRuntimeConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    deploymentEnvironment: deploymentEnvironmentSchema,
    objectStorageAuthMode: z.enum(["static", "ambient"]),
    objectStorageEndpoint: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().refine(isHttpsObjectStorageEndpoint).optional(),
    ),
    objectStoragePresignEndpoint: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().refine(isHttpsObjectStorageEndpoint).optional(),
    ),
    objectStorageSourceBucket: z.string().refine(isObjectStorageBucket),
    objectStorageDerivativeBucket: z.string().refine(isObjectStorageBucket),
    objectStoragePublicMediaOrigin: z.string(),
    objectStorageMaxUploadBytes: z.preprocess(
      parseMaxUploadBytes,
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ),
    objectStorageRegion: z.string().refine(isObjectStorageRegion),
    objectStorageAccessKeyId: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .refine((value) => isCredential(value, 3))
        .optional(),
    ),
    objectStorageSecretAccessKey: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .refine((value) => isCredential(value, 8))
        .optional(),
    ),
    objectStorageForcePathStyle: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["true", "false"]).optional(),
    ),
  })
  .superRefine((config, context) => {
    const isPreview = config.deploymentEnvironment === "preview";
    const staticTier =
      config.deploymentEnvironment === "development" ||
      config.deploymentEnvironment === "test" ||
      isPreview;

    if (
      (isPreview &&
        config.objectStoragePublicMediaOrigin !==
          PREVIEW_PUBLIC_MEDIA_ORIGIN) ||
      (!isPreview &&
        !isPublicMediaOrigin(config.objectStoragePublicMediaOrigin))
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStoragePublicMediaOrigin"],
        message: "must use a public origin outside the exact local preview",
      });
    }

    if (
      isPreview &&
      config.objectStorageEndpoint !== PREVIEW_OBJECT_STORAGE_ENDPOINT
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageEndpoint"],
        message: "preview requires the exact local service endpoint",
      });
    }
    if (
      isPreview &&
      config.objectStoragePresignEndpoint !==
        PREVIEW_OBJECT_STORAGE_PRESIGN_ENDPOINT
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStoragePresignEndpoint"],
        message: "preview requires the exact browser presign endpoint",
      });
    }
    if (
      isPreview &&
      config.objectStorageSourceBucket !== PREVIEW_SOURCE_BUCKET
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageSourceBucket"],
        message: "preview requires the local source bucket",
      });
    }
    if (
      isPreview &&
      config.objectStorageDerivativeBucket !== PREVIEW_DERIVATIVE_BUCKET
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageDerivativeBucket"],
        message: "preview requires the local derivative bucket",
      });
    }
    if (
      isPreview &&
      config.objectStorageRegion !== PREVIEW_OBJECT_STORAGE_REGION
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageRegion"],
        message: "preview requires the local object-storage region",
      });
    }
    if (isPreview && config.objectStorageForcePathStyle !== "true") {
      context.addIssue({
        code: "custom",
        path: ["objectStorageForcePathStyle"],
        message: "preview requires path-style addressing",
      });
    }

    if (
      (staticTier && config.objectStorageAuthMode !== "static") ||
      (!staticTier && config.objectStorageAuthMode !== "ambient")
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageAuthMode"],
        message: "incompatible object-storage authentication mode",
      });
    }

    if (
      config.objectStorageSourceBucket === config.objectStorageDerivativeBucket
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageDerivativeBucket"],
        message: "source and derivative buckets must be isolated",
      });
    }

    if (
      config.objectStorageAuthMode === "static" &&
      config.objectStorageEndpoint === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageEndpoint"],
        message: "required for static authentication",
      });
    }
    if (
      config.objectStorageAuthMode === "static" &&
      config.objectStoragePresignEndpoint === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStoragePresignEndpoint"],
        message: "required for static authentication",
      });
    }
    if (
      config.objectStorageAuthMode === "static" &&
      config.objectStorageAccessKeyId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageAccessKeyId"],
        message: "required for static authentication",
      });
    }
    if (
      config.objectStorageAuthMode === "static" &&
      config.objectStorageSecretAccessKey === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageSecretAccessKey"],
        message: "required for static authentication",
      });
    }
    if (
      config.objectStorageAuthMode === "static" &&
      config.objectStorageForcePathStyle === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageForcePathStyle"],
        message: "required for static authentication",
      });
    }
    if (
      config.objectStorageAuthMode === "ambient" &&
      config.objectStorageEndpoint !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageEndpoint"],
        message: "endpoint overrides are forbidden for ambient AWS auth",
      });
    }
    if (
      config.objectStorageAuthMode === "ambient" &&
      config.objectStoragePresignEndpoint !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStoragePresignEndpoint"],
        message:
          "presign endpoint overrides are forbidden for ambient AWS auth",
      });
    }
    if (
      config.objectStorageAuthMode === "ambient" &&
      config.objectStorageAccessKeyId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageAccessKeyId"],
        message: "static credentials are forbidden for ambient AWS auth",
      });
    }
    if (
      config.objectStorageAuthMode === "ambient" &&
      config.objectStorageSecretAccessKey !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageSecretAccessKey"],
        message: "static credentials are forbidden for ambient AWS auth",
      });
    }
    if (
      config.objectStorageAuthMode === "ambient" &&
      config.objectStorageForcePathStyle === "true"
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectStorageForcePathStyle"],
        message: "path-style addressing is forbidden for ambient AWS auth",
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
type StaticObjectStorageRuntimeConfig = Readonly<{
  schemaVersion: 1;
  sourceBucket: string;
  derivativeBucket: string;
  publicMediaOrigin: string;
  allowPreviewLoopbackPublicOrigin?: true;
  maxUploadBytes: number;
  region: string;
  authentication: Readonly<{
    mode: "static";
    endpoint: string;
    presignEndpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  }>;
}>;
type AmbientObjectStorageRuntimeConfig = Readonly<{
  schemaVersion: 1;
  sourceBucket: string;
  derivativeBucket: string;
  publicMediaOrigin: string;
  allowPreviewLoopbackPublicOrigin?: true;
  maxUploadBytes: number;
  region: string;
  authentication: Readonly<{ mode: "ambient" }>;
}>;
export type ObjectStorageRuntimeConfig =
  StaticObjectStorageRuntimeConfig | AmbientObjectStorageRuntimeConfig;

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
  "objectStorageAuthMode",
  "objectStorageDerivativeBucket",
  "objectStorageEndpoint",
  "objectStorageForcePathStyle",
  "objectStoragePresignEndpoint",
  "objectStoragePublicMediaOrigin",
  "objectStorageMaxUploadBytes",
  "objectStorageRegion",
  "objectStorageSecretAccessKey",
  "objectStorageSourceBucket",
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
  "FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE",
  "FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT",
  "FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT",
  "FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET",
  "FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET",
  "FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN",
  "FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES",
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
    objectStorageAuthMode: layered.FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE,
    objectStorageEndpoint: layered.FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT,
    objectStoragePresignEndpoint:
      layered.FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT,
    objectStorageSourceBucket: layered.FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET,
    objectStorageDerivativeBucket:
      layered.FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET,
    objectStoragePublicMediaOrigin:
      layered.FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN,
    objectStorageMaxUploadBytes:
      layered.FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES,
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

  if (result.data.objectStorageAuthMode === "ambient") {
    const authentication = Object.freeze({ mode: "ambient" as const });
    return Object.freeze({
      schemaVersion: result.data.schemaVersion,
      sourceBucket: result.data.objectStorageSourceBucket,
      derivativeBucket: result.data.objectStorageDerivativeBucket,
      publicMediaOrigin: result.data.objectStoragePublicMediaOrigin,
      maxUploadBytes: result.data.objectStorageMaxUploadBytes,
      region: result.data.objectStorageRegion,
      authentication,
    });
  }

  const authentication = Object.freeze({
    mode: "static" as const,
    endpoint: result.data.objectStorageEndpoint as string,
    presignEndpoint: result.data.objectStoragePresignEndpoint as string,
    accessKeyId: result.data.objectStorageAccessKeyId as string,
    secretAccessKey: result.data.objectStorageSecretAccessKey as string,
    forcePathStyle: result.data.objectStorageForcePathStyle === "true",
  });
  return Object.freeze({
    schemaVersion: result.data.schemaVersion,
    sourceBucket: result.data.objectStorageSourceBucket,
    derivativeBucket: result.data.objectStorageDerivativeBucket,
    publicMediaOrigin: result.data.objectStoragePublicMediaOrigin,
    ...(result.data.deploymentEnvironment === "preview" &&
    result.data.objectStoragePublicMediaOrigin === PREVIEW_PUBLIC_MEDIA_ORIGIN
      ? { allowPreviewLoopbackPublicOrigin: true as const }
      : {}),
    maxUploadBytes: result.data.objectStorageMaxUploadBytes,
    region: result.data.objectStorageRegion,
    authentication,
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
