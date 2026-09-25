import { expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const environment = vi.hoisted(() => ({ tier: "test" }));
const load = vi.hoisted(() => vi.fn(async () => ({ loading: "Loading" })));
vi.mock("./runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({
    deploymentEnvironment: environment.tier,
  }),
}));
vi.mock("@fan-support/i18n/storefront", () => ({ loadStorefrontCopy: load }));

test("server copy requires human approval in production and preserves local fixture access", async () => {
  const loaded = await import("./storefront-copy.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  for (const tier of [
    "development",
    "test",
    "preview",
    "staging",
    "production",
  ]) {
    environment.tier = tier;
    await loaded.loadStorefrontCopy("ja");
    expect(load).toHaveBeenLastCalledWith("ja", {
      requireApproved: tier === "production",
    });
  }
});
