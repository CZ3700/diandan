import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { seedPaymentRuntimeConfiguration } from "./payment-runtime-config-fixture.mjs";
import { createLocalPaymentBinding } from "./local-experience-payment-profile.mjs";

test("sandbox publication seeds the selected card method under normal TEST constraints", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: sql.includes("max(version)") ? [{ version: 1 }] : [] };
    },
  };
  await seedPaymentRuntimeConfiguration({
    client,
    identity: { identities: { identities: { manager: randomUUID() } } },
    bindings: [
      createLocalPaymentBinding("stripe-test", randomUUID(), {
        psp: "https://payments.example.invalid:9000",
      }),
    ],
    paymentMethod: "card",
    credentialRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_API",
    configuration: {
      schemaVersion: 1,
      publicStorefrontOrigin: "https://storefront.example.invalid:9001",
      leaseMs: 30000,
      recoveryDelayMs: 10000,
      actionTtlMs: 300000,
      returnStateTtlMs: 3600000,
      recoveryBatchSize: 10,
    },
    scope: { country: "US", market: "GLOBAL", currency: "USD" },
    check: assert.ok,
  });
  const route = calls.find(({ sql }) =>
    sql.startsWith("INSERT INTO payment_route_rules("),
  );
  assert.ok(
    route.values.includes("card"),
    "selected method is bound in route SQL",
  );
  assert.ok(
    !route.sql.includes("'fake_card'"),
    "Stripe route cannot silently seed fake method",
  );
  const account = calls.find(({ sql }) =>
    sql.startsWith("INSERT INTO payment_provider_accounts("),
  );
  assert.equal(
    account.values[4],
    "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_API",
  );
});
