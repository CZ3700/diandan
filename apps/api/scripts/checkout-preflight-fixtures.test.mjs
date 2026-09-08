import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createCartHttpTestKms } from "./cart-http-kms.mjs";
import { seedCheckoutFulfillmentProfiles } from "./checkout-preflight-fixtures.mjs";

test("TEST encrypted fulfillment initialization uses the actual nested staff identity and no plaintext SQL parameters", async () => {
  const manager = randomUUID();
  const kms = createCartHttpTestKms();
  let writes = 0;
  try {
    const result = await seedCheckoutFulfillmentProfiles({
      client: {
        async query(sql, values) {
          writes++;
          assert.ok(sql.startsWith("insert into idol_fulfillment_profiles"));
          assert.equal(values[5], manager);
          assert.ok(values[2] instanceof Uint8Array && values[2].length > 32);
          assert.ok(values[3] instanceof Uint8Array && values[3].length > 32);
          assert.ok(
            !values.some(
              (value) =>
                typeof value === "string" &&
                value.includes("SYNTHETIC_TEST_STUDIO"),
            ),
          );
        },
      },
      kms,
      fixtures: { artists: [{ id: randomUUID() }] },
      identity: { identities: { identities: { manager } } },
      check: assert.ok,
    });
    assert.equal(writes, 1);
    assert.equal(result.count, 1);
    assert.equal(result.testOnly, true);
  } finally {
    kms.close();
  }
});

test("failed KMS preparation never seeds a profile with invented ciphertext", async () => {
  let writes = 0;
  await assert.rejects(
    seedCheckoutFulfillmentProfiles({
      client: {
        async query() {
          writes++;
        },
      },
      kms: {
        adapter: {
          async encryptEnvelope() {
            return { outcome: "FAILURE" };
          },
        },
      },
      fixtures: { artists: [{ id: randomUUID() }] },
      identity: { identities: { identities: { manager: randomUUID() } } },
      check: assert.ok,
    }),
  );
  assert.equal(writes, 0);
});
