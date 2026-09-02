import { expect, test } from "vitest";

type PublicRuntimeConfig = Readonly<{
  schemaVersion: 1;
  siteOrigin: string;
}>;

type PublicConfigModule = Readonly<{
  parsePublicRuntimeConfig: (input: unknown) => PublicRuntimeConfig;
}>;

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
