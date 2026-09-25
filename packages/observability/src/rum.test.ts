import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { RumObservation } from "@fan-support/contracts/rum";

function observation(
  value: number,
  overrides: Partial<RumObservation> = {},
): RumObservation {
  return {
    schemaVersion: 1,
    event: "performance.web_vital",
    mode: "local",
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
    ...overrides,
  };
}
const options = {
  windowStart: "2026-09-24T00:00:00.000Z",
  windowEnd: "2026-09-25T00:00:00.000Z",
  minimumSamples: 4,
};

test("deduplicates late metric revisions and reports exact p75 without identifiers", async () => {
  const loaded = await import("./rum.js").catch(() => undefined);
  expect(
    loaded,
    "RUM must provide a replaceable sink and bounded aggregation",
  ).toBeDefined();
  if (!loaded) return;
  const first = observation(10);
  const updated = structuredClone(first);
  updated.measurement.metric.value = 100;
  updated.measurement.metric.revision = 2;
  const input = [
    updated,
    first,
    updated,
    observation(200),
    observation(300),
    observation(400),
  ];
  const report = loaded.aggregateRum(input, options);
  expect(report.uniqueMeasurements).toBe(4);
  expect(report.rows[0]).toMatchObject({
    p75: 300,
    count: 4,
    assessment: "LOCAL_ONLY",
  });
  expect(JSON.stringify(report)).not.toContain(
    first.measurement.metric.measurementKey,
  );
  expect(report.rows.some((row) => row.metric === "INP")).toBe(false);
});

test("keeps field, automation and sampling strata separate and fails closed on key conflicts", async () => {
  const { aggregateRum } = await import("./rum.js");
  const field = [1, 2, 3, 4].map((value) =>
    observation(value * 1000, { mode: "field" }),
  );
  expect(aggregateRum(field, options).rows[0]).toMatchObject({
    p75: 3000,
    assessment: "OVER_BUDGET",
  });
  expect(aggregateRum(field.slice(0, 1), options).rows[0]?.assessment).toBe(
    "INSUFFICIENT",
  );
  const automated = structuredClone(field[0]!);
  automated.measurement.context.automation = "automated";
  expect(
    aggregateRum([automated], { ...options, minimumSamples: 1 }).rows[0]
      ?.assessment,
  ).toBe("LOCAL_ONLY");
  const conflict = structuredClone(field[0]!);
  conflict.measurement.metric.value += 1;
  expect(() => aggregateRum([field[0]!, conflict], options)).toThrow(
    "Conflicting RUM measurement",
  );
  const mutated = structuredClone(field[0]!);
  mutated.measurement.metric.revision++;
  mutated.measurement.context.page = "gift";
  expect(() => aggregateRum([field[0]!, mutated], options)).toThrow(
    "Conflicting RUM measurement",
  );
  expect(() =>
    aggregateRum([], { ...options, windowEnd: options.windowStart }),
  ).toThrow();
});

test("the stdout sink validates the complete record and propagates failures", async () => {
  const { createRumSink } = await import("./rum.js");
  const lines: string[] = [];
  const sink = createRumSink((line) => {
    lines.push(line);
  });
  const input = observation(123);
  await sink.record(input);
  expect(JSON.parse(lines[0]!)).toEqual(input);
  await expect(
    sink.record({ ...input, email: "PRIVATE" } as unknown as RumObservation),
  ).rejects.toThrow();
  await expect(
    createRumSink(() => {
      throw new Error("sink failed");
    }).record(input),
  ).rejects.toThrow("sink failed");
});

test("conflicting old revisions are rejected even after a newer revision arrived first", async () => {
  const { aggregateRum } = await import("./rum.js");
  const first = observation(10);
  const conflict = structuredClone(first);
  conflict.measurement.metric.value = 20;
  const newer = structuredClone(first);
  newer.measurement.metric.value = 100;
  newer.measurement.metric.revision = 2;
  expect(() => aggregateRum([newer, first, conflict], options)).toThrow(
    "Conflicting RUM measurement",
  );
});
