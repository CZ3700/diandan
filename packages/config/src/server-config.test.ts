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

type ObjectStorageRuntimeConfig = Readonly<{
  schemaVersion: 1;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
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
  FAN_SUPPORT_DEPLOYMENT_ENV: "production",
  FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "fan-support-media",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
  FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
  FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
    "TEST_OBJECT_STORAGE_SECRET_VALUE",
  FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
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
  const { resolveObjectStorageRuntimeConfig } =
    await loadServerConfigModule();
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
    endpoint: "https://objects.example.invalid",
    bucket: "fan-support-media",
    region: "us-east-1",
    accessKeyId: "TEST_ACCESS_KEY_ID",
    secretAccessKey: "TEST_OBJECT_STORAGE_SECRET_VALUE",
    forcePathStyle: false,
  });
  expect(Object.isFrozen(objectStorageConfig)).toBe(true);
});

test("applies config precedence to every object-storage field", async () => {
  const { resolveObjectStorageRuntimeConfig } =
    await loadServerConfigModule();

  const config = resolveObjectStorageRuntimeConfig({
    defaults: {
      ...objectStorageEnvironment,
      FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "defaults-bucket",
      FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "false",
    },
    configFile: {
      FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "file-bucket",
    },
    dotenv: {
      FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "dotenv-bucket",
      FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
    },
    environment: {
      FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "environment-bucket",
    },
  });

  expect(config.bucket).toBe("environment-bucket");
  expect(config.forcePathStyle).toBe(true);
});

test("fails closed when object-storage configuration is missing", async () => {
  const { resolveObjectStorageRuntimeConfig } =
    await loadServerConfigModule();

  expectInvalidConfig(
    () => resolveObjectStorageRuntimeConfig({ environment: {} }),
    [
      "deploymentEnvironment",
      "objectStorageAccessKeyId",
      "objectStorageBucket",
      "objectStorageEndpoint",
      "objectStorageForcePathStyle",
      "objectStorageRegion",
      "objectStorageSecretAccessKey",
    ],
  );
});

test("allows an HTTP object-storage endpoint only in development and test", async () => {
  const { resolveObjectStorageRuntimeConfig } =
    await loadServerConfigModule();

  for (const deploymentEnvironment of ["development", "test"] as const) {
    expect(() =>
      resolveObjectStorageRuntimeConfig({
        environment: {
          ...objectStorageEnvironment,
          FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
          FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "http://object-storage:9000",
          FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
        },
      }),
    ).not.toThrow();
  }

  for (const deploymentEnvironment of [
    "preview",
    "staging",
    "production",
  ] as const) {
    expectInvalidConfig(
      () =>
        resolveObjectStorageRuntimeConfig({
          environment: {
            ...objectStorageEnvironment,
            FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
            FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT:
              "http://objects.example.invalid",
          },
        }),
      ["objectStorageEndpoint"],
    );
  }
});

test.each([
  { FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "file:///tmp/objects" },
  {
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT:
      "https://user:password@objects.example.invalid",
  },
  {
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT:
      "https://objects.example.invalid/path",
  },
  { FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "UPPERCASE_BUCKET" },
  { FAN_SUPPORT_OBJECT_STORAGE_BUCKET: "192.0.2.1" },
  { FAN_SUPPORT_OBJECT_STORAGE_REGION: "region with spaces" },
  { FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "  " },
  { FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "short" },
  { FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "yes" },
])("rejects invalid object-storage config %#", async (override) => {
  const { resolveObjectStorageRuntimeConfig } =
    await loadServerConfigModule();

  expect(() =>
    resolveObjectStorageRuntimeConfig({
      environment: { ...objectStorageEnvironment, ...override },
    }),
  ).toThrowError(/Runtime configuration is invalid/u);
});

test("does not leak rejected object-storage credentials", async () => {
  const { resolveObjectStorageRuntimeConfig } =
    await loadServerConfigModule();
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
            FAN_SUPPORT_SITE_ORIGIN: "https://shop.example.invalid",
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
