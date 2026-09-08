import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseDiagnosticOptions,
  writeLighthouseEvidence,
} from "./trace-preflight.mjs";

test("diagnostic defaults retain three attempts of both gift locales; unknown scopes fail", () => {
  assert.deepEqual(parseDiagnosticOptions([]), {
    locales: ["en", "ja"],
    kinds: ["gift"],
    repeats: 3,
  });
  assert.deepEqual(
    parseDiagnosticOptions(["--kinds=home,artist,gift", "--repeats=1"]),
    {
      locales: ["en", "ja"],
      kinds: ["home", "artist", "gift"],
      repeats: 1,
    },
  );
  for (const value of [
    "--repeats=0",
    "--repeats=4",
    "--locales=xx",
    "--kinds=policy",
    "--best-only",
    "--locales=en,en",
  ]) {
    assert.throws(() => parseDiagnosticOptions([value]));
  }
});

test("preserves actual trace and devtools log independently, never overwrites an attempt", async () => {
  const output = await mkdtemp(
    path.join(os.tmpdir(), "storefront-trace-test-"),
  );
  const result = {
    lhr: {
      lighthouseVersion: "13.4.1",
      runtimeError: { code: "TEST_FAILURE" },
    },
    report: ["{}", "<!DOCTYPE html><title>TEST</title>"],
    artifacts: {
      Trace: { traceEvents: [{ name: "TEST", ts: 123 }] },
      DevtoolsLog: [
        { method: "Network.requestWillBeSent", params: { requestId: "TEST" } },
      ],
    },
  };
  try {
    const files = await writeLighthouseEvidence(
      output,
      "en-gift-mobile-1",
      result,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(output, files.trace.path), "utf8")),
      result.artifacts.Trace,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(output, files.devtoolsLog.path), "utf8"),
      ),
      result.artifacts.DevtoolsLog,
    );
    assert.equal(files.trace.events, 1);
    assert.equal(files.devtoolsLog.events, 1);
    assert.match(files.trace.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      JSON.parse(await readFile(path.join(output, files.json.path), "utf8"))
        .runtimeError.code,
      "TEST_FAILURE",
    );
    await assert.rejects(
      writeLighthouseEvidence(output, "en-gift-mobile-1", result),
      { code: "EEXIST" },
    );
    await assert.rejects(
      writeLighthouseEvidence(output, "missing", {
        ...result,
        artifacts: { DevtoolsLog: [] },
      }),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
