import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { observePaymentBrowserCart } from "./payment-runtime-browser-observer.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const page = new EventEmitter(),
    records = [];
  const observer = observePaymentBrowserCart({
    page,
    origin: "https://storefront.example.invalid",
    accept: (value) => records.push(value),
  });
  const request = (response) =>
    page.emit("request", {
      url: () =>
        "https://storefront.example.invalid/api/storefront/cart?presentationLocale=en",
      method: () => "GET",
      response: () => response,
    });
  const response = (body) => ({
    status: () => 403,
    headers: () => ({}),
    json: () => body,
  });
  return { observer, records, request, response };
}
test("cart drain waits for response and body and includes a new pending request", async () => {
  const state = setup(),
    first = deferred(),
    second = deferred();
  state.request(first.promise);
  let settled = false;
  const waiting = state.observer.settled().then(() => {
    settled = true;
  });
  await setImmediate();
  assert.equal(settled, false);
  state.request(Promise.resolve(state.response(second.promise)));
  first.resolve(
    state.response(
      Promise.resolve({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_ACCESS",
      }),
    ),
  );
  await setImmediate();
  assert.equal(settled, false);
  second.resolve({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CART_NOT_FOUND",
  });
  await waiting;
  assert.deepEqual(
    state.records.map((value) => value.code),
    ["INVALID_ACCESS", "CART_NOT_FOUND"],
  );
  state.observer.dispose();
});
test("safe failure classification never stores untrusted body or error text", async () => {
  const state = setup();
  state.request(
    Promise.resolve(
      state.response(Promise.resolve({ private: "secret-canary" })),
    ),
  );
  state.request(
    Promise.resolve({
      ...state.response(null),
      json: async () => {
        throw new Error("secret-canary");
      },
    }),
  );
  await state.observer.settled();
  assert.deepEqual(
    state.records.map((value) => value.code),
    ["SCHEMA_INVALID", "BODY_UNAVAILABLE"],
  );
  assert.doesNotMatch(JSON.stringify(state.records), /secret-canary|private/);
  state.observer.dispose();
});
