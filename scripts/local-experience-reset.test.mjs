import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  access,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLocalState } from "./local-experience-state.mjs";
import { resetLocalExperience } from "./local-experience-reset.mjs";
import { acquireLocalWorkspaceLock } from "./local-experience-lock.mjs";

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "fan-reset-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const instance = "reset-test",
    state = await loadLocalState(workspaceRoot, instance);
  await writeFile(
    path.join(state.stateDirectory, "uploaded-user-content"),
    "preserve me",
  );
  return {
    workspaceRoot,
    instance,
    state,
    confirmation: state.config.instanceId,
  };
}
test("failed storage removal preserves every state byte and releases reset ownership", async (t) => {
  const value = await fixture(t),
    file = path.join(value.state.stateDirectory, "config.json");
  const original = await readFile(file);
  await assert.rejects(
    resetLocalExperience({
      ...value,
      resetStorage: async () => {
        throw new Error("Docker unavailable");
      },
    }),
    /Docker/,
  );
  assert.deepEqual(await readFile(file), original);
  assert.equal(
    await readFile(
      path.join(value.state.stateDirectory, "uploaded-user-content"),
      "utf8",
    ),
    "preserve me",
  );
  await assert.rejects(
    access(
      path.join(path.dirname(value.state.stateDirectory), "workspace.lock"),
    ),
    { code: "ENOENT" },
  );
});
test("confirmed reset owns startup lock throughout storage removal then removes only that instance", async (t) => {
  const value = await fixture(t);
  const other = await loadLocalState(value.workspaceRoot, "preserved");
  let called = false;
  await resetLocalExperience({
    ...value,
    resetStorage: async () => {
      called = true;
      await access(
        path.join(value.state.stateDirectory, "uploaded-user-content"),
      );
      await assert.rejects(
        acquireLocalWorkspaceLock(path.dirname(value.state.stateDirectory), {
          instance: "contender",
          instanceId: "other",
          runId: "other",
          pid: process.pid,
        }),
        /owns this checkout/,
      );
    },
  });
  assert.equal(called, true);
  await assert.rejects(access(value.state.stateDirectory), { code: "ENOENT" });
  await access(path.join(other.stateDirectory, "config.json"));
});
test("incorrect confirmation and an active supervisor never call storage reset", async (t) => {
  const value = await fixture(t);
  let called = false;
  const resetStorage = async () => {
    called = true;
  };
  await assert.rejects(
    resetLocalExperience({ ...value, confirmation: "wrong", resetStorage }),
    /confirmation/,
  );
  await writeFile(
    path.join(value.state.stateDirectory, "supervisor.lock"),
    "owned",
  );
  await assert.rejects(
    resetLocalExperience({ ...value, resetStorage }),
    /Stop/,
  );
  assert.equal(called, false);
});

test("failed PostgreSQL cleanup or a stale postmaster record prevents storage and directory deletion", async (t) => {
  const value = await fixture(t);
  await mkdir(path.join(value.state.stateDirectory, "postgres"));
  await writeFile(
    path.join(value.state.stateDirectory, "postgres/postmaster.pid"),
    "1234\n",
  );
  await writeFile(
    path.join(value.state.stateDirectory, "last-run.json"),
    JSON.stringify({
      schemaVersion: 1,
      instanceId: value.state.config.instanceId,
      runId: "failed",
      stopped: true,
      cleanupFailures: ["persistent PostgreSQL"],
    }),
  );
  let called = false;
  await assert.rejects(
    resetLocalExperience({
      ...value,
      resetStorage: async () => {
        called = true;
      },
    }),
    /PostgreSQL/,
  );
  assert.equal(called, false);
  assert.equal(
    await readFile(
      path.join(value.state.stateDirectory, "uploaded-user-content"),
      "utf8",
    ),
    "preserve me",
  );
});
