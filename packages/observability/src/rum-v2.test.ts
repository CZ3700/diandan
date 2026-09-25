import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { RumObservation } from "@fan-support/contracts/rum";
import * as runtime from "./rum.js";

const options = {
  windowStart: "2026-09-24T00:00:00.000Z",
  windowEnd: "2026-09-25T00:00:00.000Z",
  minimumSamples: 4,
};
function observation(value: number): RumObservation {
  return {
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
        measurementKey: randomUUID(),
        revision: 1,
        navigationType: "navigate",
      },
    },
  };
}
function revision(
  record: RumObservation,
  number: number,
  value: number,
): RumObservation {
  const result = structuredClone(record);
  result.measurement.metric.revision = number;
  result.measurement.metric.value = value;
  return result;
}
const aggregate = runtime.aggregateRumV2;

test("quarantines every revision of a conflicted key while keeping independent observations visible", () => {
  const bad = observation(10);
  const clean = [100, 200, 300, 400].map(observation);
  const report = aggregate(
    [
      revision(bad, 2, 90),
      bad,
      ...clean,
      revision(bad, 1, 20),
      revision(bad, 3, 100),
    ],
    options,
  );
  expect(report).toMatchObject({
    schemaVersion: 2,
    receivedRecords: 8,
    uniqueMeasurements: 4,
    integrity: {
      status: "DEGRADED",
      quarantinedMeasurementKeys: 1,
      quarantinedRecords: 4,
      acceptedRecords: 4,
    },
  });
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0]).toMatchObject({
    p75: 300,
    count: 4,
    assessment: "DEGRADED",
  });
  expect(JSON.stringify(report)).not.toContain(
    bad.measurement.metric.measurementKey,
  );
  expect("aggregateRumV2" in runtime).toBe(true);
});

test.each([
  "context",
  "mode",
  "samplePermille",
  "navigationType",
  "metricName",
])(
  "a %s identity change quarantines the key without elevating local observations",
  (change) => {
    const bad = observation(10);
    const mutated = revision(bad, 2, 20);
    if (change === "context") mutated.measurement.context.page = "gift";
    if (change === "mode") mutated.mode = "local";
    if (change === "samplePermille") mutated.samplePermille = 500;
    if (change === "navigationType")
      mutated.measurement.metric.navigationType = "reload";
    if (change === "metricName") mutated.measurement.metric.name = "INP";
    const local = observation(200);
    local.mode = "local";
    local.measurement.context.automation = "automated";
    const report = aggregate([bad, local, mutated], options);
    expect(report).toMatchObject({
      uniqueMeasurements: 1,
      integrity: {
        status: "DEGRADED",
        quarantinedMeasurementKeys: 1,
        quarantinedRecords: 2,
        acceptedRecords: 1,
      },
    });
    expect(report.rows[0]).toMatchObject({
      mode: "local",
      context: { automation: "automated" },
      assessment: "DEGRADED",
    });
  },
);

test("out-of-order older revisions and exact duplicates retain the latest value without inflating samples", () => {
  const first = observation(10);
  const newer = revision(first, 2, 100);
  const report = aggregate(
    [newer, first, newer, ...[200, 300, 400].map(observation)],
    options,
  );
  expect(report).toMatchObject({
    schemaVersion: 2,
    receivedRecords: 6,
    uniqueMeasurements: 4,
    integrity: {
      status: "CLEAN",
      quarantinedMeasurementKeys: 0,
      quarantinedRecords: 0,
      acceptedRecords: 6,
    },
  });
  expect(report.rows[0]).toMatchObject({
    count: 4,
    p75: 300,
    assessment: "WITHIN_BUDGET",
  });
});

test("a conflict remains quarantined regardless of arrival order", () => {
  const bad = observation(10);
  const entries = [bad, revision(bad, 1, 20), revision(bad, 2, 30)];
  for (const order of [
    entries,
    [...entries].reverse(),
    [entries[2]!, entries[0]!, entries[1]!],
  ]) {
    expect(aggregate(order, options)).toMatchObject({
      rows: [],
      uniqueMeasurements: 0,
      integrity: {
        status: "DEGRADED",
        quarantinedMeasurementKeys: 1,
        quarantinedRecords: 3,
        acceptedRecords: 0,
      },
    });
  }
});

test("only receipt-window conflicts count and empty windows remain explicitly empty", () => {
  const start = observation(10);
  start.receivedAt = options.windowStart;
  const excluded = revision(start, 1, 20);
  excluded.receivedAt = options.windowEnd;
  expect(aggregate([start, excluded], options)).toMatchObject({
    receivedRecords: 1,
    uniqueMeasurements: 1,
    integrity: { status: "CLEAN", quarantinedMeasurementKeys: 0 },
  });
  expect(aggregate([], options)).toMatchObject({
    rows: [],
    receivedRecords: 0,
    uniqueMeasurements: 0,
    integrity: { status: "CLEAN", acceptedRecords: 0 },
  });
});

test("clean windows preserve p75, sampling, automation and minimum-sample decisions", () => {
  const field = [1000, 2000, 3000, 4000].map(observation);
  expect(aggregate(field, options).rows[0]).toMatchObject({
    p75: 3000,
    assessment: "OVER_BUDGET",
  });
  expect(aggregate(field.slice(0, 1), options).rows[0]?.assessment).toBe(
    "INSUFFICIENT",
  );
  const local = observation(1);
  local.mode = "local";
  const automated = observation(1);
  automated.measurement.context.automation = "automated";
  const sampled = observation(1);
  sampled.samplePermille = 100;
  const report = aggregate([local, automated, sampled], {
    ...options,
    minimumSamples: 1,
  });
  expect(
    report.rows.filter((row) => row.assessment === "LOCAL_ONLY"),
  ).toHaveLength(2);
  expect(
    report.rows.find((row) => row.samplePermille === 100)?.assessment,
  ).toBe("WITHIN_BUDGET");
});

test("invalid schemas, PII fields and oversized input still fail closed", () => {
  const record = observation(1);
  expect(() =>
    aggregate([{ ...record, email: "PRIVATE" } as RumObservation], options),
  ).toThrow();
  expect(() =>
    aggregate(
      Array.from({ length: runtime.RUM_MAX_RECORDS + 1 }, () => record),
      options,
    ),
  ).toThrow();
  expect(() =>
    aggregate([], { ...options, windowEnd: options.windowStart }),
  ).toThrow();
});
