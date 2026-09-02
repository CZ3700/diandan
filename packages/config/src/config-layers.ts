import { ConfigValidationError } from "./configuration-error.js";

const CONFIG_KEYS = Object.freeze([
  "NODE_ENV",
  "FAN_SUPPORT_DEPLOYMENT_ENV",
  "FAN_SUPPORT_SITE_ORIGIN",
  "FAN_SUPPORT_DATABASE_URL",
] as const);

type ConfigKey = (typeof CONFIG_KEYS)[number];
type ConfigLayerName = "configFile" | "dotenv" | "environment";

const CONFIG_LAYER_NAMES = Object.freeze([
  "configFile",
  "dotenv",
  "environment",
] as const satisfies readonly ConfigLayerName[]);
const CONFIG_LAYER_NAME_SET = new Set<string>(CONFIG_LAYER_NAMES);

export type ConfigSource = Readonly<Record<string, unknown>>;

export type RuntimeConfigSources = Readonly<{
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

  try {
    if (
      typeof sources !== "object" ||
      sources === null ||
      Array.isArray(sources)
    ) {
      throw new ConfigValidationError(["sources"]);
    }

    prototype = Object.getPrototypeOf(sources) as object | null;
    sourceKeys = Reflect.ownKeys(sources);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }

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
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new ConfigValidationError([layerName]);
  }

  try {
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
): Readonly<Partial<Record<ConfigKey, unknown>>> {
  const layers = readSourceLayers(sources);

  for (const layer of layers) {
    if (layer.source !== undefined) {
      assertKnownKeys(layer.source, layer.name);
    }
  }

  const resolved: Partial<Record<ConfigKey, unknown>> = {};
  for (const key of CONFIG_KEYS) {
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
