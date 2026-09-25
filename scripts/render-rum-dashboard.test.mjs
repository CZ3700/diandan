import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

test("CLI renders independent data from a poisoned window with an explicit degraded status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rum-conflict-cli-"));
  const observation = (key, value) => ({
    schemaVersion: 1,
    event: "performance.web_vital",
    mode: "field",
    receivedAt: "2026-09-24T12:00:00.000Z",
    samplePermille: 1000,
    measurement: {
      schemaVersion: 1,
      context: {
        locale: "en",
        page: "home",
        viewport: "mobile",
        automation: "browser",
      },
      metric: {
        name: "LCP",
        value,
        measurementKey: key,
        revision: 1,
        navigationType: "navigate",
      },
    },
  });
  try {
    const file = join(directory, "input.log");
    const clean = observation("8c3fc225-b13b-442f-a493-b463662c0782", 1000);
    const bad = observation("8c3fc225-b13b-442f-a493-b463662c0783", 120);
    const conflict = observation(bad.measurement.metric.measurementKey, 121);
    await writeFile(
      file,
      [clean, bad, conflict].map((row) => JSON.stringify(row)).join("\n") +
        "\n",
    );
    const output = join(directory, "report");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/render-rum-dashboard.mjs",
        "--input",
        file,
        "--output",
        output,
        "--from",
        "2026-09-24T00:00:00.000Z",
        "--to",
        "2026-09-25T00:00:00.000Z",
        "--minimum-samples",
        "1",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).fieldAcceptance, false);
    const report = JSON.parse(
      await readFile(join(output, "rum-report.json"), "utf8"),
    );
    assert.equal(report.schemaVersion, 2);
    assert.deepEqual(report.integrity, {
      status: "DEGRADED",
      quarantinedMeasurementKeys: 1,
      quarantinedRecords: 2,
      acceptedRecords: 1,
    });
    assert.equal(report.rows[0].p75, 1000);
    assert.equal(report.rows[0].assessment, "DEGRADED");
    const html = await readFile(join(output, "rum-dashboard.html"), "utf8");
    assert.match(html, /DEGRADED/u);
    assert.doesNotMatch(html, /WITHIN_BUDGET|measurementKey|8c3fc225/u);
    await writeFile(
      file,
      '{"event":"performance.web_vital","private":"PRIVATE"}\n',
    );
    const corrupt = spawnSync(
      process.execPath,
      [
        "scripts/render-rum-dashboard.mjs",
        "--input",
        file,
        "--output",
        join(directory, "corrupt"),
        "--from",
        "2026-09-24T00:00:00.000Z",
        "--to",
        "2026-09-25T00:00:00.000Z",
      ],
      { encoding: "utf8" },
    );
    assert.equal(corrupt.status, 1);
    assert.doesNotMatch(corrupt.stderr, /PRIVATE/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
