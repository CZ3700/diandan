import { expect, test } from "vitest";

type HealthResponse = Readonly<{
  schemaVersion: 1;
  service: "storefront";
  status: "ok";
}>;

type HealthModule = Readonly<{
  storefrontHealth: HealthResponse;
}>;

async function loadHealthModule(): Promise<HealthModule> {
  let loaded: unknown;
  try {
    loaded = await import("./health.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "storefront health module must exist").toBeDefined();
  return loaded as HealthModule;
}

test("exposes a frozen, serializable storefront health response", async () => {
  const { storefrontHealth } = await loadHealthModule();

  expect(storefrontHealth).toEqual({
    schemaVersion: 1,
    service: "storefront",
    status: "ok",
  });
  expect(Object.isFrozen(storefrontHealth)).toBe(true);
  expect(JSON.parse(JSON.stringify(storefrontHealth))).toEqual(
    storefrontHealth,
  );
});
