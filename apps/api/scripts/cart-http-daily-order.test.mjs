import assert from "node:assert/strict";
import { test } from "node:test";
import { observeImmediateDailyCartTrial } from "./cart-http-daily-order.mjs";

test("a fresh session precedes publication, and the first subsequent operation is add", async () => {
  const calls = [];
  const observed = await observeImmediateDailyCartTrial({
    initialize: async () => {
      calls.push("initialize");
      return "session";
    },
    publish: async () => {
      calls.push("publish");
      return "gift";
    },
    add: async (gift, session) => {
      calls.push("add");
      assert.equal(gift, "gift");
      assert.equal(session, "session");
      return "response";
    },
    diagnose: async () => {
      calls.push("diagnose");
      return "diagnostics";
    },
  });
  assert.deepEqual(calls, ["initialize", "publish", "add", "diagnose"]);
  assert.equal(observed.result, "response");
  assert.equal(observed.error, null);
});

test("an add failure is retained after diagnostics without a hidden retry", async () => {
  const calls = [];
  const failure = new Error("test failure");
  const observed = await observeImmediateDailyCartTrial({
    initialize: async () => "session",
    publish: async () => "gift",
    add: async () => {
      calls.push("add");
      throw failure;
    },
    diagnose: async () => {
      calls.push("diagnose");
      return { outcome: "SUCCESS" };
    },
  });
  assert.deepEqual(calls, ["add", "diagnose"]);
  assert.equal(observed.error, failure);
  assert.equal(observed.result, null);
  assert.deepEqual(observed.diagnostics, { outcome: "SUCCESS" });
});
