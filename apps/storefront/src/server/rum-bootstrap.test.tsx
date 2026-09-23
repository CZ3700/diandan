import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock("../storefront/rum-collector", () => {
  loaded.count++;
  return { RumCollector: () => null };
});
test("unapproved and sensitive documents render no client collector reference", async () => {
  const implementation = await import("./rum-bootstrap").catch(() => undefined);
  expect(
    implementation,
    "root RUM bootstrap must be gated before importing client code",
  ).toBeDefined();
  if (!implementation) return;
  expect(await implementation.renderRumCollector("en", false, {})).toBeNull();
  expect(
    await implementation.renderRumCollector("en", true, {
      FAN_SUPPORT_RUM_MODE: "local",
      FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    }),
  ).toBeNull();
  expect(loaded.count).toBe(0);
  expect(
    await implementation.renderRumCollector("en", false, {
      FAN_SUPPORT_RUM_MODE: "local",
      FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    }),
  ).not.toBeNull();
  expect(loaded.count).toBe(1);
});
