import assert from "node:assert/strict";
import test from "node:test";
import { summarizeGiftReadWindow } from "./storefront-gift-read-verification.mjs";

const prefix = "STOREFRONT_TEST_FETCH_DIAGNOSTIC ";
function request(target, requestSequence = 1, offset = 0, status = 200) {
  return ["CREATE", "HEADERS", "COMPLETE"].map((stage, index) => ({
    schemaVersion: 1,
    observedAt: "2026-09-17T00:00:00.000Z",
    sequence: offset + index + 1,
    requestSequence,
    target,
    stage,
    durationMs: index,
    ...(stage === "HEADERS" ? { status } : {}),
  }));
}
const log = (records) =>
  records.map((record) => prefix + JSON.stringify(record)).join("\n") + "\n";

test("counts complete native requests within an explicit sequence window, preserving HTTP failures", () => {
  const input = log([
    ...request("GIFT_CONTENT"),
    ...request("STOREFRONT_GIFT", 2, 3, 503),
  ]);
  assert.deepEqual(summarizeGiftReadWindow(input, 0).counts, {
    GIFT_CONTENT: 1,
    STOREFRONT_GIFT: 1,
  });
  const window = summarizeGiftReadWindow(input, 3);
  assert.deepEqual(window.counts, { GIFT_CONTENT: 0, STOREFRONT_GIFT: 1 });
  assert.equal(window.requests[0].status, 503);
  assert.equal(window.lastSequence, 6);
});

test("reconstructs native emission order when asynchronous log appends persist COMPLETE before HEADERS", () => {
  const emitted = [
    ...request("GIFT_CONTENT"),
    ...request("STOREFRONT_GIFT", 2, 3),
    ...request("GIFT_CONTENT", 3, 6),
    ...request("STOREFRONT_GIFT", 4, 9),
  ];
  const persisted = [...emitted.slice(0, 10), emitted[11], emitted[10]];
  const summary = summarizeGiftReadWindow(log(persisted), 6);
  assert.deepEqual(summary.counts, { GIFT_CONTENT: 1, STOREFRONT_GIFT: 1 });
  assert.deepEqual(
    summary.records.map(({ sequence }) => sequence),
    [7, 8, 9, 10, 11, 12],
  );
  assert.equal(summary.lastSequence, 12);
  assert.deepEqual(
    summary.requests.map(({ status }) => status),
    [200, 200],
  );
});

test("missing sequence numbers remain invalid even when surviving request groups are complete", () => {
  assert.throws(() =>
    summarizeGiftReadWindow(log(request("GIFT_CONTENT", 1, 3)), 0),
  );
  assert.throws(() =>
    summarizeGiftReadWindow(
      log([...request("GIFT_CONTENT"), ...request("STOREFRONT_GIFT", 2, 6)]),
      3,
    ),
  );
});

test("rejects incomplete, failed, truncated, malformed and mismatched native evidence", () => {
  for (const records of [
    request("GIFT_CONTENT").slice(0, 2),
    [
      ...request("GIFT_CONTENT").slice(0, 2),
      { ...request("GIFT_CONTENT")[2], stage: "ERROR" },
    ],
    [{ schemaVersion: 1, sequence: 1, stage: "TRUNCATED" }],
    request("GIFT_CONTENT").map((record, index) =>
      index === 2 ? { ...record, target: "STOREFRONT_GIFT" } : record,
    ),
    [request("GIFT_CONTENT")[0], ...request("GIFT_CONTENT")],
  ])
    assert.throws(() => summarizeGiftReadWindow(log(records), 0));
  assert.throws(() => summarizeGiftReadWindow(prefix + "not-json\n", 0));
});
