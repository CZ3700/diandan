import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";

const load = () =>
  import("./payment-runtime-config-fixture.mjs").catch(() => null);
function input() {
  return {
    client: {
      query: () => {
        throw new Error("Database must not be touched for invalid TEST input");
      },
    },
    identity: { identities: { identities: { manager: randomUUID() } } },
    bindings: [
      {
        schemaVersion: 1,
        providerAccountId: randomUUID(),
        providerCode: "fake",
        environment: "TEST",
        localeMapping: Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [
            locale,
            { providerLocale: locale, fallbackUsed: false },
          ]),
        ),
        allowedActionOrigins: ["https://payments.example.test"],
      },
    ],
    configuration: {
      schemaVersion: 1,
      publicStorefrontOrigin: "https://store.example.test",
      leaseMs: 30000,
      recoveryDelayMs: 10000,
      actionTtlMs: 300000,
      returnStateTtlMs: 3600000,
      recoveryBatchSize: 10,
    },
    scope: { country: "US", market: "TEST", currency: "USD" },
    check: assert.ok,
  };
}
test("payment seed requires an explicit TEST-only deployment before any SQL", async () => {
  const module = await load();
  assert.equal(typeof module?.seedPaymentRuntimeConfiguration, "function");
  const value = input();
  value.bindings[0].environment = "LIVE";
  await assert.rejects(
    () => module.seedPaymentRuntimeConfiguration(value),
    /TEST/u,
  );
});
test("payment seed cannot infer a missing country from its market", async () => {
  const module = await load();
  assert.equal(typeof module?.seedPaymentRuntimeConfiguration, "function");
  const value = input();
  delete value.scope.country;
  await assert.rejects(() => module.seedPaymentRuntimeConfiguration(value));
});
