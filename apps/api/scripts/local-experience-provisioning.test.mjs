import assert from "node:assert/strict";
import { test } from "node:test";

test("synthetic fulfillment provisioning refuses non-TEST and remote databases before acquiring resources", async () => {
  const module = await import("./local-experience-provisioning.mjs").catch(
    () => null,
  );
  assert.ok(module, "TEST-only fulfillment provisioner is available");
  const input = {
    environment: "LIVE",
    database: { host: "127.0.0.1" },
    operatorId: "11111111-1111-4111-8111-111111111111",
    keyManagement: {},
  };
  assert.throws(
    () => module.createLocalTestFulfillmentProvisioner(input),
    /TEST/u,
  );
  assert.throws(
    () =>
      module.createLocalTestFulfillmentProvisioner({
        ...input,
        environment: "TEST",
        database: { host: "db.example.com" },
      }),
    /loopback/u,
  );
});
