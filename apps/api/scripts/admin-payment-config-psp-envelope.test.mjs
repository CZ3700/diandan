import assert from "node:assert/strict";
import test from "node:test";
const module = await import("./admin-payment-config-psp-envelope.mjs").catch(
  () => null,
);
const account = "71000000-0000-4000-8000-000000000001";
const command = {
  schemaVersion: 1,
  operation: "GET_CAPABILITIES",
  providerAccountId: account,
  environment: "TEST",
  market: "GLOBAL",
  country: "US",
  currency: "USD",
  amountMinor: 100,
  requestedLocale: "en",
  supportedActionTypes: ["REDIRECT"],
};
const instrument = {
  kind: "CARD",
  paymentMethod: "fake_card",
  brands: ["VISA", "MASTERCARD"],
  authentication: "PSP_MANAGED_3DS",
  capture: "AUTOMATIC",
};
const settings = {
  providerAccountId: account,
  merchantAccount: "owned-test-merchant",
  instruments: [instrument],
};
const body = {
  schemaVersion: 1,
  protocol: "fan-support-gateway-v1",
  merchantAccount: settings.merchantAccount,
  command,
  instruments: [instrument],
};
test("owned normalized TEST PSP envelope is bound to the exact merchant, account and deployed instrument", () => {
  assert.equal(typeof module?.readTestNormalizedPaymentCommand, "function");
  assert.deepEqual(
    module.readTestNormalizedPaymentCommand(body, {}, settings),
    command,
  );
  for (const changed of [
    { merchantAccount: "other" },
    { command: { ...command, environment: "LIVE" } },
    {
      command: {
        ...command,
        providerAccountId: "71000000-0000-4000-8000-000000000002",
      },
    },
    { instruments: [{ ...instrument, kind: "STABLECOIN" }] },
    { protocol: "unknown" },
    { secret: "forbidden" },
  ])
    assert.throws(() =>
      module.readTestNormalizedPaymentCommand(
        { ...body, ...changed },
        {},
        settings,
      ),
    );
});
