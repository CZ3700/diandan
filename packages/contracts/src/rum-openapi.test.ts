import { expect, test } from "vitest";
test("documents the actual same-origin intake with strict schema and bounded failures", async () => {
  const loaded = await import("./rum-openapi.js").catch(() => undefined);
  expect(
    loaded,
    "RUM HTTP documentation must be generated with its contract",
  ).toBeDefined();
  if (!loaded) return;
  const paths = loaded.rumPaths();
  expect(paths["/api/storefront/rum"]).toHaveProperty("post");
  const serialized = JSON.stringify(paths);
  for (const value of [
    "RumIntake",
    "Origin",
    "Sec-Fetch-Site",
    "204",
    "400",
    "403",
    "404",
    "413",
    "415",
    "429",
    "503",
  ])
    expect(serialized).toContain(value);
});
