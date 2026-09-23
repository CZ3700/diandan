import { expect, test } from "vitest";

test("RUM is disabled without explicit approval, and separates local from production field", async () => {
  const loaded = await import("./rum-config.js").catch(() => undefined);
  expect(
    loaded,
    "RUM must use a dedicated validated config fragment",
  ).toBeDefined();
  if (!loaded) return;
  expect(loaded.resolveRumConfig({})).toEqual({
    schemaVersion: 1,
    mode: "disabled",
    samplePermille: 1000,
  });
  expect(
    loaded.resolveRumConfig({
      configFile: { FAN_SUPPORT_RUM_MODE: "local" },
      environment: {
        FAN_SUPPORT_DEPLOYMENT_ENV: "test",
        FAN_SUPPORT_RUM_SAMPLE_PERMILLE: "250",
      },
    }),
  ).toEqual({ schemaVersion: 1, mode: "local", samplePermille: 250 });
  expect(
    loaded.resolveRumConfig({
      environment: {
        FAN_SUPPORT_RUM_MODE: "field",
        FAN_SUPPORT_DEPLOYMENT_ENV: "production",
      },
    }).mode,
  ).toBe("field");
  for (const environment of [
    { FAN_SUPPORT_RUM_MODE: "field", FAN_SUPPORT_DEPLOYMENT_ENV: "preview" },
    { FAN_SUPPORT_RUM_MODE: "SECRET" },
    { FAN_SUPPORT_RUM_SAMPLE_PERMILLE: "1.5" },
    { FAN_SUPPORT_RUM_SAMPLE_PERMILLE: "1001" },
    { FAN_SUPPORT_RUM_SAMPLE_PERMILLE: "-1" },
  ])
    expect(() => loaded.resolveRumConfig({ environment })).toThrow(
      "Invalid RUM configuration",
    );
});
