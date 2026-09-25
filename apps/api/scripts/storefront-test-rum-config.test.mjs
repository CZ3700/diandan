import assert from "node:assert/strict";
import { test } from "node:test";

async function configure(environment, enabled) {
  const module = await import("./storefront-test-rum-config.mjs").catch(
    () => ({}),
  );
  assert.equal(
    typeof module.storefrontTestRumEnvironment,
    "function",
    "explicit TEST-only RUM configuration must exist",
  );
  return module.storefrontTestRumEnvironment(environment, enabled);
}

test("default fixture configuration does not enable RUM or change its environment", async () => {
  const environment = {
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    EXISTING: "retained",
  };
  assert.equal(await configure(environment, false), environment);
});

test("explicit local RUM is confined to the owned TEST runtime and uses full sampling", async () => {
  const environment = {
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    EXISTING: "retained",
  };
  assert.deepEqual(await configure(environment, true), {
    ...environment,
    FAN_SUPPORT_RUM_MODE: "local",
    FAN_SUPPORT_RUM_SAMPLE_PERMILLE: "1000",
  });
  assert.equal(environment.FAN_SUPPORT_RUM_MODE, undefined);
});

test("RUM fixture injection cannot target production, preview, or missing environment", async () => {
  for (const stage of ["production", "preview", "development", undefined]) {
    await assert.rejects(
      () => configure({ FAN_SUPPORT_DEPLOYMENT_ENV: stage }, true),
      /owned TEST/,
    );
  }
  await assert.rejects(
    () => configure({ FAN_SUPPORT_DEPLOYMENT_ENV: "test" }, "true"),
    /boolean/,
  );
});
