import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { assertLocalStopSucceeded } from "./local-experience-stop-result.mjs";

test("stop only accepts the matching successful run and refuses lost or failed cleanup evidence", async (t) => {
  const stateDirectory = await mkdtemp(
    path.join(os.tmpdir(), "fan-stop-result-"),
  );
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const state = { stateDirectory, config: { instanceId: "owned-instance" } },
    runId = "owned-run";
  const save = (overrides = {}) =>
    writeFile(
      path.join(stateDirectory, "last-run.json"),
      JSON.stringify({
        schemaVersion: 1,
        instanceId: state.config.instanceId,
        runId,
        stopped: true,
        cleanupFailures: [],
        ...overrides,
      }),
    );
  await assert.rejects(assertLocalStopSucceeded(state, runId), /verify/);
  await save({ cleanupFailures: ["persistent PostgreSQL"] });
  await assert.rejects(
    assertLocalStopSucceeded(state, runId),
    /cleanup failed/,
  );
  await save({ runId: "different-run" });
  await assert.rejects(assertLocalStopSucceeded(state, runId), /verify/);
  await save({ instanceId: "foreign" });
  await assert.rejects(assertLocalStopSucceeded(state, runId), /verify/);
  await save();
  await assertLocalStopSucceeded(state, runId);
});
