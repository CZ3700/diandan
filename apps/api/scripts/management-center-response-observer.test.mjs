import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createManagementResponseObserver } from "./management-center-response-observer.mjs";

const origin = "https://admin.example.invalid";
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(overrides = {}) {
  const page = new EventEmitter();
  page.mainFrame = () => page;
  const failures = [],
    accepted = [];
  const observer = createManagementResponseObserver({
    page,
    origin,
    keys: new Set(["management-list", "management-context"]),
    schema: { safeParse: (value) => ({ success: true, data: value }) },
    accept: (value) => accepted.push(value),
    check: (condition) => assert.ok(condition),
    onFailure: (failure) => failures.push(failure),
    ...overrides,
  });
  function request(key = "management-list") {
    const value = {
      url: () => `${origin}/api/admin/${key}`,
      method: () => "POST",
      failure: () => null,
    };
    page.emit("request", value);
    return value;
  }
  function response(request, body, status = 200) {
    page.emit("response", {
      request: () => request,
      status: () => status,
      ok: () => status >= 200 && status < 300,
      body: () => body,
    });
  }
  return { page, observer, failures, accepted, request, response };
}

test("drain includes a request with no response yet and waits for both body and transport", async () => {
  const state = setup();
  const request = state.request();
  const body = deferred();
  let settled = false;
  const waiting = state.observer.settled().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  state.response(request, body.promise);
  body.resolve(Buffer.from('{"kind":"LIST"}'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  state.page.emit("requestfinished", request);
  await waiting;
  assert.deepEqual(state.accepted, [{ kind: "LIST" }]);
  assert.deepEqual(state.failures, []);
  state.observer.dispose();
});

test("drain includes a second request that starts while the first body is being read", async () => {
  const state = setup();
  const first = state.request();
  const firstBody = deferred();
  state.response(first, firstBody.promise);
  state.page.emit("requestfinished", first);
  let settled = false;
  const waiting = state.observer.settled().then(() => {
    settled = true;
  });
  const second = state.request("management-context");
  firstBody.resolve(Buffer.from("{}"));
  await setImmediate();
  assert.equal(settled, false);
  state.response(second, Promise.resolve(Buffer.from("{}")));
  state.page.emit("requestfinished", second);
  await waiting;
  assert.equal(state.accepted.length, 2);
  assert.equal(state.observer.started, 2);
  state.observer.dispose();
});

for (const scenario of [
  {
    name: "body read across navigation",
    stage: "BODY_READ",
    code: "BODY_UNAVAILABLE",
    body: () =>
      Promise.reject(
        new Error(
          "Protocol error (Network.getResponseBody): No resource with given identifier found [secret]",
        ),
      ),
  },
  {
    name: "schema rejection",
    stage: "SCHEMA",
    code: "SCHEMA_INVALID",
    body: () => Promise.resolve(Buffer.from("{}")),
    schema: { safeParse: () => ({ success: false, error: { issues: [] } }) },
  },
]) {
  test(`${scenario.name} remains a safely classified failure`, async () => {
    const state = setup({
      ...(scenario.schema ? { schema: scenario.schema } : {}),
      ...(scenario.accept ? { accept: scenario.accept } : {}),
    });
    const request = state.request();
    state.page.emit("framenavigated", state.page);
    state.response(request, scenario.body());
    state.page.emit("requestfinished", request);
    await state.observer.settled();
    assert.equal(state.failures.length, 1);
    assert.equal(state.failures[0].stage, scenario.stage);
    assert.equal(state.failures[0].code, scenario.code);
    assert.equal(state.failures[0].documentAtRequest, 0);
    assert.equal(state.failures[0].documentAtFailure, 1);
    assert.doesNotMatch(
      JSON.stringify(state.failures),
      /secret|private-|Protocol error/,
    );
    state.observer.dispose();
  });
}
