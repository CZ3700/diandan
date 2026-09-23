import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("dashboard explicitly marks empty windows and missing INP rather than passing", async () => {
  const loaded = await import("./render-rum-dashboard.mjs").catch(
    () => undefined,
  );
  assert.ok(loaded, "RUM offline dashboard implementation must exist");
  const report = {
    schemaVersion: 1,
    windowStart: "2026-09-24T00:00:00.000Z",
    windowEnd: "2026-09-25T00:00:00.000Z",
    minimumSamples: 100,
    receivedRecords: 0,
    uniqueMeasurements: 0,
    rows: [],
  };
  const html = loaded.renderRumDashboard(report);
  assert.match(html, /INSUFFICIENT/u);
  assert.match(html, /No observations/u);
  assert.match(html, /LCP/u);
  assert.match(html, /INP/u);
  assert.match(html, /CLS/u);
  assert.doesNotMatch(html, /measurementKey|<script src=/u);
});

test("log reader filters ordinary logs, rejects malformed observations and bounds records", async () => {
  const { readRumLogs } = await import("./render-rum-dashboard.mjs");
  const directory = await mkdtemp(join(tmpdir(), "rum-reader-"));
  try {
    const file = join(directory, "input.log");
    await writeFile(
      file,
      'normal app stdout\n{"event":"http.request.completed"}\n',
    );
    assert.deepEqual(await readRumLogs([file]), []);
    await writeFile(
      file,
      '{"event":"performance.web_vital","private":"PRIVATE"}\n',
    );
    await assert.rejects(readRumLogs([file]), /Invalid RUM observation/u);
    await writeFile(
      file,
      '{"event":"performance.web_vital","schemaVersion":1,\n',
    );
    await assert.rejects(readRumLogs([file]), /Invalid RUM observation/u);
    await writeFile(file, "x".repeat(70000));
    await assert.rejects(readRumLogs([file]), /RUM log line limit/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
