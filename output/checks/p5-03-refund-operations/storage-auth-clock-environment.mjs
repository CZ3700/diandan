import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { setInterval, clearInterval } from "node:timers";
import { withEphemeralPostgres } from "../../../packages/persistence-postgres/dist/index.js";
const require = createRequire(
  new URL(
    "../../../packages/persistence-postgres/package.json",
    import.meta.url,
  ),
);
const { Client } = require("pg");
const exec = promisify(execFile);
const sql = `WITH samples AS MATERIALIZED (
 SELECT i, clock_timestamp() AS at FROM generate_series(1,200000) AS i
), deltas AS (
 SELECT i, at, extract(epoch FROM at-lag(at) OVER (ORDER BY i))*1000000 AS delta FROM samples
)
SELECT count(*) FILTER (WHERE delta<0)::integer regressions,
 min(delta)::text min_delta_us,
 count(*) FILTER (WHERE at<transaction_timestamp())::integer before_transaction,
 min(extract(epoch FROM at-transaction_timestamp())*1000000)::text min_transaction_delta_us,
 (extract(epoch FROM min(at))*1000000)::bigint::text min_epoch_us,
 (extract(epoch FROM max(at))*1000000)::bigint::text max_epoch_us
FROM deltas`;
const results = [];
const affinities = process.argv.includes("--cpu0-only")
  ? ["0"]
  : ["default", "0", "1"];
const duration = process.argv.includes("--long") ? 65000 : 12000;
for (const affinity of affinities) {
  let container;
  const docker = {
    run: async (args, environment = {}) => {
      let actual = [...args];
      if (args[0] === "run") {
        container = args[args.indexOf("--name") + 1];
        if (affinity !== "default")
          actual.splice(1, 0, "--cpuset-cpus", affinity);
      }
      const value = await exec("docker", actual, {
        env: { ...process.env, ...environment },
        maxBuffer: 1024 * 1024,
      });
      return { stdout: value.stdout };
    },
  };
  await withEphemeralPostgres(
    async (database) => {
      const client = new Client(database);
      await client.connect();
      try {
        const clocksource = (
          await exec("docker", [
            "exec",
            container,
            "cat",
            "/sys/devices/system/clocksource/clocksource0/current_clocksource",
          ])
        ).stdout.trim();
        const summary = {
          affinity,
          clocksource,
          iterations: 0,
          samples: 0,
          regressions: 0,
          worstDeltaUs: 0,
          beforeTransaction: 0,
          worstTransactionDeltaUs: 0,
          crossStatementRegressions: 0,
          worstCrossStatementUs: 0,
          nodeSamples: 0,
          nodeRegressions: 0,
          worstNodeDeltaMs: 0,
          examples: [],
        };
        let previousNode = Date.now(),
          previousPg = null;
        const timer = setInterval(() => {
          const now = Date.now(),
            delta = now - previousNode;
          previousNode = now;
          summary.nodeSamples++;
          if (delta < 0) {
            summary.nodeRegressions++;
            summary.worstNodeDeltaMs = Math.min(
              summary.worstNodeDeltaMs,
              delta,
            );
          }
        }, 1);
        const deadline = performance.now() + duration;
        try {
          while (performance.now() < deadline) {
            await client.query("BEGIN");
            const before = Date.now();
            const row = (await client.query(sql)).rows[0];
            const stamp = (
              await client.query(
                "SELECT (extract(epoch FROM clock_timestamp())*1000000)::bigint::text us",
              )
            ).rows[0].us;
            await client.query("COMMIT");
            const after = Date.now();
            summary.iterations++;
            summary.samples += 200000;
            summary.regressions += row.regressions;
            summary.worstDeltaUs = Math.min(
              summary.worstDeltaUs,
              Number(row.min_delta_us),
            );
            summary.beforeTransaction += row.before_transaction;
            summary.worstTransactionDeltaUs = Math.min(
              summary.worstTransactionDeltaUs,
              Number(row.min_transaction_delta_us),
            );
            const cross =
              previousPg === null
                ? 0
                : Number(BigInt(row.min_epoch_us) - previousPg);
            if (cross < 0) {
              summary.crossStatementRegressions++;
              summary.worstCrossStatementUs = Math.min(
                summary.worstCrossStatementUs,
                cross,
              );
            }
            previousPg = BigInt(stamp);
            if (
              (row.regressions || row.before_transaction || cross < 0) &&
              summary.examples.length < 8
            )
              summary.examples.push({
                iteration: summary.iterations,
                regressions: row.regressions,
                minDeltaUs: row.min_delta_us,
                beforeTransaction: row.before_transaction,
                minTransactionDeltaUs: row.min_transaction_delta_us,
                crossStatementUs: cross,
                queryWallMilliseconds: after - before,
              });
          }
        } finally {
          clearInterval(timer);
        }
        results.push(summary);
        console.log(JSON.stringify(summary));
      } finally {
        await client.end();
      }
    },
    { docker },
  );
}
console.log(JSON.stringify({ status: "MEASURED", results }));
