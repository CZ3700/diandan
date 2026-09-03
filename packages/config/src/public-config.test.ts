import { inspect } from "node:util";

import { expect, test } from "vitest";

type PublicRuntimeConfig = Readonly<{
  schemaVersion: 1;
  siteOrigin: string;
}>;

type PublicConfigModule = Readonly<{
  parsePublicRuntimeConfig: (input: unknown) => PublicRuntimeConfig;
  publicRuntimeConfigSchema: Readonly<{
    parse: (input: unknown) => PublicRuntimeConfig;
  }>;
}>;

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error("expected action to throw");
}

async function loadPublicConfigModule(): Promise<PublicConfigModule> {
  let loaded: unknown;

  try {
    loaded = await import("./public-config.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "public config module must exist").toBeDefined();
  return loaded as PublicConfigModule;
}

test("parses the versioned public runtime config", async () => {
  const { parsePublicRuntimeConfig } = await loadPublicConfigModule();

  expect(
    parsePublicRuntimeConfig({
      schemaVersion: 1,
      siteOrigin: "https://shop.example.invalid",
    }),
  ).toEqual({
    schemaVersion: 1,
    siteOrigin: "https://shop.example.invalid",
  });
});

test("parses a null-prototype public config object", async () => {
  const { parsePublicRuntimeConfig } = await loadPublicConfigModule();
  const input = Object.assign(Object.create(null) as object, {
    schemaVersion: 1,
    siteOrigin: "https://shop.example.invalid",
  });

  expect(parsePublicRuntimeConfig(input)).toEqual({
    schemaVersion: 1,
    siteOrigin: "https://shop.example.invalid",
  });
});

test.each([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
])("accepts a loopback HTTP public origin %s", async (siteOrigin) => {
  const { parsePublicRuntimeConfig } = await loadPublicConfigModule();

  expect(parsePublicRuntimeConfig({ schemaVersion: 1, siteOrigin })).toEqual({
    schemaVersion: 1,
    siteOrigin,
  });
});

test.each(["https://localhost:3443", "https://localhost:3444"])(
  "accepts an exact local preview HTTPS origin %s",
  async (siteOrigin) => {
    const { parsePublicRuntimeConfig } = await loadPublicConfigModule();

    expect(parsePublicRuntimeConfig({ schemaVersion: 1, siteOrigin })).toEqual({
      schemaVersion: 1,
      siteOrigin,
    });
  },
);

test("rejects extra public fields instead of stripping them", async () => {
  const { parsePublicRuntimeConfig } = await loadPublicConfigModule();

  expect(() =>
    parsePublicRuntimeConfig({
      schemaVersion: 1,
      siteOrigin: "https://shop.example.invalid",
      databaseUrl: "must-never-reach-the-browser",
    }),
  ).toThrow();
});

test.each([
  { schemaVersion: 2, siteOrigin: "https://shop.example.invalid" },
  { schemaVersion: 1, siteOrigin: "javascript:alert(1)" },
  { schemaVersion: 1, siteOrigin: "https://shop.example.invalid/path" },
  { schemaVersion: 1, siteOrigin: "https://shop.example.invalid?query=yes" },
  { schemaVersion: 1, siteOrigin: "https://shop.example.invalid#fragment" },
  { schemaVersion: 1, siteOrigin: "http://shop.example.invalid" },
])("rejects invalid public config %#", async (input) => {
  const { parsePublicRuntimeConfig } = await loadPublicConfigModule();

  expect(() => parsePublicRuntimeConfig(input)).toThrow();
});

test("rejects inherited public fields in both public APIs", async () => {
  const { parsePublicRuntimeConfig, publicRuntimeConfigSchema } =
    await loadPublicConfigModule();
  const input = Object.create({
    schemaVersion: 1,
    siteOrigin: "https://shop.example.invalid",
  });

  expect(() => parsePublicRuntimeConfig(input)).toThrow();
  expect(() => publicRuntimeConfigSchema.parse(input)).toThrow();
});

test("normalizes public accessor and revoked-proxy failures without reading values", async () => {
  const { parsePublicRuntimeConfig, publicRuntimeConfigSchema } =
    await loadPublicConfigModule();
  const canary = "PUBLIC_CONFIG_GETTER_SECRET_31975";
  let invoked = 0;
  const consumers = [
    parsePublicRuntimeConfig,
    (input: unknown) => publicRuntimeConfigSchema.parse(input),
  ];

  for (const consume of consumers) {
    const accessorInput = Object.defineProperty(
      { schemaVersion: 1 },
      "siteOrigin",
      {
        enumerable: true,
        get() {
          invoked += 1;
          throw new Error(canary);
        },
      },
    );
    const revokedInput = Proxy.revocable(
      {
        schemaVersion: 1,
        siteOrigin: "https://shop.example.invalid",
      },
      {},
    );
    revokedInput.revoke();

    for (const input of [accessorInput, revokedInput.proxy]) {
      const error = captureError(() => consume(input));

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
  }
  expect(invoked).toBe(0);
});
