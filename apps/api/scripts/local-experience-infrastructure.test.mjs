import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import {
  prepareLocalTls,
  verifyOwnedContainer,
} from "./local-experience-infrastructure.mjs";
test("TLS material is stable across restarts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fan-local-tls-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = await loadLocalState(root, "test");
  await prepareLocalTls(state);
  const before = await readFile(state.config.tls.privateKeyPath);
  await prepareLocalTls(state);
  assert.deepEqual(await readFile(state.config.tls.privateKeyPath), before);
});
test("a similarly named foreign container cannot be stopped or reused", () => {
  assert.throws(
    () => verifyOwnedContainer({ Config: { Labels: {} } }, "owned-id"),
    /ownership/,
  );
  assert.doesNotThrow(() =>
    verifyOwnedContainer(
      { Config: { Labels: { "com.fan-support.local-instance": "owned-id" } } },
      "owned-id",
    ),
  );
});
