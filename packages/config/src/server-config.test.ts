import { inspect } from "node:util";

import { expect, test } from "vitest";

type ConfigSource = Readonly<Record<string, unknown>>;
type RuntimeConfigSources = Readonly<{
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

type PublicRuntimeConfig = Readonly<{
  schemaVersion: 1;
  siteOrigin: string;
}>;

type ServerConfigModule = Readonly<{
  resolveServerRuntimeConfig: (
    sources: RuntimeConfigSources,
  ) => ServerRuntimeConfig;
  resolveDatabaseRuntimeConfig: (
    sources: RuntimeConfigSources,
  ) => DatabaseRuntimeConfig;
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

test("applies config file, dotenv, and environment precedence", async () => {
  const { resolveDatabaseRuntimeConfig, resolveServerRuntimeConfig } =
    await loadServerConfigModule();
  const sources = {
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

test.each(["configFile", "dotenv"] as const)(
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
