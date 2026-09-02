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
  isLoopbackHttpOrigin,
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

export type ServerRuntimeConfig = Readonly<
  z.infer<typeof serverRuntimeConfigSchema>
>;
export type DatabaseRuntimeConfig = Readonly<
  z.infer<typeof databaseRuntimeConfigSchema>
>;

const SERVER_FIELDS = Object.freeze([
  "deploymentEnvironment",
  "nodeEnvironment",
  "siteOrigin",
] as const);
const DATABASE_FIELDS = Object.freeze(["databaseUrl"] as const);

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
  const layered = resolveConfigLayers(sources);
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
  const layered = resolveConfigLayers(sources);
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

export function toPublicRuntimeConfig(
  config: ServerRuntimeConfig,
): PublicRuntimeConfig {
  return parsePublicRuntimeConfig({
    schemaVersion: 1,
    siteOrigin: config.siteOrigin,
  });
}

export { ConfigValidationError } from "./configuration-error.js";
export type { ConfigSource, RuntimeConfigSources } from "./config-layers.js";
