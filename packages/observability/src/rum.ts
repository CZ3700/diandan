import {
  rumObservationSchema,
  rumReportSchema,
  type RumObservation,
  type RumReport,
} from "@fan-support/contracts/rum";

export type RumSink = Readonly<{
  record: (record: RumObservation) => Promise<void>;
}>;
export function createRumSink(
  write: (line: string) => void | Promise<void>,
): RumSink {
  return Object.freeze({
    async record(candidate) {
      const record = rumObservationSchema.parse(candidate);
      await write(`${JSON.stringify(record)}\n`);
    },
  });
}

export const RUM_MAX_RECORDS = 100_000;
const budgets = { LCP: 2500, INP: 200, CLS: 0.1 } as const;
type ReportOptions = Readonly<{
  windowStart: string;
  windowEnd: string;
  minimumSamples?: number;
}>;

function identity(record: RumObservation): string {
  const { context, metric } = record.measurement;
  return JSON.stringify([
    record.mode,
    record.samplePermille,
    context.locale,
    context.page,
    context.viewport,
    context.automation,
    metric.name,
    metric.navigationType,
  ]);
}

/** Report receipt-window p75; document metrics are not SPA-page observations. */
export function aggregateRum(
  input: readonly RumObservation[],
  options: ReportOptions,
): RumReport {
  const start = Date.parse(options.windowStart);
  const end = Date.parse(options.windowEnd);
  const minimumSamples = options.minimumSamples ?? 100;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isSafeInteger(minimumSamples) ||
    minimumSamples < 1 ||
    input.length > RUM_MAX_RECORDS
  )
    throw new Error("Invalid RUM aggregation bounds");
  const latest = new Map<string, RumObservation>();
  const revisionValues = new Map<string, number>();
  let receivedRecords = 0;
  for (const candidate of input) {
    const record = rumObservationSchema.parse(candidate);
    const received = Date.parse(record.receivedAt);
    if (received < start || received >= end) continue;
    receivedRecords++;
    const metric = record.measurement.metric;
    const revisionKey = `${metric.measurementKey}:${metric.revision}`;
    const revisionValue = revisionValues.get(revisionKey);
    if (revisionValue !== undefined && revisionValue !== metric.value)
      throw new Error("Conflicting RUM measurement");
    revisionValues.set(revisionKey, metric.value);
    const previous = latest.get(metric.measurementKey);
    if (previous !== undefined) {
      if (
        identity(previous) !== identity(record) ||
        (previous.measurement.metric.revision === metric.revision &&
          previous.measurement.metric.value !== metric.value)
      )
        throw new Error("Conflicting RUM measurement");
      if (previous.measurement.metric.revision >= metric.revision) continue;
    }
    latest.set(metric.measurementKey, record);
  }
  const groups = new Map<
    string,
    { record: RumObservation; values: number[] }
  >();
  for (const record of latest.values()) {
    // Navigation type remains part of dedup identity but all standard hard-document visits share the distribution.
    const { context, metric } = record.measurement;
    const groupKey = JSON.stringify([
      record.mode,
      record.samplePermille,
      context.locale,
      context.page,
      context.viewport,
      context.automation,
      metric.name,
    ]);
    const group = groups.get(groupKey) ?? { record, values: [] };
    group.values.push(metric.value);
    groups.set(groupKey, group);
  }
  return rumReportSchema.parse({
    schemaVersion: 1,
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
    minimumSamples,
    receivedRecords,
    uniqueMeasurements: latest.size,
    rows: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { record, values }]) => {
        values.sort((a, b) => a - b);
        const metric = record.measurement.metric.name;
        const p75 = values[Math.ceil(values.length * 0.75) - 1]!;
        return {
          mode: record.mode,
          context: record.measurement.context,
          metric,
          samplePermille: record.samplePermille,
          count: values.length,
          p75,
          budgetExclusive: budgets[metric],
          assessment:
            record.mode !== "field" ||
            record.measurement.context.automation === "automated"
              ? "LOCAL_ONLY"
              : values.length < minimumSamples
                ? "INSUFFICIENT"
                : p75 < budgets[metric]
                  ? "WITHIN_BUDGET"
                  : "OVER_BUDGET",
        };
      }),
  });
}
