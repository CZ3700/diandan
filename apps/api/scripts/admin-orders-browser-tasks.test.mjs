import assert from "node:assert/strict";
import test from "node:test";
import * as browser from "./admin-orders-browser.mjs";
const { createAdminOrdersBrowserTasks } = browser;

test("route failures settle without exposing private error details", async () => {
  const failures = [];
  const tasks = createAdminOrdersBrowserTasks((failure) =>
    failures.push(failure),
  );
  const result = await tasks.run(
    async () => {
      throw new Error(
        "getaddrinfo ENOTFOUND SYNTHETIC_PRIVATE_TOKEN\n at admin-orders-browser.mjs:255:29",
      );
    },
    { stage: "private-late-response", kind: "ROUTE_HANDLER_FAILED" },
  );
  assert.equal(result, false);
  await tasks.drain();
  assert.deepEqual(failures, [
    {
      stage: "private-late-response",
      kind: "ROUTE_HANDLER_FAILED",
      category: "DNS_NOT_FOUND",
      frames: ["admin-orders-browser.mjs:255:29"],
    },
  ]);
  assert.equal(
    JSON.stringify(failures).includes("SYNTHETIC_PRIVATE_TOKEN"),
    false,
  );
});

test("teardown waits for a held route and records its safe failure after release", async () => {
  const failures = [];
  const tasks = createAdminOrdersBrowserTasks((failure) =>
    failures.push(failure),
  );
  let release,
    drained = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const work = tasks.run(
    async () => {
      await held;
      throw new Error("TimeoutError SYNTHETIC_PRIVATE_TOKEN");
    },
    { stage: "teardown", kind: "ROUTE_HANDLER_FAILED" },
  );
  const draining = tasks.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  release();
  assert.equal(await work, false);
  await draining;
  assert.equal(drained, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].category, "TIMEOUT");
  assert.equal(
    JSON.stringify(failures).includes("SYNTHETIC_PRIVATE_TOKEN"),
    false,
  );
});

test("an already loaded matching search needs no new network response", () => {
  assert.equal(typeof browser.adminOrdersSearchReady, "function");
  const target = { publicId: "public-order-fixture", orderId: "order-fixture" };
  assert.equal(
    browser.adminOrdersSearchReady(
      {
        busy: false,
        failed: false,
        query: target.publicId,
        rows: [{ orderId: target.orderId, publicId: target.publicId }],
      },
      target,
    ),
    true,
  );
});

test("search completion rejects old input, busy results and an unfiltered list", () => {
  assert.equal(typeof browser.adminOrdersSearchReady, "function");
  const target = { publicId: "public-order-fixture", orderId: "order-fixture" };
  const ready = {
    busy: false,
    failed: false,
    query: target.publicId,
    rows: [{ orderId: target.orderId, publicId: target.publicId }],
  };
  for (const change of [
    { busy: true },
    { failed: true },
    { query: "" },
    { rows: [] },
    { rows: [...ready.rows, { orderId: "other", publicId: "other" }] },
    { rows: [{ orderId: "other", publicId: target.publicId }] },
  ])
    assert.equal(
      browser.adminOrdersSearchReady({ ...ready, ...change }, target),
      false,
    );
});
