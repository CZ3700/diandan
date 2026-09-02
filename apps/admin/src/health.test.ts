import { expect, test } from "vitest";

type HealthResponse = Readonly<{
  schemaVersion: 1;
  service: "admin";
  status: "ok";
}>;

type HealthModule = Readonly<{
  adminHealth: HealthResponse;
}>;

async function loadHealthModule(): Promise<HealthModule> {
  let loaded: unknown;
  try {
    loaded = await import("./health.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "admin health module must exist").toBeDefined();
  return loaded as HealthModule;
}

test("exposes a frozen, serializable admin health response", async () => {
  const { adminHealth } = await loadHealthModule();

  expect(adminHealth).toEqual({
    schemaVersion: 1,
    service: "admin",
    status: "ok",
  });
  expect(Object.isFrozen(adminHealth)).toBe(true);
  expect(JSON.parse(JSON.stringify(adminHealth))).toEqual(adminHealth);
});
