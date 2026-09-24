import { expect, test } from "vitest";
import * as contracts from "./rum.js";

const legacy = {
  schemaVersion: 1,
  windowStart: "2026-09-24T00:00:00.000Z",
  windowEnd: "2026-09-25T00:00:00.000Z",
  minimumSamples: 100,
  receivedRecords: 0,
  uniqueMeasurements: 0,
  rows: [],
};
const clean = {
  ...legacy,
  schemaVersion: 2,
  integrity: {
    status: "CLEAN",
    quarantinedMeasurementKeys: 0,
    quarantinedRecords: 0,
    acceptedRecords: 0,
  },
};
test("v2 reports expose only consistent quarantine counts while preserving the v1 decoder", () => {
  expect("rumReportV2Schema" in contracts).toBe(true);
  const schema = contracts.rumReportV2Schema;
  expect(schema.parse(clean)).toEqual(clean);
  const degraded = {
    ...clean,
    receivedRecords: 2,
    integrity: {
      ...clean.integrity,
      status: "DEGRADED",
      quarantinedMeasurementKeys: 1,
      quarantinedRecords: 2,
    },
  };
  expect(schema.parse(degraded)).toEqual(degraded);
  for (const candidate of [
    { ...degraded, integrity: { ...degraded.integrity, status: "CLEAN" } },
    { ...clean, integrity: { ...clean.integrity, status: "DEGRADED" } },
    { ...degraded, receivedRecords: 1 },
    { ...degraded, integrity: { ...degraded.integrity, acceptedRecords: 1 } },
    {
      ...degraded,
      integrity: { ...degraded.integrity, quarantinedMeasurementKeys: 2 },
    },
    { ...clean, uniqueMeasurements: 1 },
    { ...clean, measurementKeys: ["PRIVATE"] },
    { ...clean, integrity: { ...clean.integrity, private: "PRIVATE" } },
  ])
    expect(schema.safeParse(candidate).success).toBe(false);
  expect(contracts.rumReportSchema.parse(legacy)).toEqual(legacy);
});

test("degraded reports cannot claim any row is within budget", () => {
  const row = {
    mode: "field",
    context: {
      locale: "en",
      page: "home",
      viewport: "mobile",
      automation: "browser",
    },
    metric: "LCP",
    samplePermille: 1000,
    count: 1,
    p75: 1000,
    budgetExclusive: 2500,
    assessment: "DEGRADED",
  };
  const report = {
    ...clean,
    receivedRecords: 3,
    uniqueMeasurements: 1,
    integrity: {
      status: "DEGRADED",
      quarantinedMeasurementKeys: 1,
      quarantinedRecords: 2,
      acceptedRecords: 1,
    },
    rows: [row],
  };
  const schema = contracts.rumReportV2Schema;
  expect(schema.parse(report)).toEqual(report);
  expect(
    schema.safeParse({
      ...report,
      rows: [{ ...row, assessment: "WITHIN_BUDGET" }],
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      ...clean,
      receivedRecords: 1,
      uniqueMeasurements: 1,
      integrity: { ...clean.integrity, acceptedRecords: 1 },
      rows: [row],
    }).success,
  ).toBe(false);
});
