import assert from "node:assert/strict";
import test from "node:test";
import * as protocol from "./order-payment-protocol.mjs";

function fixture() {
  const signed = Object.freeze({
    rawBody: "synthetic-signed-event",
    headers: {},
  });
  const facts = { captures: 1, confirmations: 1, committed: 1, decrements: 1 };
  const received = [];
  let inFlight = 0;
  return {
    signed,
    received,
    facts,
    async sendWebhook(value) {
      assert.equal(inFlight++, 0, "Retries must be sequential HTTP calls");
      assert.equal(
        value,
        signed,
        "Every retry must reuse the exact signed event",
      );
      await Promise.resolve();
      received.push(value);
      inFlight--;
      return { accepted: true };
    },
    async readEffects() {
      return { ...facts };
    },
    async maintenance() {},
    check: (value, label) => assert.ok(value, label),
  };
}

test("the duplicate-webhook gate sends ten sequential copies and verifies stable effects", async () => {
  assert.equal(typeof protocol.verifyOrderWebhookReplays, "function");
  const context = fixture();
  const report = await protocol.verifyOrderWebhookReplays(context);
  assert.equal(context.received.length, 10);
  assert.deepEqual(report, {
    sequentialHttpReplays: 10,
    effectsUnchanged: true,
  });
});

test("the duplicate-webhook gate rejects a repeated economic or notification effect", async () => {
  assert.equal(typeof protocol.verifyOrderWebhookReplays, "function");
  for (const key of ["captures", "confirmations", "committed", "decrements"]) {
    const context = fixture();
    context.maintenance = async () => {
      context.facts[key]++;
    };
    await assert.rejects(
      protocol.verifyOrderWebhookReplays(context),
      /effects/iu,
    );
  }
});

test("the duplicate-webhook gate rejects a failed acknowledgement", async () => {
  assert.equal(typeof protocol.verifyOrderWebhookReplays, "function");
  const context = fixture();
  context.sendWebhook = async () => ({ accepted: false });
  await assert.rejects(
    protocol.verifyOrderWebhookReplays(context),
    /acknowledged/iu,
  );
});
