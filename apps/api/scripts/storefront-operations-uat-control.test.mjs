import assert from "node:assert/strict";
import { test } from "node:test";
import { get } from "node:http";
import { createOperationsRecorder } from "./storefront-operations-uat-model.mjs";
import { startOperationsControl } from "./storefront-operations-uat-control.mjs";

test("loopback controller requires exact origin and human commands, never starts on GET", async () => {
  const recorder = createOperationsRecorder();
  const saved = [];
  const focused = [];
  const control = await startOperationsControl({
    recorder,
    materials: { schemaVersion: 1 },
    persist: async (value) => saved.push(value),
    focus: async (role) => focused.push(role),
  });
  const send = (route, body, origin = control.origin) =>
    globalThis.fetch(control.origin + route, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await globalThis.fetch(control.origin)).status, 200);
    assert.equal(
      await new Promise((resolve, reject) => {
        get(
          control.origin,
          { headers: { host: "untrusted.example" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      }),
      403,
    );
    assert.deepEqual(recorder.snapshot().attempts, []);
    assert.equal(
      (await globalThis.fetch(control.origin + "/state?token=x")).status,
      400,
    );
    assert.equal(
      (await send("/timer", {}, "http://untrusted.example")).status,
      403,
    );
    assert.equal(
      (await send("/focus", { role: "manager", token: "private" })).status,
      400,
    );
    assert.equal((await send("/focus", { role: "manager" })).status, 200);
    assert.deepEqual(focused, ["manager"]);
    assert.equal(
      (
        await send("/timer", {
          schemaVersion: 1,
          action: "START",
          caseId: "gift",
          operatorCode: "OP1",
          trained: true,
          nonDeveloper: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await send("/timer", {
          schemaVersion: 1,
          action: "FINISH",
          caseId: "gift",
          result: "BLOCKED",
          assistance: "COACHING",
        })
      ).status,
      200,
    );
    assert.equal(saved.length, 2);
    assert.equal(saved[1].humanOperationsAcceptance, false);
    assert.equal(saved[1].attempts[0].status, "AWAITING_HUMAN_REVIEW");
    const state = await globalThis.fetch(control.origin + "/state");
    assert.equal(state.headers.get("cache-control"), "no-store");
    assert.equal(state.headers.get("access-control-allow-origin"), null);
    assert.equal(
      (await send("/bind", { kind: "gift", packet: {} })).status,
      400,
    );
    assert.equal(
      (await send("/timer", { payload: "x".repeat(2000) })).status,
      400,
    );
    assert.equal(
      (await globalThis.fetch(control.origin + "/timer", { method: "PUT" }))
        .status,
      405,
    );
  } finally {
    await control.close();
  }
});
