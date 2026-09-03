import { inspect } from "node:util";

import { expect, test } from "vitest";

type ConfigSource = Readonly<Record<string, unknown>>;
type RuntimeConfigSources = Readonly<{
  defaults?: ConfigSource;
  configFile?: ConfigSource;
  dotenv?: ConfigSource;
  environment?: ConfigSource;
}>;

type ServerRuntimeConfig = Readonly<{
  schemaVersion: 1;
  nodeEnvironment: "development" | "test" | "production";
  deploymentEnvironment:
    "development" | "test" | "preview" | "staging" | "production";
  siteOrigin: string;
}>;

type DatabaseRuntimeConfig = Readonly<{
  schemaVersion: 1;
  url: string;
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

type ObjectStorageRuntimeConfig =
  StaticObjectStorageRuntimeConfig | AmbientObjectStorageRuntimeConfig;

type InternalApiRuntimeConfig = Readonly<{
  schemaVersion: 1;
  origin: string;
}>;

type PublicRuntimeConfig = Readonly<{
  schemaVersion: 1;
  siteOrigin: string;
}>;

type ServerConfigModule = Readonly<{
  ConfigValidationError: new (fields: readonly string[]) => Error;
  resolveServerRuntimeConfig: (
    sources: RuntimeConfigSources,
  ) => ServerRuntimeConfig;
  resolveDatabaseRuntimeConfig: (
    sources: RuntimeConfigSources,
  ) => DatabaseRuntimeConfig;
  resolveObjectStorageRuntimeConfig: (
    sources: RuntimeConfigSources,
  ) => ObjectStorageRuntimeConfig;
  resolveInternalApiRuntimeConfig: (
    sources: RuntimeConfigSources,
  ) => InternalApiRuntimeConfig;
  toPublicRuntimeConfig: (config: ServerRuntimeConfig) => PublicRuntimeConfig;
}>;

const productionEnvironment = {
  NODE_ENV: "production",
  FAN_SUPPORT_DEPLOYMENT_ENV: "production",
  FAN_SUPPORT_SITE_ORIGIN: "https://shop.example.invalid",
} as const;

const databaseEnvironment = {
  FAN_SUPPORT_DATABASE_URL: "postgresql://database.example.invalid/fan_support",
} as const;

const objectStorageEnvironment = {
  FAN_SUPPORT_DEPLOYMENT_ENV: "development",
  FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
  FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT:
    "https://browser-objects.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
  FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "fan-support-media-derivative",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
    "https://media.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "12582912",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
  FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
  FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
    "TEST_OBJECT_STORAGE_SECRET_VALUE",
  FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
} as const;

const previewObjectStorageEnvironment = {
  ...objectStorageEnvironment,
  FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
  FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://edge:7443",
  FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: "https://localhost:7443",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: "https://localhost:7444",
  FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
} as const;

const ambientObjectStorageEnvironment = {
  FAN_SUPPORT_DEPLOYMENT_ENV: "production",
  FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "ambient",
  FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
  FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "fan-support-media-derivative",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
    "https://media.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "12582912",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
} as const;

async function loadServerConfigModule(): Promise<ServerConfigModule> {
  let loaded: unknown;

  try {
    loaded = await import("./server-config.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "server config module must exist").toBeDefined();
  return loaded as ServerConfigModule;
}

function captureError(action: () => unknown): Error & {
  code?: unknown;
  fields?: unknown;
} {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error & { code?: unknown; fields?: unknown };
  }

  throw new Error("expected action to throw");
}

function expectInvalidConfig(
  action: () => unknown,
  fields: readonly string[],
): void {
  const error = captureError(action);

  expect(error.name).toBe("ConfigValidationError");
  expect(error.code).toBe("CONFIG_INVALID");
  expect(error.fields).toEqual(fields);
}

test("resolves immutable server and database fragments independently", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const environment: Record<string, unknown> = {
    ...productionEnvironment,
    ...databaseEnvironment,
  };

  const serverConfig = resolveServerRuntimeConfig({ environment });
  const databaseConfig = resolveDatabaseRuntimeConfig({ environment });
  environment["FAN_SUPPORT_SITE_ORIGIN"] = "https://mutated.example.invalid";
  environment["FAN_SUPPORT_DATABASE_URL"] =
    "postgresql://mutated.example.invalid/mutated";

  expect(serverConfig).toEqual({
    schemaVersion: 1,
    nodeEnvironment: "production",
    deploymentEnvironment: "production",
    siteOrigin: "https://shop.example.invalid",
  });
  expect(databaseConfig).toEqual({
    schemaVersion: 1,
    url: databaseEnvironment.FAN_SUPPORT_DATABASE_URL,
  });
  expect(Object.isFrozen(serverConfig)).toBe(true);
  expect(Object.isFrozen(databaseConfig)).toBe(true);
});

test("resolves an immutable object-storage fragment independently", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();
  const environment: Record<string, unknown> = {
    ...objectStorageEnvironment,
  };

  const objectStorageConfig = resolveObjectStorageRuntimeConfig({
    environment,
  });
  environment["FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY"] =
    "MUTATED_SECRET_VALUE";

  expect(objectStorageConfig).toEqual({
    schemaVersion: 1,
    sourceBucket: "fan-support-media-source",
    derivativeBucket: "fan-support-media-derivative",
    publicMediaOrigin: "https://media.example.invalid",
    maxUploadBytes: 12_582_912,
    region: "us-east-1",
    authentication: {
      mode: "static",
      endpoint: "https://objects.example.invalid",
      presignEndpoint: "https://browser-objects.example.invalid",
      accessKeyId: "TEST_ACCESS_KEY_ID",
      secretAccessKey: "TEST_OBJECT_STORAGE_SECRET_VALUE",
      forcePathStyle: false,
    },
  });
  expect(Object.isFrozen(objectStorageConfig)).toBe(true);
  expect(Object.isFrozen(objectStorageConfig.authentication)).toBe(true);
});

test("uses the config-owned upload limit default when no deployment override is provided", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();
  const environment: Record<string, unknown> = {
    ...objectStorageEnvironment,
  };
  delete environment["FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES"];

  expect(
    resolveObjectStorageRuntimeConfig({ environment }).maxUploadBytes,
  ).toBe(10_485_760);
});

test("applies config precedence to every object-storage field", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  const config = resolveObjectStorageRuntimeConfig({
    defaults: {
      ...objectStorageEnvironment,
      FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "defaults-source",
      FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "defaults-derivative",
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
        "https://defaults-media.example.invalid",
      FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "1048576",
      FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT:
        "https://defaults-objects.example.invalid",
      FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
    },
    configFile: {
      FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "file-source",
      FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "file-derivative",
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
        "https://file-media.example.invalid",
      FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "2097152",
      FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT:
        "https://file-objects.example.invalid",
    },
    dotenv: {
      FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "dotenv-source",
      FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "dotenv-derivative",
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
        "https://dotenv-media.example.invalid",
      FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "4194304",
      FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT:
        "https://dotenv-objects.example.invalid",
      FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
    },
    environment: {
      FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "environment-source",
      FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "environment-derivative",
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
        "https://environment-media.example.invalid",
      FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "8388608",
      FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT:
        "https://environment-objects.example.invalid",
    },
  });

  expect(config.sourceBucket).toBe("environment-source");
  expect(config.derivativeBucket).toBe("environment-derivative");
  expect(config.publicMediaOrigin).toBe(
    "https://environment-media.example.invalid",
  );
  expect(config.maxUploadBytes).toBe(8_388_608);
  expect(config.authentication).toMatchObject({
    mode: "static",
    presignEndpoint: "https://environment-objects.example.invalid",
    forcePathStyle: true,
  });
});

test.each(["staging", "production"] as const)(
  "uses ambient AWS credentials without endpoint overrides in %s",
  async (deploymentEnvironment) => {
    const { resolveObjectStorageRuntimeConfig } =
      await loadServerConfigModule();

    const config = resolveObjectStorageRuntimeConfig({
      environment: {
        FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
        FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "ambient",
        FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
        FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET:
          "fan-support-media-derivative",
        FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
          "https://media.example.invalid",
        FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "12582912",
        FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
      },
    });

    expect(config).toEqual({
      schemaVersion: 1,
      sourceBucket: "fan-support-media-source",
      derivativeBucket: "fan-support-media-derivative",
      publicMediaOrigin: "https://media.example.invalid",
      maxUploadBytes: 12_582_912,
      region: "us-east-1",
      authentication: { mode: "ambient" },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.authentication)).toBe(true);
    expect(config.authentication).not.toHaveProperty("endpoint");
    expect(config.authentication).not.toHaveProperty("presignEndpoint");
    expect(config.authentication).not.toHaveProperty("accessKeyId");
    expect(config.authentication).not.toHaveProperty("secretAccessKey");
  },
);

test("fails closed when object-storage configuration is missing", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expectInvalidConfig(
    () => resolveObjectStorageRuntimeConfig({ environment: {} }),
    [
      "deploymentEnvironment",
      "objectStorageAuthMode",
      "objectStorageDerivativeBucket",
      "objectStoragePublicMediaOrigin",
      "objectStorageRegion",
      "objectStorageSourceBucket",
    ],
  );
});

test("allows HTTPS static S3-compatible configuration in development and test", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  for (const deploymentEnvironment of ["development", "test"] as const) {
    expect(() =>
      resolveObjectStorageRuntimeConfig({
        environment: {
          ...objectStorageEnvironment,
          FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
          FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
        },
      }),
    ).not.toThrow();
  }
});

test("allows only the exact local object-storage topology in preview", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expect(
    resolveObjectStorageRuntimeConfig({
      environment: previewObjectStorageEnvironment,
    }),
  ).toMatchObject({
    publicMediaOrigin: "https://localhost:7444",
    allowPreviewLoopbackPublicOrigin: true,
    authentication: {
      mode: "static",
      endpoint: "https://edge:7443",
      presignEndpoint: "https://localhost:7443",
      forcePathStyle: true,
    },
  });
});

test("rejects a public object-storage topology mislabeled as preview", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expectInvalidConfig(
    () =>
      resolveObjectStorageRuntimeConfig({
        environment: {
          ...objectStorageEnvironment,
          FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
        },
      }),
    [
      "objectStorageEndpoint",
      "objectStorageForcePathStyle",
      "objectStoragePresignEndpoint",
      "objectStoragePublicMediaOrigin",
    ],
  );
});

test.each(["development", "test", "preview"] as const)(
  "rejects HTTP service and presign endpoints in the %s tier",
  async (deploymentEnvironment) => {
    const { resolveObjectStorageRuntimeConfig } =
      await loadServerConfigModule();

    for (const [environmentKey, field] of [
      ["FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT", "objectStorageEndpoint"],
      [
        "FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT",
        "objectStoragePresignEndpoint",
      ],
    ] as const) {
      expectInvalidConfig(
        () =>
          resolveObjectStorageRuntimeConfig({
            environment: {
              ...(deploymentEnvironment === "preview"
                ? previewObjectStorageEnvironment
                : objectStorageEnvironment),
              FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
              [environmentKey]: "http://objects.example.invalid",
            },
          }),
        [field],
      );
    }
  },
);

test("requires a browser-reachable presign endpoint for static authentication", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expectInvalidConfig(
    () =>
      resolveObjectStorageRuntimeConfig({
        environment: {
          ...objectStorageEnvironment,
          FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: undefined,
        },
      }),
    ["objectStoragePresignEndpoint"],
  );
});

test.each(["development", "test", "preview"] as const)(
  "rejects ambient object-storage auth in the %s tier",
  async (deploymentEnvironment) => {
    const { resolveObjectStorageRuntimeConfig } =
      await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveObjectStorageRuntimeConfig({
          environment: {
            ...ambientObjectStorageEnvironment,
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
          },
        }),
      deploymentEnvironment === "preview"
        ? [
            "objectStorageAuthMode",
            "objectStorageEndpoint",
            "objectStorageForcePathStyle",
            "objectStoragePresignEndpoint",
            "objectStoragePublicMediaOrigin",
          ]
        : ["objectStorageAuthMode"],
    );
  },
);

test.each(["staging", "production"] as const)(
  "rejects static object-storage auth in the %s tier",
  async (deploymentEnvironment) => {
    const { resolveObjectStorageRuntimeConfig } =
      await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveObjectStorageRuntimeConfig({
          environment: {
            ...objectStorageEnvironment,
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
          },
        }),
      ["objectStorageAuthMode"],
    );
  },
);

test.each([
  [
    "FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT",
    "https://objects.example.invalid",
    "objectStorageEndpoint",
  ],
  [
    "FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT",
    "https://browser-objects.example.invalid",
    "objectStoragePresignEndpoint",
  ],
  [
    "FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID",
    "TEST_ACCESS_KEY_ID",
    "objectStorageAccessKeyId",
  ],
  [
    "FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "TEST_OBJECT_STORAGE_SECRET_VALUE",
    "objectStorageSecretAccessKey",
  ],
  [
    "FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE",
    "true",
    "objectStorageForcePathStyle",
  ],
] as const)(
  "rejects %s when production uses ambient AWS credentials",
  async (environmentKey, value, field) => {
    const { resolveObjectStorageRuntimeConfig } =
      await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveObjectStorageRuntimeConfig({
          environment: {
            ...ambientObjectStorageEnvironment,
            [environmentKey]: value,
          },
        }),
      [field],
    );
  },
);

test("accepts explicit forcePathStyle=false with ambient AWS credentials", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expect(
    resolveObjectStorageRuntimeConfig({
      environment: {
        ...ambientObjectStorageEnvironment,
        FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
      },
    }),
  ).toEqual({
    schemaVersion: 1,
    sourceBucket: "fan-support-media-source",
    derivativeBucket: "fan-support-media-derivative",
    publicMediaOrigin: "https://media.example.invalid",
    maxUploadBytes: 12_582_912,
    region: "us-east-1",
    authentication: { mode: "ambient" },
  });
});

test("treats blank ambient-only values as unset", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expect(
    resolveObjectStorageRuntimeConfig({
      environment: {
        ...ambientObjectStorageEnvironment,
        FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "",
        FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: "",
        FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "",
        FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "",
        FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "",
      },
    }),
  ).toEqual({
    schemaVersion: 1,
    sourceBucket: "fan-support-media-source",
    derivativeBucket: "fan-support-media-derivative",
    publicMediaOrigin: "https://media.example.invalid",
    maxUploadBytes: 12_582_912,
    region: "us-east-1",
    authentication: { mode: "ambient" },
  });
});

test("requires isolated source and derivative buckets", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expectInvalidConfig(
    () =>
      resolveObjectStorageRuntimeConfig({
        environment: {
          ...objectStorageEnvironment,
          FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET:
            objectStorageEnvironment.FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET,
        },
      }),
    ["objectStorageDerivativeBucket"],
  );
});

test("allows only the exact local derivative origin used by preview", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expect(
    resolveObjectStorageRuntimeConfig({
      environment: {
        ...previewObjectStorageEnvironment,
      },
    }),
  ).toMatchObject({
    publicMediaOrigin: "https://localhost:7444",
    allowPreviewLoopbackPublicOrigin: true,
  });
});

test.each(["staging", "production"] as const)(
  "rejects the local preview media origin in %s",
  async (deploymentEnvironment) => {
    const { resolveObjectStorageRuntimeConfig } =
      await loadServerConfigModule();
    expectInvalidConfig(
      () =>
        resolveObjectStorageRuntimeConfig({
          environment: {
            ...ambientObjectStorageEnvironment,
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
            FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
              "https://localhost:7444",
          },
        }),
      ["objectStoragePublicMediaOrigin"],
    );
  },
);

test.each([
  "http://media.example.invalid",
  "https://user:password@media.example.invalid",
  "https://media.example.invalid/path",
  "https://media.example.invalid?variant=source",
  "https://media.example.invalid#fragment",
  "https://localhost",
  "https://media.localhost",
  "https://127.0.0.1",
  "https://10.0.0.1",
  "https://172.16.0.1",
  "https://192.168.0.1",
  "https://169.254.1.1",
  "https://[::1]",
  "https://[fc00::1]",
  "https://[fe80::1]",
] as const)(
  "rejects unsafe public media origin %s",
  async (publicMediaOrigin) => {
    const { resolveObjectStorageRuntimeConfig } =
      await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveObjectStorageRuntimeConfig({
          environment: {
            ...objectStorageEnvironment,
            FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: publicMediaOrigin,
          },
        }),
      ["objectStoragePublicMediaOrigin"],
    );
  },
);

test.each([
  { FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "file:///tmp/objects" },
  {
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT:
      "https://user:password@objects.example.invalid",
  },
  {
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid/path",
  },
  {
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT:
      "https://browser-objects.example.invalid/path",
  },
  { FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "UPPERCASE_BUCKET" },
  { FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "192.0.2.1" },
  { FAN_SUPPORT_OBJECT_STORAGE_REGION: "region with spaces" },
  { FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "  " },
  { FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "short" },
  { FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "yes" },
  { FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "0" },
  { FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "1.5" },
  { FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "9007199254740992" },
])("rejects invalid object-storage config %#", async (override) => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();

  expect(() =>
    resolveObjectStorageRuntimeConfig({
      environment: { ...objectStorageEnvironment, ...override },
    }),
  ).toThrowError(/Runtime configuration is invalid/u);
});

test("does not leak rejected object-storage credentials", async () => {
  const { resolveObjectStorageRuntimeConfig } = await loadServerConfigModule();
  const canary = "DO_NOT_LEAK_OBJECT_STORAGE_SECRET_83017";
  const error = captureError(() =>
    resolveObjectStorageRuntimeConfig({
      environment: {
        ...objectStorageEnvironment,
        FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: canary,
        FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "invalid",
      },
    }),
  );

  for (const rendering of [
    error.message,
    String(error),
    JSON.stringify(error),
    inspect(error),
    error.stack ?? "",
  ]) {
    expect(rendering).not.toContain(canary);
    expect(rendering).not.toContain(
      "FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY",
    );
  }
});

test("applies defaults, config file, dotenv, and environment precedence", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const sources = {
    defaults: {
      NODE_ENV: "production",
      FAN_SUPPORT_DEPLOYMENT_ENV: "production",
      FAN_SUPPORT_SITE_ORIGIN: "https://defaults.example.invalid",
      FAN_SUPPORT_DATABASE_URL: "postgresql://database.invalid/from-defaults",
    },
    configFile: {
      NODE_ENV: "production",
      FAN_SUPPORT_DEPLOYMENT_ENV: "production",
      FAN_SUPPORT_SITE_ORIGIN: "https://file.example.invalid",
      FAN_SUPPORT_DATABASE_URL: "postgresql://database.invalid/from-file",
    },
    dotenv: {
      FAN_SUPPORT_SITE_ORIGIN: "https://dotenv.example.invalid",
      FAN_SUPPORT_DATABASE_URL: "postgresql://database.invalid/from-dotenv",
    },
    environment: {
      FAN_SUPPORT_SITE_ORIGIN: "https://environment.example.invalid",
      FAN_SUPPORT_DATABASE_URL:
        "postgresql://database.invalid/from-environment",
    },
  } as const;

  expect(resolveServerRuntimeConfig(sources).siteOrigin).toBe(
    "https://environment.example.invalid",
  );
  expect(resolveDatabaseRuntimeConfig(sources).url).toBe(
    "postgresql://database.invalid/from-environment",
  );
});

test.each([
  [
    {
      defaults: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/defaults",
      },
    },
    "postgresql://db.invalid/defaults",
  ],
  [
    {
      defaults: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/defaults",
      },
      configFile: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/file" },
    },
    "postgresql://db.invalid/file",
  ],
  [
    {
      defaults: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/defaults",
      },
      configFile: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/file" },
      dotenv: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/dotenv" },
    },
    "postgresql://db.invalid/dotenv",
  ],
  [
    {
      defaults: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/defaults",
      },
      configFile: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/file" },
      dotenv: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/dotenv" },
      environment: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/environment",
      },
    },
    "postgresql://db.invalid/environment",
  ],
] as const)(
  "selects each adjacent database layer in order for case %#",
  async (sources, expectedUrl) => {
    const { resolveDatabaseRuntimeConfig } = await loadServerConfigModule();

    expect(resolveDatabaseRuntimeConfig(sources).url).toBe(expectedUrl);
  },
);

test.each([
  [
    {
      defaults: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/defaults",
      },
      configFile: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/file" },
      dotenv: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/dotenv" },
      environment: { FAN_SUPPORT_DATABASE_URL: undefined },
    },
    "postgresql://db.invalid/dotenv",
  ],
  [
    {
      defaults: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/defaults",
      },
      configFile: { FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/file" },
      dotenv: { FAN_SUPPORT_DATABASE_URL: undefined },
    },
    "postgresql://db.invalid/file",
  ],
  [
    {
      defaults: {
        FAN_SUPPORT_DATABASE_URL: "postgresql://db.invalid/defaults",
      },
      configFile: { FAN_SUPPORT_DATABASE_URL: undefined },
    },
    "postgresql://db.invalid/defaults",
  ],
] as const)(
  "falls through undefined to the adjacent database layer for case %#",
  async (sources, expectedUrl) => {
    const { resolveDatabaseRuntimeConfig } = await loadServerConfigModule();

    expect(resolveDatabaseRuntimeConfig(sources).url).toBe(expectedUrl);
  },
);

test("uses explicit safe defaults without weakening missing-config failures", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const defaults = { ...productionEnvironment, ...databaseEnvironment };

  expect(resolveServerRuntimeConfig({ defaults }).siteOrigin).toBe(
    productionEnvironment.FAN_SUPPORT_SITE_ORIGIN,
  );
  expect(resolveDatabaseRuntimeConfig({ defaults }).url).toBe(
    databaseEnvironment.FAN_SUPPORT_DATABASE_URL,
  );
});

test("treats an explicit undefined value as absent and falls back", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const sources = {
    configFile: { ...productionEnvironment, ...databaseEnvironment },
    environment: {
      FAN_SUPPORT_SITE_ORIGIN: undefined,
      FAN_SUPPORT_DATABASE_URL: undefined,
    },
  };

  expect(resolveServerRuntimeConfig(sources).siteOrigin).toBe(
    productionEnvironment.FAN_SUPPORT_SITE_ORIGIN,
  );
  expect(resolveDatabaseRuntimeConfig(sources).url).toBe(
    databaseEnvironment.FAN_SUPPORT_DATABASE_URL,
  );
});

test("fails closed when required server values are missing", async () => {
  const { resolveServerRuntimeConfig } = await loadServerConfigModule();

  expectInvalidConfig(
    () => resolveServerRuntimeConfig({ environment: {} }),
    ["deploymentEnvironment", "nodeEnvironment", "siteOrigin"],
  );
});

test("does not require database credentials to resolve browser-facing state", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();

  expect(() =>
    resolveServerRuntimeConfig({ environment: productionEnvironment }),
  ).not.toThrow();
  expectInvalidConfig(
    () => resolveDatabaseRuntimeConfig({ environment: productionEnvironment }),
    ["databaseUrl"],
  );
});

test.each(["", "   ", null])(
  "treats an explicit higher-priority database value (%j) as authoritative and invalid",
  async (databaseUrl) => {
    const { resolveDatabaseRuntimeConfig } = await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveDatabaseRuntimeConfig({
          configFile: databaseEnvironment,
          environment: { FAN_SUPPORT_DATABASE_URL: databaseUrl },
        }),
      ["databaseUrl"],
    );
  },
);

test("does not leak a rejected secret through any common error rendering", async () => {
  const { resolveDatabaseRuntimeConfig } = await loadServerConfigModule();
  const canary = "DO_NOT_LEAK_DATABASE_PASSWORD_94731";
  const error = captureError(() =>
    resolveDatabaseRuntimeConfig({
      environment: {
        FAN_SUPPORT_DATABASE_URL: `postgresql://user:${canary}@/missing-host`,
      },
    }),
  );

  expect(error.code).toBe("CONFIG_INVALID");
  expect(error.fields).toEqual(["databaseUrl"]);
  expect("cause" in error).toBe(false);

  for (const rendering of [
    error.message,
    String(error),
    JSON.stringify(error),
    inspect(error),
    error.stack ?? "",
  ]) {
    expect(rendering).not.toContain(canary);
    expect(rendering).not.toContain("FAN_SUPPORT_DATABASE_URL");
  }
});

test.each(["defaults", "configFile", "dotenv"] as const)(
  "rejects unknown keys from the explicit %s layer without reflecting them",
  async (layer) => {
    const { resolveServerRuntimeConfig } = await loadServerConfigModule();
    const keyCanary = "FAN_SUPPORT_ATTACK_KEY_72191";
    const valueCanary = "ATTACK_VALUE_57219";
    const error = captureError(() =>
      resolveServerRuntimeConfig({
        [layer]: {
          ...productionEnvironment,
          [keyCanary]: valueCanary,
        },
      }),
    );

    expect(error.fields).toEqual([layer]);
    for (const rendering of [
      String(error),
      JSON.stringify(error),
      inspect(error),
    ]) {
      expect(rendering).not.toContain(keyCanary);
      expect(rendering).not.toContain(valueCanary);
    }
  },
);

test("ignores ambient environment keys but rejects unknown project-prefixed keys", async () => {
  const { resolveServerRuntimeConfig } = await loadServerConfigModule();

  expect(() =>
    resolveServerRuntimeConfig({
      environment: { ...productionEnvironment, HOME: "/private/example" },
    }),
  ).not.toThrow();

  const keyCanary = "FAN_SUPPORT_UNKNOWN_SECRET_KEY_43911";
  const valueCanary = "UNKNOWN_SECRET_VALUE_96314";
  const error = captureError(() =>
    resolveServerRuntimeConfig({
      environment: {
        ...productionEnvironment,
        [keyCanary]: valueCanary,
      },
    }),
  );

  expect(error.fields).toEqual(["environment"]);
  expect(inspect(error)).not.toContain(keyCanary);
  expect(inspect(error)).not.toContain(valueCanary);
});

test("reads only own properties and rejects prototype-shaped explicit keys", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const inheritedDatabase = Object.create({
    FAN_SUPPORT_DATABASE_URL: databaseEnvironment.FAN_SUPPORT_DATABASE_URL,
  }) as ConfigSource;

  expectInvalidConfig(
    () => resolveDatabaseRuntimeConfig({ configFile: inheritedDatabase }),
    ["databaseUrl"],
  );

  for (const key of ["__proto__", "constructor", "prototype"]) {
    const source = JSON.parse(
      `{"${key}":{"polluted":"yes"},"NODE_ENV":"production","FAN_SUPPORT_DEPLOYMENT_ENV":"production","FAN_SUPPORT_SITE_ORIGIN":"https://shop.example.invalid"}`,
    ) as ConfigSource;

    expectInvalidConfig(
      () => resolveServerRuntimeConfig({ configFile: source }),
      ["configFile"],
    );
    expect(
      (Object.prototype as { polluted?: unknown }).polluted,
    ).toBeUndefined();
  }
});

test("rejects inherited outer layer properties", async () => {
  const { resolveServerRuntimeConfig } = await loadServerConfigModule();
  const inheritedSources = Object.create({
    environment: productionEnvironment,
  }) as RuntimeConfigSources;

  expectInvalidConfig(
    () => resolveServerRuntimeConfig(inheritedSources),
    ["sources"],
  );
});

test("rejects outer accessors without invoking or reflecting them", async () => {
  const { resolveServerRuntimeConfig } = await loadServerConfigModule();
  const canary = "OUTER_GETTER_SECRET_68135";
  let invoked = false;
  const sources = Object.defineProperty({}, "environment", {
    enumerable: true,
    get() {
      invoked = true;
      throw new Error(canary);
    },
  }) as RuntimeConfigSources;
  const error = captureError(() => resolveServerRuntimeConfig(sources));

  expect(error.fields).toEqual(["sources"]);
  expect(invoked).toBe(false);
  for (const rendering of [
    String(error),
    JSON.stringify(error),
    inspect(error),
  ]) {
    expect(rendering).not.toContain(canary);
  }
});

test("rejects unknown and prototype-shaped outer keys without reflection", async () => {
  const { resolveServerRuntimeConfig } = await loadServerConfigModule();
  const keyCanary = "UNKNOWN_OUTER_SECRET_KEY_13579";
  const valueCanary = "UNKNOWN_OUTER_SECRET_VALUE_24680";
  const unknownSources = {
    environment: productionEnvironment,
    [keyCanary]: valueCanary,
  } as RuntimeConfigSources;
  const symbolSources = Object.assign(
    { environment: productionEnvironment },
    { [Symbol(valueCanary)]: valueCanary },
  ) as RuntimeConfigSources;
  const prototypeSources = JSON.parse(
    `{"environment":{"NODE_ENV":"production","FAN_SUPPORT_DEPLOYMENT_ENV":"production","FAN_SUPPORT_SITE_ORIGIN":"https://shop.example.invalid"},"__proto__":{"secret":"${valueCanary}"}}`,
  ) as RuntimeConfigSources;

  for (const sources of [unknownSources, symbolSources, prototypeSources]) {
    const error = captureError(() => resolveServerRuntimeConfig(sources));

    expect(error.fields).toEqual(["sources"]);
    for (const rendering of [
      String(error),
      JSON.stringify(error),
      inspect(error),
    ]) {
      expect(rendering).not.toContain(keyCanary);
      expect(rendering).not.toContain(valueCanary);
    }
  }
});

test("normalizes hostile outer proxy failures", async () => {
  const { ConfigValidationError, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const canary = "OUTER_PROXY_SECRET_86420";
  const hostileErrors = [
    new Error(canary),
    new ConfigValidationError([canary]),
  ];

  for (const hostileError of hostileErrors) {
    const sources = new Proxy(
      { environment: productionEnvironment },
      {
        getPrototypeOf() {
          throw hostileError;
        },
      },
    );
    const error = captureError(() => resolveServerRuntimeConfig(sources));

    expect(error.fields).toEqual(["sources"]);
    for (const rendering of [
      error.message,
      String(error),
      JSON.stringify(error),
      inspect(error),
      error.stack ?? "",
    ]) {
      expect(rendering).not.toContain(canary);
    }
  }
});

test("normalizes revoked outer and inner proxies", async () => {
  const { resolveServerRuntimeConfig } = await loadServerConfigModule();
  const outer = Proxy.revocable({ environment: productionEnvironment }, {});
  const inner = Proxy.revocable({ ...productionEnvironment }, {});
  outer.revoke();
  inner.revoke();

  expectInvalidConfig(
    () => resolveServerRuntimeConfig(outer.proxy),
    ["sources"],
  );
  expectInvalidConfig(
    () => resolveServerRuntimeConfig({ environment: inner.proxy }),
    ["environment"],
  );
});

test("reads only the keys requested by each config fragment", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const serverReads: PropertyKey[] = [];
  const databaseReads: PropertyKey[] = [];
  const source = { ...productionEnvironment, ...databaseEnvironment };
  const serverSource = new Proxy(source, {
    getOwnPropertyDescriptor(target, key) {
      serverReads.push(key);
      if (key === "FAN_SUPPORT_DATABASE_URL") {
        throw new Error("UNRELATED_DATABASE_VALUE_MUST_NOT_BE_READ");
      }

      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const databaseSource = new Proxy(source, {
    getOwnPropertyDescriptor(target, key) {
      databaseReads.push(key);
      if (key !== "FAN_SUPPORT_DATABASE_URL") {
        throw new Error("UNRELATED_SERVER_VALUE_MUST_NOT_BE_READ");
      }

      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  expect(resolveServerRuntimeConfig({ environment: serverSource })).toEqual({
    schemaVersion: 1,
    nodeEnvironment: "production",
    deploymentEnvironment: "production",
    siteOrigin: "https://shop.example.invalid",
  });
  expect(resolveDatabaseRuntimeConfig({ environment: databaseSource })).toEqual(
    {
      schemaVersion: 1,
      url: databaseEnvironment.FAN_SUPPORT_DATABASE_URL,
    },
  );
  expect(serverReads).not.toContain("FAN_SUPPORT_DATABASE_URL");
  expect(databaseReads).toEqual(["FAN_SUPPORT_DATABASE_URL"]);
});

test.each([
  "javascript:alert(1)",
  "data:text/plain,hello",
  "file:///tmp/shop",
  "https://shop.example.invalid/path",
  "https://shop.example.invalid?query=yes",
  "https://shop.example.invalid#fragment",
  "https://user:password@shop.example.invalid",
  " https://shop.example.invalid",
  "https://shop.example.invalid\n",
  "https://shop.example.invalid\\evil",
  "http://shop.example.invalid",
])("rejects unsafe or non-origin site URL %j", async (siteOrigin) => {
  const { resolveServerRuntimeConfig } = await loadServerConfigModule();

  expectInvalidConfig(
    () =>
      resolveServerRuntimeConfig({
        environment: {
          NODE_ENV: "development",
          FAN_SUPPORT_DEPLOYMENT_ENV: "development",
          FAN_SUPPORT_SITE_ORIGIN: siteOrigin,
        },
      }),
    ["siteOrigin"],
  );
});

test.each([
  ["development", "development", "http://localhost:3000"],
  ["development", "development", "http://127.0.0.1:3000"],
  ["test", "test", "http://[::1]:3000"],
] as const)(
  "allows HTTP only for loopback in the %s tier",
  async (nodeEnvironment, deploymentEnvironment, siteOrigin) => {
    const { resolveServerRuntimeConfig } = await loadServerConfigModule();

    expect(() =>
      resolveServerRuntimeConfig({
        environment: {
          NODE_ENV: nodeEnvironment,
          FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
          FAN_SUPPORT_SITE_ORIGIN: siteOrigin,
        },
      }),
    ).not.toThrow();
  },
);

test.each(["preview", "staging", "production"] as const)(
  "rejects loopback HTTP in the %s tier",
  async (deploymentEnvironment) => {
    const { resolveServerRuntimeConfig } = await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveServerRuntimeConfig({
          environment: {
            NODE_ENV: "production",
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
            FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3000",
          },
        }),
      ["siteOrigin"],
    );
  },
);

test.each(["https://localhost:3443", "https://localhost:3444"] as const)(
  "allows only an exact HTTPS loopback origin in preview: %s",
  async (siteOrigin) => {
    const { resolveServerRuntimeConfig } = await loadServerConfigModule();

    expect(() =>
      resolveServerRuntimeConfig({
        environment: {
          NODE_ENV: "production",
          FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
          FAN_SUPPORT_SITE_ORIGIN: siteOrigin,
        },
      }),
    ).not.toThrow();
  },
);

test.each([
  ["preview", "https://shop.example.invalid"],
  ["preview", "https://localhost:3445"],
  ["staging", "https://localhost:3443"],
  ["production", "https://localhost:3444"],
  ["production", "https://127.0.0.1:443"],
  ["production", "https://10.0.0.8"],
  ["production", "https://169.254.169.254"],
  ["production", "https://192.168.1.8"],
  ["production", "https://100.64.0.1"],
  ["production", "https://198.18.0.1"],
  ["production", "https://224.0.0.1"],
  ["production", "https://[::1]"],
  ["production", "https://[fd00::1]"],
  ["production", "https://[ff02::1]"],
] as const)(
  "rejects an HTTPS site origin incompatible with %s: %s",
  async (deploymentEnvironment, siteOrigin) => {
    const { resolveServerRuntimeConfig } = await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveServerRuntimeConfig({
          environment: {
            NODE_ENV: "production",
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
            FAN_SUPPORT_SITE_ORIGIN: siteOrigin,
          },
        }),
      ["siteOrigin"],
    );
  },
);

test.each([
  ["development", "test"],
  ["test", "development"],
  ["production", "development"],
  ["development", "preview"],
] as const)(
  "rejects NODE_ENV=%s for deployment tier %s",
  async (nodeEnvironment, deploymentEnvironment) => {
    const { resolveServerRuntimeConfig } = await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveServerRuntimeConfig({
          environment: {
            NODE_ENV: nodeEnvironment,
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
            FAN_SUPPORT_SITE_ORIGIN:
              deploymentEnvironment === "preview"
                ? "https://localhost:3443"
                : "https://shop.example.invalid",
          },
        }),
      ["deploymentEnvironment", "nodeEnvironment"],
    );
  },
);

test.each([
  "mysql://database.invalid/fan_support",
  "postgresql:///fan_support",
  "postgresql://database.invalid",
  "postgresql://database.invalid/",
  "postgresql://database.invalid/fan_support#fragment",
  " postgresql://database.invalid/fan_support",
  "postgresql://database.invalid/fan_support\n",
  "postgresql://database.invalid\\fan_support",
])("rejects invalid PostgreSQL URL %j", async (databaseUrl) => {
  const { resolveDatabaseRuntimeConfig } = await loadServerConfigModule();

  expectInvalidConfig(
    () =>
      resolveDatabaseRuntimeConfig({
        environment: { FAN_SUPPORT_DATABASE_URL: databaseUrl },
      }),
    ["databaseUrl"],
  );
});

test("projects public config through an explicit allowlist", async () => {
  const { toPublicRuntimeConfig } = await loadServerConfigModule();
  const forgedConfig = Object.assign(
    Object.create({ prototypeSecret: "must-not-leak" }) as object,
    {
      schemaVersion: 1,
      nodeEnvironment: "production",
      deploymentEnvironment: "production",
      siteOrigin: "https://shop.example.invalid",
      databaseUrl: "must-not-leak",
      futureSecret: "must-not-leak",
    },
  ) as ServerRuntimeConfig;

  const publicConfig = toPublicRuntimeConfig(forgedConfig);

  expect(publicConfig).toEqual({
    schemaVersion: 1,
    siteOrigin: "https://shop.example.invalid",
  });
  expect(Object.keys(publicConfig).sort()).toEqual([
    "schemaVersion",
    "siteOrigin",
  ]);
  expect(Object.isFrozen(publicConfig)).toBe(true);
  expect(JSON.stringify(publicConfig)).not.toContain("must-not-leak");
});

test("projects an exact preview origin into browser runtime config", async () => {
  const { resolveServerRuntimeConfig, toPublicRuntimeConfig } =
    await loadServerConfigModule();
  const serverConfig = resolveServerRuntimeConfig({
    environment: {
      NODE_ENV: "production",
      FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
      FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
    },
  });

  expect(toPublicRuntimeConfig(serverConfig)).toEqual({
    schemaVersion: 1,
    siteOrigin: "https://localhost:3443",
  });
});

test.each(["development", "test", "preview"] as const)(
  "resolves an HTTP internal API origin for the %s tier",
  async (deploymentEnvironment) => {
    const { resolveInternalApiRuntimeConfig } = await loadServerConfigModule();

    expect(
      resolveInternalApiRuntimeConfig({
        environment: {
          FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
          FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://api:3002",
        },
      }),
    ).toEqual({ schemaVersion: 1, origin: "http://api:3002" });
  },
);

test.each(["https://api.example.invalid", "http://other-api:3002"] as const)(
  "rejects a non-preview internal API origin in preview: %s",
  async (internalApiOrigin) => {
    const { resolveInternalApiRuntimeConfig } = await loadServerConfigModule();

    expectInvalidConfig(
      () =>
        resolveInternalApiRuntimeConfig({
          environment: {
            FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
            FAN_SUPPORT_INTERNAL_API_ORIGIN: internalApiOrigin,
          },
        }),
      ["internalApiOrigin"],
    );
  },
);

test("requires HTTPS for staging and production internal API origins", async () => {
  const { resolveInternalApiRuntimeConfig } = await loadServerConfigModule();

  for (const deploymentEnvironment of ["staging", "production"] as const) {
    expectInvalidConfig(
      () =>
        resolveInternalApiRuntimeConfig({
          environment: {
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
            FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://api:3002",
          },
        }),
      ["internalApiOrigin"],
    );
    expect(
      resolveInternalApiRuntimeConfig({
        environment: {
          FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
          FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://api.example.invalid",
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      origin: "https://api.example.invalid",
    });
  }
});

test("fails closed for a missing or ambiguous internal API origin", async () => {
  const { resolveInternalApiRuntimeConfig } = await loadServerConfigModule();

  for (const origin of [
    undefined,
    "http://user:password@api:3002",
    "http://api:3002/path",
    "http://api:3002?query=yes",
    "http://api:3002#fragment",
    "http://api:3002\\confused",
  ]) {
    expectInvalidConfig(
      () =>
        resolveInternalApiRuntimeConfig({
          environment: {
            FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
            ...(origin === undefined
              ? {}
              : { FAN_SUPPORT_INTERNAL_API_ORIGIN: origin }),
          },
        }),
      ["internalApiOrigin"],
    );
  }
});

test("projects only an own data site origin without invoking accessors", async () => {
  const { toPublicRuntimeConfig } = await loadServerConfigModule();
  const canary = "PUBLIC_PROJECTOR_GETTER_SECRET_75319";
  let invoked = false;
  const accessorConfig = Object.defineProperty(
    {
      schemaVersion: 1,
      nodeEnvironment: "production",
      deploymentEnvironment: "production",
    },
    "siteOrigin",
    {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error(canary);
      },
    },
  ) as ServerRuntimeConfig;
  const inheritedConfig = Object.assign(
    Object.create({ siteOrigin: "https://shop.example.invalid" }) as object,
    {
      schemaVersion: 1,
      nodeEnvironment: "production",
      deploymentEnvironment: "production",
    },
  ) as ServerRuntimeConfig;
  const revokedConfig = Proxy.revocable(
    {
      schemaVersion: 1 as const,
      nodeEnvironment: "production" as const,
      deploymentEnvironment: "production" as const,
      siteOrigin: "https://shop.example.invalid",
    },
    {},
  );
  revokedConfig.revoke();

  for (const config of [accessorConfig, inheritedConfig, revokedConfig.proxy]) {
    const error = captureError(() => toPublicRuntimeConfig(config));

    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.fields).toEqual(["siteOrigin"]);
    for (const rendering of [
      error.message,
      String(error),
      JSON.stringify(error),
      inspect(error),
      error.stack ?? "",
    ]) {
      expect(rendering).not.toContain(canary);
    }
  }
  expect(invoked).toBe(false);
});
