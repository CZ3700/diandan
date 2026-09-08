import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { withEphemeralPostgres } from "../../../packages/persistence-postgres/dist/index.js";

const require = createRequire(
  new URL(
    "../../../packages/persistence-postgres/package.json",
    import.meta.url,
  ),
);
const { Client } = require("pg");
const samples = [];
const monotonicUs = () => process.hrtime.bigint() / 1000n;
const range = (values) => ({
  min: Number(values.reduce((a, b) => (a < b ? a : b))),
  max: Number(values.reduce((a, b) => (a > b ? a : b))),
});
const steps = (field) => {
  const values = samples
    .slice(1)
    .map((sample, index) => sample[field] - samples[index][field]);
  return {
    adjacentBackwardCount: values.filter((value) => value < 0n).length,
    maxBackwardUs: Number(
      values.reduce((max, value) => (-value > max ? -value : max), 0n),
    ),
    adjacentStepUs: range(values),
    stepMinusMonotonicUs: range(
      values.map(
        (value, index) =>
          value - (samples[index + 1].mono - samples[index].mono),
      ),
    ),
  };
};

await withEphemeralPostgres(async (configuration) => {
  const client = new Client(configuration);
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const start = monotonicUs();
    while (monotonicUs() - start < 8_000_000n) {
      const before = monotonicUs();
      const hostBefore = BigInt(Date.now()) * 1000n;
      const result = await client.query(
        "WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now) SELECT (extract(epoch FROM instant.now)*1000000)::bigint::text AS pg_us,(extract(epoch FROM transaction_timestamp())*1000000)::bigint::text AS transaction_us FROM instant",
      );
      const hostAfter = BigInt(Date.now()) * 1000n;
      const after = monotonicUs();
      samples.push({
        pg: BigInt(result.rows[0].pg_us),
        transaction: BigInt(result.rows[0].transaction_us),
        host: (hostBefore + hostAfter) / 2n,
        hostBefore,
        hostAfter,
        mono: (before + after) / 2n,
        roundTrip: after - before,
      });
      await delay(40);
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});

const report = {
  schemaVersion: 1,
  status: "COMPLETED",
  scope:
    "Natural wall-clock observations in one independent ephemeral PostgreSQL read-only transaction; no altered clocks, SQL results or business parameters",
  sampleCount: samples.length,
  targetDurationMs: 8000,
  targetIntervalMs: 40,
  actualMonotonicSpanUs: Number(samples.at(-1).mono - samples[0].mono),
  nodeDateResolutionUs: 1000,
  postgres: steps("pg"),
  hostNode: steps("host"),
  queryRoundTripUs: range(samples.map((sample) => sample.roundTrip)),
  postgresMinusHostMidpointUs: range(
    samples.map((sample) => sample.pg - sample.host),
  ),
  postgresMinusHostBeforeUs: range(
    samples.map((sample) => sample.pg - sample.hostBefore),
  ),
  postgresMinusHostAfterUs: range(
    samples.map((sample) => sample.pg - sample.hostAfter),
  ),
  maxTransactionAheadOfWallUs: Number(
    samples.reduce(
      (max, sample) =>
        sample.transaction - sample.pg > max
          ? sample.transaction - sample.pg
          : max,
      0n,
    ),
  ),
  databaseClosed: true,
  attribution:
    "Observed regressions establish only this sampling interval, not the cause of a different failed publication or cart transaction",
};
await writeFile(
  new URL("natural-clock-observation.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(report) + "\n");
