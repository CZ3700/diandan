import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("bootstrap state rejects unknown stages, missing ready prerequisites and changed identity bindings", async () => {
  const module = await import("./local-experience-bootstrap-state.mjs").catch(
    () => null,
  );
  assert.ok(module, "validated local bootstrap state is available");
  const managerId = randomUUID(),
    providerAccountId = randomUUID(),
    endpointId = randomUUID();
  const config = {
    origins: { storefront: "https://storefront.example.invalid:8443" },
    services: {
      oidc: { actors: [{ key: "manager", id: managerId }] },
      psp: { binding: { providerAccountId }, webhookEndpointId: endpointId },
    },
  };
  const value = {
    schemaVersion: 1,
    testOnly: true,
    managerId,
    stage: "IDENTITIES_READY",
    paymentConfiguration: {
      schemaVersion: 1,
      publicStorefrontOrigin: config.origins.storefront,
      leaseMs: 30000,
      recoveryDelayMs: 10000,
      actionTtlMs: 300000,
      returnStateTtlMs: 3600000,
      recoveryBatchSize: 10,
    },
  };
  assert.equal(
    module.parseLocalBusiness(value, config).stage,
    "IDENTITIES_READY",
  );
  assert.throws(() =>
    module.parseLocalBusiness({ ...value, stage: "READY" }, config),
  );
  assert.throws(() =>
    module.parseLocalBusiness({ ...value, stage: "unexpected" }, config),
  );
  assert.throws(() =>
    module.parseLocalBusiness({ ...value, managerId: randomUUID() }, config),
  );
  assert.throws(() =>
    module.parseLocalBusiness(
      {
        ...value,
        endpoint: {
          endpointId: randomUUID(),
          providerAccountId,
          verificationKeyReferenceHash: "1".repeat(64),
        },
      },
      config,
    ),
  );
});
