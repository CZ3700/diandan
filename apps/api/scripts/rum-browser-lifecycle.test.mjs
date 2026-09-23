import assert from "node:assert/strict";
import test from "node:test";
import {
  runOwnedRumBrowser,
  assertNativeHiddenEvidence,
} from "./rum-browser-lifecycle.mjs";

function setup(overrides = {}) {
  const calls = [];
  const child = { exitCode: null, signalCode: null };
  const launcher = {
    chromeProcess: child,
    port: 1234,
    async launch() {
      calls.push("launch");
    },
    kill() {
      calls.push("kill");
      child.signalCode = "SIGKILL";
    },
    ...overrides.launcher,
  };
  const browser = {
    contexts: () => [{}],
    async close() {
      calls.push("close");
    },
    ...overrides.browser,
  };
  return {
    calls,
    launcher,
    options: {
      connect: async () => browser,
      verify: async () => {
        calls.push("verify");
        return "OK";
      },
      removeProfile: async () => {
        calls.push("remove");
      },
      timeoutMs: 20,
    },
  };
}

test("partial launch failure still kills the already spawned child before removing its profile", async () => {
  const fixture = setup({
    launcher: {
      async launch() {
        throw new Error("readiness failed");
      },
    },
  });
  await assert.rejects(
    runOwnedRumBrowser(fixture.launcher, fixture.options),
    /readiness failed/u,
  );
  assert.deepEqual(fixture.calls, ["kill", "remove"]);
});
test("close rejection or timeout cannot prevent owned kill and profile cleanup", async () => {
  for (const close of [
    async () => {
      throw new Error("close failed");
    },
    () => new Promise(() => {}),
  ]) {
    const fixture = setup({ browser: { close } });
    await assert.rejects(runOwnedRumBrowser(fixture.launcher, fixture.options));
    assert.deepEqual(fixture.calls, ["launch", "verify", "kill", "remove"]);
  }
});
test("unconfirmed process exit blocks success and preserves the owned profile", async () => {
  const fixture = setup({ launcher: { kill() {} } });
  await assert.rejects(
    runOwnedRumBrowser(fixture.launcher, fixture.options),
    /did not exit/u,
  );
  assert.equal(fixture.calls.includes("remove"), false);
});
test("fresh owned context success waits for process exit and profile cleanup", async () => {
  const fixture = setup();
  assert.equal(
    await runOwnedRumBrowser(fixture.launcher, fixture.options),
    "OK",
  );
  assert.deepEqual(fixture.calls, [
    "launch",
    "verify",
    "close",
    "kill",
    "remove",
  ]);
});
test("connection and profile-removal failures cannot become successful verification", async () => {
  const connection = setup();
  connection.options.connect = async () => {
    throw new Error("connect failed");
  };
  await assert.rejects(
    runOwnedRumBrowser(connection.launcher, connection.options),
    /connect failed/u,
  );
  assert.deepEqual(connection.calls, ["launch", "kill", "remove"]);
  const removal = setup();
  removal.options.removeProfile = async () => {
    throw new Error("remove failed");
  };
  await assert.rejects(
    runOwnedRumBrowser(removal.launcher, removal.options),
    /remove failed/u,
  );
  assert.deepEqual(removal.calls, ["launch", "verify", "close", "kill"]);
});
test("visibility evidence rejects synthetic, missing, navigated, or still visible documents", () => {
  const valid = {
    before: "visible",
    after: "hidden",
    sameDocument: true,
    sameUrl: true,
    sameTimeOrigin: true,
    events: [{ state: "hidden", trusted: true }],
  };
  assert.doesNotThrow(() => assertNativeHiddenEvidence(valid));
  for (const change of [
    { after: "visible" },
    { sameDocument: false },
    { sameUrl: false },
    { sameTimeOrigin: false },
    { events: [] },
    { events: [{ state: "hidden", trusted: false }] },
  ])
    assert.throws(() => assertNativeHiddenEvidence({ ...valid, ...change }));
});
