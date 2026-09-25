import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import {
  validateRumExchange,
  readRumLogRecords,
  assertRumCells,
  observeRum,
} from "./rum-browser.mjs";

const intake = {
  schemaVersion: 1,
  context: {
    locale: "en",
    page: "home",
    viewport: "mobile",
    automation: "automated",
  },
  metric: {
    name: "LCP",
    value: 1200,
    measurementKey: "10000000-0000-4000-8000-000000000001",
    revision: 1,
    navigationType: "navigate",
  },
};
const observed = {
  schemaVersion: 1,
  event: "performance.web_vital",
  mode: "local",
  samplePermille: 1000,
  receivedAt: "2026-09-24T00:00:00.000Z",
  measurement: intake,
};
test("RUM exchange rejects headers or body that could disclose private context", () => {
  const valid = {
    endpoint: "http://localhost:3400/api/storefront/rum",
    method: "POST",
    status: 204,
    headers: {
      origin: "http://localhost:3400",
      "sec-fetch-site": "same-origin",
    },
    body: intake,
  };
  assert.doesNotThrow(() =>
    validateRumExchange(valid, "http://localhost:3400"),
  );
  for (const value of [
    { ...valid, status: 503 },
    { ...valid, endpoint: valid.endpoint + "?private=test" },
    { ...valid, headers: { ...valid.headers, cookie: "test" } },
    { ...valid, headers: { ...valid.headers, referer: "test" } },
    { ...valid, body: { ...intake, url: "private" } },
    {
      ...valid,
      body: {
        ...intake,
        context: { ...intake.context, automation: "browser" },
      },
    },
  ])
    assert.throws(() => validateRumExchange(value, "http://localhost:3400"));
});

test("request attempts remain observable when acknowledgement or header validation fails", async () => {
  const origin = "http://localhost:3400";
  for (const mode of ["no-response", "header-failure", "private-header"]) {
    const page = new EventEmitter();
    const observed = observeRum(page, origin);
    const request = {
      url: () => origin + "/api/storefront/rum",
      method: () => "POST",
      postData: () => JSON.stringify(intake),
      allHeaders: async () => {
        if (mode === "header-failure") throw new Error("headers unavailable");
        return {
          origin,
          "sec-fetch-site": "same-origin",
          cookie: "SENSITIVE_TEST_SENTINEL",
        };
      },
    };
    page.emit("request", request);
    if (mode !== "no-response")
      page.emit("response", { request: () => request, status: () => 204 });
    await observed.settle();
    assert.equal(observed.postAttempts, 1);
    assert.equal(observed.exchanges.length, 0);
    assert.equal(
      JSON.stringify(observed.requests).includes("SENSITIVE_TEST_SENTINEL"),
      false,
    );
    if (mode !== "no-response") assert.ok(observed.errors.length > 0);
  }
});
test("server evidence excludes non-RUM logs and rejects malformed RUM observations", () => {
  assert.deepEqual(
    readRumLogRecords("Next ready\n" + JSON.stringify(observed) + "\n"),
    [observed],
  );
  assert.throws(() =>
    readRumLogRecords(JSON.stringify({ ...observed, rawUrl: "private" })),
  );
  assert.throws(() => readRumLogRecords('{"event":"performance.web_vital'));
});
test("204 acknowledgement requires completed response and pending observations are bounded", async () => {
  for (const mode of [
    "finished",
    "rejected",
    "never-finished",
    "never-headers",
  ]) {
    const page = new EventEmitter();
    const origin = "http://localhost:3400";
    const observed = observeRum(page, origin, 20);
    const request = {
      url: () => origin + "/api/storefront/rum",
      method: () => "POST",
      postData: () => JSON.stringify(intake),
      allHeaders: () =>
        mode === "never-headers"
          ? new Promise(() => {})
          : Promise.resolve({ origin, "sec-fetch-site": "same-origin" }),
    };
    page.emit("request", request);
    page.emit("response", {
      request: () => request,
      status: () => 204,
      finished: () =>
        mode === "never-finished"
          ? new Promise(() => {})
          : mode === "rejected"
            ? Promise.reject(new Error("aborted"))
            : Promise.resolve(null),
    });
    await observed.settle();
    assert.equal(observed.postAttempts, 1);
    assert.equal(observed.exchanges.length, mode === "finished" ? 1 : 0);
    assert.equal(observed.errors.length > 0, mode !== "finished");
  }
});
test("a partial browser matrix cannot count as RUM acceptance", () => {
  assert.throws(() => assertRumCells([]));
  assert.throws(() =>
    assertRumCells([
      {
        locale: "en",
        width: 390,
        metrics: ["LCP", "CLS"],
        orderAccessPosts: 0,
      },
    ]),
  );
});
