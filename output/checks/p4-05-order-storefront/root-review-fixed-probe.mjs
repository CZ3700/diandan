import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as contracts from "../../../packages/contracts/dist/index.js";

const path = "apps/storefront/src/storefront/order-controller.ts";
const source = readFileSync(path, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
runInNewContext(output, {
  exports: module.exports,
  require(name) {
    if (name === "@fan-support/contracts") return contracts;
    if (name === "./order-transport")
      return {
        createOrderTransport() {
          throw new Error("Explicit test transport required");
        },
      };
    throw new Error(`Unexpected module: ${name}`);
  },
});
const { createOrderController } = module.exports;
const id = "a0000000-b000-4000-8000-00000000000f";
const locale = {
  schemaVersion: 1,
  mode: "APPROVED",
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
};
const media = {
  url: "https://media.example.test/review.webp",
  alt: "TEST",
  locale,
};
const order = contracts.orderAccessDetailSchema.parse({
  schemaVersion: 1,
  publicOrderId: id,
  presentationLocale: "en",
  orderStatus: "OPEN",
  paymentStatus: "PAID",
  disputeStatus: "NONE",
  fulfillmentStatus: "PENDING",
  amount: {
    schemaVersion: 1,
    currency: "USD",
    subtotalMinor: 100,
    taxAmountMinor: 0,
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
    discountAmountMinor: 0,
    totalAmountMinor: 100,
  },
  items: [
    {
      schemaVersion: 1,
      position: 1,
      idol: { handle: "test", displayName: "TEST", locale, portrait: media },
      gift: { title: "TEST", variantLabel: null, locale, image: media },
      quantity: 1,
      unitAmountMinor: 100,
      lineSubtotalMinor: 100,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      lineTotalMinor: 100,
      currency: "USD",
      displayMode: "anonymous",
      fulfillmentStatus: "PENDING",
    },
  ],
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
});
const success = { schemaVersion: 1, outcome: "SUCCESS", action: "READ", order };
const denied = { schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_DENIED" };
const revoked = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "REVOKED",
  publicOrderId: id,
};
const unknown = { schemaVersion: 1, outcome: "UNKNOWN" };
function testTransport() {
  const counts = { read: 0, exchange: 0, revoke: 0, dispose: 0 };
  const readQueue = [],
    revokeQueue = [];
  const api = {
    async read() {
      counts.read++;
      return readQueue.length ? readQueue.shift() : success;
    },
    async exchange() {
      counts.exchange++;
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "GRANTED",
        grant: {
          schemaVersion: 1,
          publicOrderId: id,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      };
    },
    async revoke() {
      counts.revoke++;
      return revokeQueue.length ? revokeQueue.shift() : revoked;
    },
    dispose() {
      counts.dispose++;
    },
  };
  return { api, counts, readQueue, revokeQueue };
}
const checks = [];
const upper = testTransport();
const uppercaseRead = createOrderController(() => upper.api);
await uppercaseRead.read(id.toUpperCase());
assert.equal(uppercaseRead.snapshot().order.publicOrderId, id);
assert.equal(uppercaseRead.snapshot().publicOrderId, id);
assert.equal(uppercaseRead.snapshot().error, null);
checks.push("uppercase authorized READ normalizes and succeeds");
const uppercaseExchange = createOrderController(() => upper.api);
await uppercaseExchange.exchange({
  publicOrderId: id.toUpperCase(),
  token: "A".repeat(43),
});
assert.equal(uppercaseExchange.snapshot().order.publicOrderId, id);
assert.equal(uppercaseExchange.snapshot().error, null);
assert.equal(upper.counts.exchange, 1);
checks.push("uppercase link hint grants once and reads original order");
await uppercaseRead.revoke();
assert.equal(uppercaseRead.snapshot().revoked, true);
checks.push("revoke accepts canonical UUID after uppercase entry");
const mismatch = createOrderController(() => testTransport().api);
await mismatch.exchange({
  publicOrderId: "b0000000-b000-4000-8000-00000000000f",
  token: "A".repeat(43),
});
assert.equal(mismatch.snapshot().error, "ACCESS_DENIED");
checks.push("different actual order scope remains denied");
for (const restore of [false, true]) {
  const test = testTransport();
  test.revokeQueue.push(unknown);
  const controller = createOrderController(() => test.api);
  await controller.read(id);
  await controller.revoke();
  const exposed = [];
  controller.subscribe(() => exposed.push(controller.snapshot().order));
  if (restore) {
    controller.suspend();
    await controller.resume();
  } else await controller.retry();
  assert.equal(controller.snapshot().revoked, true);
  assert.equal(test.counts.revoke, 2);
  assert.equal(
    exposed.every((value) => value === null),
    true,
  );
  await controller.retry();
  assert.equal(test.counts.revoke, 2);
  checks.push(
    `${restore ? "suspend/resume" : "retry"} continues uncertain revoke without intermediate order display`,
  );
}
const lostAuthority = testTransport();
lostAuthority.revokeQueue.push(unknown);
const missing = createOrderController(() => lostAuthority.api);
await missing.read(id);
await missing.revoke();
lostAuthority.readQueue.push(denied);
await missing.retry();
assert.equal(missing.snapshot().revoked, true);
assert.equal(missing.snapshot().order, null);
assert.equal(lostAuthority.counts.revoke, 1);
checks.push(
  "denied current order access ends local close recovery without resurrecting data",
);
const stale = testTransport();
let finish;
stale.revokeQueue.push(
  new Promise((resolve) => {
    finish = resolve;
  }),
);
const suspended = createOrderController(() => stale.api);
await suspended.read(id);
const pending = suspended.revoke();
suspended.suspend();
finish(revoked);
await pending;
assert.equal(suspended.snapshot().order, null);
assert.equal(suspended.snapshot().revoked, false);
await suspended.resume();
assert.equal(suspended.snapshot().revoked, true);
assert.equal(stale.counts.revoke, 2);
checks.push(
  "late revoke reply after suspension is ignored; resume completes preserved close intent",
);
const result = {
  status: "PASS",
  controllerSha256: createHash("sha256").update(source).digest("hex"),
  checks,
};
writeFileSync(
  "output/checks/p4-05-order-storefront/root-review-fixed-probe.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(result);
