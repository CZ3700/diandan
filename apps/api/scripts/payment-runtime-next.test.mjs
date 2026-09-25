import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveServerRuntimeConfig,
  resolveInternalApiRuntimeConfig,
} from "@fan-support/config/server";
import { paymentNextEnvironment } from "./payment-runtime-next.mjs";
test("compiled payment Next uses the existing TEST runtime tier without weakening production config", () => {
  const environment = paymentNextEnvironment(
    {
      origin: "https://storefront.example.invalid:7443",
      apiOrigin: "http://127.0.0.1:3444",
      mediaOrigin: "https://media.example.invalid:7444",
      pspOrigin: "https://payments.example.invalid:7445",
    },
    { FAN_SUPPORT_SITE_ORIGIN: "https://unapproved.example.invalid" },
  );
  assert.equal(
    resolveServerRuntimeConfig({ environment }).deploymentEnvironment,
    "test",
  );
  assert.equal(
    resolveServerRuntimeConfig({ environment }).nodeEnvironment,
    "test",
  );
  assert.equal(
    resolveInternalApiRuntimeConfig({ environment }).origin,
    "http://127.0.0.1:3444",
  );
  assert.equal(
    environment.FAN_SUPPORT_SITE_ORIGIN,
    "https://storefront.example.invalid:7443",
  );
  assert.deepEqual(
    JSON.parse(environment.FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON),
    ["https://payments.example.invalid:7445"],
  );
});
