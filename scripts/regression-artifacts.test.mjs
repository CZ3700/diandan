import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const module = await import("./regression-artifacts.mjs").catch(() => ({}));
test("archive only explicit evidence formats from output, never private runtime state or raw logs", async () => {
  assert.equal(typeof module.collectRegressionArtifacts, "function");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "regression-artifacts-"),
  );
  try {
    const source = path.join(directory, "output"),
      target = path.join(directory, "archive");
    await mkdir(source);
    for (const filename of [
      "report.json",
      "page.png",
      "evidence.txt",
      "browser.log",
      ".env",
      "private.key",
      "trace.har",
      "dump.db",
    ])
      await writeFile(path.join(source, filename), filename);
    const result = await module.collectRegressionArtifacts(source, target);
    assert.deepEqual((await readdir(target)).sort(), [
      "evidence.txt",
      "page.png",
      "report.json",
    ]);
    assert.equal(result.files, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
