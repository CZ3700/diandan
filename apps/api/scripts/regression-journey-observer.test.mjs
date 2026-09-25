import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { observeLocalBrowserPayment } from "./local-experience-browser-payment-observer.mjs";
import { readCurrentPurchase } from "./regression-journey-browser.mjs";

const origin = "https://storefront.example.invalid:7443";
const id = "10000000-0000-4000-8000-000000000001";
const body = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "READ",
  attempt: {
    schemaVersion: 1,
    id,
    checkoutSessionId: id,
    version: 1,
    environment: "TEST",
    status: "SUCCEEDED",
    requestedLocale: "en",
    providerLocale: "en",
    providerLocaleFallbackUsed: false,
    recovery: "NONE",
    canRetry: false,
    actionExpired: false,
    updatedAt: "2026-09-09T00:00:00.000Z",
  },
};
async function observe({
  stage = "en-390-RETURN",
  status = 200,
  payload = body,
  readBodyForStage,
  unavailable = false,
} = {}) {
  const page = new EventEmitter();
  const report = {
    stage,
    paymentCreates: [],
    paymentReads: [],
    observations: [],
  };
  let bodyReads = 0;
  const observer = observeLocalBrowserPayment({
    page,
    config: { origins: { storefront: origin } },
    report,
    readBodyForStage,
  });
  page.emit("response", {
    url: () =>
      `${origin}/api/storefront/checkout/sessions/${id}/attempts/${id}`,
    request: () => ({ method: () => "GET" }),
    status: () => status,
    json: async () => {
      bodyReads++;
      if (unavailable) throw new Error("private response context");
      return payload;
    },
  });
  await observer.settled();
  observer.dispose();
  return { report, bodyReads };
}
test("default payment observation still reads and validates every response body", async () => {
  const valid = await observe({ stage: "en-390-JOURNEY" });
  assert.equal(valid.bodyReads, 1);
  assert.equal(valid.report.paymentReads.length, 1);
  assert.deepEqual(valid.report.observations, []);
  const missing = await observe({ unavailable: true });
  assert.deepEqual(missing.report.observations, [
    { code: "PAYMENT_READ_UNAVAILABLE", stage: "en-390-RETURN" },
  ]);
});
test("the explicit canonical current read rejects unsuccessful HTTP before trusting a body", async () => {
  await assert.rejects(
    readCurrentPurchase({
      evaluate: async () => ({ status: 503, body: { outcome: "SUCCESS" } }),
    }),
    /successful HTTP/u,
  );
});
test("explicit stage scope skips only body retrieval and always rejects non-200 HTTP", async () => {
  const readBodyForStage = (stage) => stage.endsWith("-RETURN");
  const skipped = await observe({
    stage: "en-390-JOURNEY",
    unavailable: true,
    readBodyForStage,
  });
  assert.equal(skipped.bodyReads, 0);
  assert.deepEqual(skipped.report.observations, []);
  const failed = await observe({
    stage: "en-390-JOURNEY",
    status: 503,
    readBodyForStage,
  });
  assert.deepEqual(failed.report.observations, [
    { code: "PAYMENT_READ_CONTRACT_FAILED", stage: "en-390-JOURNEY" },
  ]);
});
test("RETURN scope retains full contract validation and unavailable-body failure", async () => {
  const readBodyForStage = (stage) => stage.endsWith("-RETURN");
  for (const options of [{ payload: {} }, { unavailable: true }]) {
    const result = await observe({ ...options, readBodyForStage });
    assert.equal(result.bodyReads, 1);
    assert.equal(result.report.paymentReads.length, 0);
    assert.equal(result.report.observations.length, 1);
    assert.equal(
      JSON.stringify(result.report).includes("private response context"),
      false,
    );
  }
});
