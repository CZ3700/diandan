import { expect, test } from "vitest";
test("requires an explicit bounded storefront name without reflecting invalid configuration", async () => {
  const loaded = await import("./storefront-config.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  expect(
    loaded.resolveStorefrontConfig({
      environment: { FAN_SUPPORT_STOREFRONT_NAME: "TEST STUDIO" },
    }),
  ).toEqual({ schemaVersion: 1, name: "TEST STUDIO" });
  expect(() =>
    loaded.resolveStorefrontConfig({
      environment: { FAN_SUPPORT_STOREFRONT_NAME: "bad\nname" },
    }),
  ).toThrow("Invalid storefront configuration");
  expect(() => loaded.resolveStorefrontConfig({ environment: {} })).toThrow(
    "Invalid storefront configuration",
  );
});
