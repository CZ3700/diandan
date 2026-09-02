import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

test("the root entry point exposes only browser-safe config APIs", async () => {
  const configModule = await import("./index.js");

  expect(Object.keys(configModule).sort()).toEqual([
    "parsePublicRuntimeConfig",
    "publicRuntimeConfigSchema",
  ]);
});

test("separates browser and server package entry points", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    exports?: Record<string, unknown>;
  };

  expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([
    ".",
    "./public",
    "./server",
  ]);
  expect(manifest.dependencies).toEqual({ zod: "4.5.4" });
});
