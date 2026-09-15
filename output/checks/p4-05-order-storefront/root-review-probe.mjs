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
let reads = 0,
  grants = 0,
  revokes = 0;
const factory = () => ({
  async read() {
    reads++;
    return { schemaVersion: 1, outcome: "SUCCESS", action: "READ", order };
  },
  async exchange() {
    grants++;
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
    revokes++;
    return { schemaVersion: 1, outcome: "UNKNOWN" };
  },
  dispose() {},
});
assert.equal(
  contracts.publicOrderIdSchema.parse(id.toUpperCase()),
  id.toUpperCase(),
);
const uppercaseRead = createOrderController(factory);
await uppercaseRead.read(id.toUpperCase());
assert.equal(uppercaseRead.snapshot().order, null);
assert.equal(uppercaseRead.snapshot().error, "TEMPORARY_UNAVAILABLE");
const uppercaseExchange = createOrderController(factory);
await uppercaseExchange.exchange({
  publicOrderId: id.toUpperCase(),
  token: "A".repeat(43),
});
assert.equal(uppercaseExchange.snapshot().error, "ACCESS_DENIED");
assert.equal(grants, 1);
const revoke = createOrderController(factory);
await revoke.read(id);
await revoke.revoke();
assert.equal(revoke.snapshot().order, null);
await revoke.retry();
assert.equal(revoke.snapshot().order.publicOrderId, id);
assert.equal(revokes, 1);
const result = {
  status: "DEFECTS_REPRODUCED",
  controllerSha256: createHash("sha256").update(source).digest("hex"),
  uppercaseRead:
    "Valid schema input and authorized READ incorrectly produce TEMPORARY_UNAVAILABLE",
  uppercaseExchange:
    "Valid schema hint and successful grant incorrectly produce ACCESS_DENIED",
  failedRevokeRetry:
    "One revoke only; retry restores order with a READ instead of completing revocation",
  readCalls: reads,
  grantCalls: grants,
  revokeCalls: revokes,
};
writeFileSync(
  "output/checks/p4-05-order-storefront/root-review-probe.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(result);
