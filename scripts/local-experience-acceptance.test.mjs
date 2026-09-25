import test from "node:test";
import assert from "node:assert/strict";
import { runLocalAcceptance } from "./local-experience-acceptance.mjs";

function fixture(failAt) {
  const calls = [];
  const actions = Object.fromEntries(
    ["initialize", "start", "snapshot", "browser", "stop", "reset"].map(
      (name) => [
        name,
        async (...args) => {
          calls.push({ name, args });
          if (name === failAt) throw new Error("simulated failure");
          if (name === "snapshot") return { config: "stable", media: "stable" };
          if (name === "browser")
            return { status: "PASS", factsPath: "facts.json" };
        },
      ],
    ),
  );
  return { calls, actions };
}

test("acceptance verifies the same instance after stop/restart before removing its data", async () => {
  const { calls, actions } = fixture();
  const result = await runLocalAcceptance(actions);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      "initialize",
      "start",
      "browser",
      "snapshot",
      "stop",
      "start",
      "snapshot",
      "browser",
      "stop",
      "reset",
    ],
  );
  assert.deepEqual(calls.filter(({ name }) => name === "browser")[1].args, [
    "facts.json",
  ]);
  assert.equal(result.status, "PASS");
  assert.equal(result.retained, false);
});

test("a browser failure stops owned processes and preserves data for investigation", async () => {
  const { calls, actions } = fixture("browser");
  await assert.rejects(runLocalAcceptance(actions), /simulated failure/u);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["initialize", "start", "browser", "stop"],
  );
});

test("a failed stop never resets or starts another supervisor", async () => {
  const { calls, actions } = fixture("stop");
  await assert.rejects(runLocalAcceptance(actions), /cleanup/u);
  assert.equal(calls.filter(({ name }) => name === "start").length, 1);
  assert.equal(
    calls.some(({ name }) => name === "reset"),
    false,
  );
});

test("persistent configuration changes fail verification without deleting the instance", async () => {
  const { calls, actions } = fixture();
  let snapshots = 0;
  actions.snapshot = async () => ({ config: ++snapshots });
  await assert.rejects(runLocalAcceptance(actions), /persisted/u);
  assert.equal(
    calls.some(({ name }) => name === "reset"),
    false,
  );
});

test("keep retains the owned instance after a successful stopped acceptance", async () => {
  const { calls, actions } = fixture();
  const result = await runLocalAcceptance(actions, { keep: true });
  assert.equal(result.retained, true);
  assert.equal(calls.at(-1).name, "stop");
});

for (const incompleteRun of [1, 2]) {
  test(`partial browser evidence in run ${incompleteRun} cannot pass full acceptance or reset data`, async () => {
    const { calls, actions } = fixture();
    let runs = 0;
    actions.browser = async () => ({
      status: ++runs === incompleteRun ? "PARTIAL_PASS" : "PASS",
      factsPath: "facts.json",
    });
    await assert.rejects(runLocalAcceptance(actions), /complete browser/u);
    assert.equal(
      calls.some(({ name }) => name === "reset"),
      false,
    );
    assert.equal(calls.at(-1).name, "stop");
  });
}
