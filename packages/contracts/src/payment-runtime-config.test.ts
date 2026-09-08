import { expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./locale.js";

const load = () => import("./payment-runtime-config.js").catch(() => null);
it("bounds worker results to a schema-versioned safe progress result", async () => {
  const schemas = await load();
  expect(
    schemas?.paymentRuntimeRecoveryRunResponseSchema?.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: true,
    }).success,
  ).toBe(true);
  expect(
    schemas?.paymentRuntimeRecoveryRunResponseSchema?.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: true,
      providerResponse: "private",
    }).success,
  ).toBe(false);
});
const binding = {
  schemaVersion: 1,
  providerAccountId: "10000000-0000-4000-8000-000000000001",
  providerCode: "fake-test",
  environment: "TEST",
  allowedActionOrigins: ["https://payments.example.test"],
  localeMapping: Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      { providerLocale: locale, fallbackUsed: false },
    ]),
  ),
};
it("requires an explicit locale mapping for every public language without coupling market or currency", async () => {
  const schemas = await load();
  expect(
    schemas?.paymentRuntimeProviderBindingSchema.safeParse(binding).success,
  ).toBe(true);
  const missing = structuredClone(binding);
  Reflect.deleteProperty(missing.localeMapping, "th");
  expect(
    schemas?.paymentRuntimeProviderBindingSchema.safeParse(missing).success,
  ).toBe(false);
  expect(
    schemas?.paymentRuntimeProviderBindingSchema.safeParse({
      ...binding,
      country: "US",
    }).success,
  ).toBe(false);
});
it("uses an exact configured public HTTPS origin and bounded recovery settings", async () => {
  const schemas = await load();
  const configuration = {
    schemaVersion: 1,
    publicStorefrontOrigin: "https://storefront.example.test",
    leaseMs: 30000,
    recoveryDelayMs: 10000,
    actionTtlMs: 900000,
    returnStateTtlMs: 3600000,
    recoveryBatchSize: 10,
  };
  expect(
    schemas?.paymentRuntimeConfigurationSchema.safeParse(configuration).success,
  ).toBe(true);
  for (const extra of [
    { publicStorefrontOrigin: "http://localhost:3000" },
    {
      publicStorefrontOrigin:
        "https://storefront.example.test/callback?next=evil",
    },
    { leaseMs: 0 },
    { recoveryBatchSize: 10000 },
  ])
    expect(
      schemas?.paymentRuntimeConfigurationSchema.safeParse({
        ...configuration,
        ...extra,
      }).success,
    ).toBe(false);
});
