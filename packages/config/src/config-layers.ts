import { ConfigValidationError } from "./configuration-error.js";

const CONFIG_KEYS = Object.freeze([
  "NODE_ENV",
  "FAN_SUPPORT_DEPLOYMENT_ENV",
  "FAN_SUPPORT_SITE_ORIGIN",
  "FAN_SUPPORT_INTERNAL_API_ORIGIN",
  "FAN_SUPPORT_ADMIN_MODE",
  "FAN_SUPPORT_ADMIN_ACCESS_KEY",
  "FAN_SUPPORT_ADMIN_OIDC_ISSUER",
  "FAN_SUPPORT_ADMIN_ORIGIN",
  "FAN_SUPPORT_ADMIN_TOKEN_PEPPER",
  "FAN_SUPPORT_ADMIN_SUBJECT_PEPPER",
  "FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON",
  "FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET",
  "FAN_SUPPORT_STOREFRONT_ORIGIN",
  "FAN_SUPPORT_STOREFRONT_NAME",
  "FAN_SUPPORT_RUM_MODE",
  "FAN_SUPPORT_RUM_SAMPLE_PERMILLE",
  "FAN_SUPPORT_DATABASE_URL",
  "FAN_SUPPORT_CART_KMS_REGION",
  "FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION",
  "FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON",
  "FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION",
  "FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON",
  "FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON",
  "FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON",
  "FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON",
  "FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON",
  "FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON",
  "FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON",
  "FAN_SUPPORT_NOTIFICATION_CONFIG_JSON",
  "FAN_SUPPORT_CACHE_PURGE_PROVIDER",
  "FAN_SUPPORT_CACHE_PURGE_REGION",
  "FAN_SUPPORT_CACHE_PURGE_DISTRIBUTION_ID",
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

type ConfigKey = (typeof CONFIG_KEYS)[number];
type ConfigLayerName = "defaults" | "configFile" | "dotenv" | "environment";

const CONFIG_LAYER_NAMES = Object.freeze([
  "defaults",
  "configFile",
  "dotenv",
  "environment",
] as const satisfies readonly ConfigLayerName[]);
const CONFIG_LAYER_NAME_SET = new Set<string>(CONFIG_LAYER_NAMES);

export type ConfigSource = Readonly<Record<string, unknown>>;

export type RuntimeConfigSources = Readonly<{
  defaults?: ConfigSource;
  configFile?: ConfigSource;
  dotenv?: ConfigSource;
  environment?: ConfigSource;
}>;

const CONFIG_KEY_SET = new Set<string>(CONFIG_KEYS);

function readSourceLayers(sources: RuntimeConfigSources): readonly Readonly<{
  name: ConfigLayerName;
  source: ConfigSource | undefined;
}>[] {
  let prototype: object | null;
  let sourceKeys: readonly PropertyKey[];

  if (typeof sources !== "object" || sources === null) {
    throw new ConfigValidationError(["sources"]);
  }

  try {
    if (Array.isArray(sources)) {
      throw new ConfigValidationError(["sources"]);
    }

    prototype = Object.getPrototypeOf(sources) as object | null;
    sourceKeys = Reflect.ownKeys(sources);
  } catch {
    throw new ConfigValidationError(["sources"]);
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new ConfigValidationError(["sources"]);
  }
  if (
    sourceKeys.some(
      (key) => typeof key !== "string" || !CONFIG_LAYER_NAME_SET.has(key),
    )
  ) {
    throw new ConfigValidationError(["sources"]);
  }

  return CONFIG_LAYER_NAMES.map((name) => {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(sources, name);
    } catch {
      throw new ConfigValidationError(["sources"]);
    }

    if (descriptor === undefined) {
      return { name, source: undefined };
    }
    if (!("value" in descriptor)) {
      throw new ConfigValidationError(["sources"]);
    }

    return {
      name,
      source:
        descriptor.value === undefined
          ? undefined
          : (descriptor.value as ConfigSource),
    };
  });
}

function readOwnKeys(
  source: ConfigSource,
  layerName: ConfigLayerName,
): readonly PropertyKey[] {
  if (typeof source !== "object" || source === null) {
    throw new ConfigValidationError([layerName]);
  }

  try {
    if (Array.isArray(source)) {
      throw new ConfigValidationError([layerName]);
    }

    return Reflect.ownKeys(source);
  } catch {
    throw new ConfigValidationError([layerName]);
  }
}

function assertKnownKeys(
  source: ConfigSource,
  layerName: ConfigLayerName,
): void {
  for (const key of readOwnKeys(source, layerName)) {
    const isKnownStringKey = typeof key === "string" && CONFIG_KEY_SET.has(key);
    const isIgnoredAmbientKey =
      layerName === "environment" &&
      typeof key === "string" &&
      !key.startsWith("FAN_SUPPORT_");

    if (!isKnownStringKey && !isIgnoredAmbientKey) {
      throw new ConfigValidationError([layerName]);
    }
  }
}

function readOwnValue(
  source: ConfigSource,
  key: ConfigKey,
  layerName: ConfigLayerName,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch {
    throw new ConfigValidationError([layerName]);
  }

  if (descriptor === undefined) {
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw new ConfigValidationError([layerName]);
  }

  return descriptor.value;
}

export function resolveConfigLayers(
  sources: RuntimeConfigSources,
  requestedKeys: readonly ConfigKey[],
): Readonly<Partial<Record<ConfigKey, unknown>>> {
  const layers = readSourceLayers(sources);

  for (const layer of layers) {
    if (layer.source !== undefined) {
      assertKnownKeys(layer.source, layer.name);
    }
  }

  const resolved: Partial<Record<ConfigKey, unknown>> = {};
  for (const key of requestedKeys) {
    for (const layer of layers) {
      if (layer.source === undefined) {
        continue;
      }

      const value = readOwnValue(layer.source, key, layer.name);
      if (value !== undefined) {
        resolved[key] = value;
      }
    }
  }

  return Object.freeze(resolved);
}
