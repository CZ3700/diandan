import assert from "node:assert/strict";
import { readFile, access, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { URL } from "node:url";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { setInterval, clearInterval } from "node:timers";
import { withNativeFinancePostgres } from "../../../apps/api/scripts/admin-finance-native-postgres.mjs";

const require = createRequire(
  new URL(
    "../../../packages/persistence-postgres/package.json",
    import.meta.url,
  ),
);
const { Client } = require("pg");
const native = JSON.parse(
  await readFile(
    new URL("./native-postgres-environment.json", import.meta.url),
    "utf8",
  ),
);
const options = {
  binDirectory: native.bin,
};
const exec = promisify(execFile);
const summary = {
  lifecycle: false,
  callbackFailureCleanup: false,
  partialStartFailureCleanup: false,
  clock: null,
};
let metadata;
const sql = `WITH samples AS MATERIALIZED (
 SELECT i, clock_timestamp() AS at FROM generate_series(1,200000) AS i
), deltas AS (
 SELECT i, at, extract(epoch FROM at-lag(at) OVER (ORDER BY i))*1000000 AS delta FROM samples
)
SELECT count(*) FILTER (WHERE delta<0)::integer regressions,
 min(delta)::text min_delta_us,
 count(*) FILTER (WHERE at<transaction_timestamp())::integer before_transaction,
 min(extract(epoch FROM at-transaction_timestamp())*1000000)::text min_transaction_delta_us,
 (extract(epoch FROM min(at))*1000000)::bigint::text min_epoch_us
FROM deltas`;
try {
  const returned = await withNativeFinancePostgres(
    async (database, ownership) => {
      metadata = ownership;
      assert.equal(database.host, "127.0.0.1");
      assert.equal(database.database, "fan_support_test");
      assert.match(ownership.serverVersion, /18\.6/u);
      const client = new Client(database);
      await client.connect();
      try {
        assert.equal(
          await realpath(
            (await client.query("SHOW data_directory")).rows[0].data_directory,
          ),
          await realpath(ownership.dataDirectory),
        );
        const clock = {
          durationMilliseconds: 15000,
          samples: 0,
          iterations: 0,
          regressions: 0,
          worstDeltaUs: 0,
          beforeTransaction: 0,
          worstTransactionDeltaUs: 0,
          crossStatementRegressions: 0,
          worstCrossStatementUs: 0,
          nodeSamples: 0,
          nodeRegressions: 0,
        };
        let previous = null,
          nodePrevious = Date.now();
        const timer = setInterval(() => {
          const value = Date.now();
          clock.nodeSamples++;
          if (value < nodePrevious) clock.nodeRegressions++;
          nodePrevious = value;
        }, 1);
        const deadline = performance.now() + clock.durationMilliseconds;
        try {
          while (performance.now() < deadline) {
            await client.query("BEGIN");
            const row = (await client.query(sql)).rows[0];
            const now = (
              await client.query(
                "SELECT (extract(epoch FROM clock_timestamp())*1000000)::bigint::text us",
              )
            ).rows[0].us;
            await client.query("COMMIT");
            clock.samples += 200000;
            clock.iterations++;
            clock.regressions += row.regressions;
            clock.worstDeltaUs = Math.min(
              clock.worstDeltaUs,
              Number(row.min_delta_us),
            );
            clock.beforeTransaction += row.before_transaction;
            clock.worstTransactionDeltaUs = Math.min(
              clock.worstTransactionDeltaUs,
              Number(row.min_transaction_delta_us),
            );
            const delta =
              previous === null
                ? 0
                : Number(BigInt(row.min_epoch_us) - previous);
            if (delta < 0) {
              clock.crossStatementRegressions++;
              clock.worstCrossStatementUs = Math.min(
                clock.worstCrossStatementUs,
                delta,
              );
            }
            previous = BigInt(now);
          }
        } finally {
          clearInterval(timer);
        }
        summary.clock = clock;
        console.log(JSON.stringify({ clock }));
        assert.equal(clock.regressions, 0);
        assert.equal(clock.beforeTransaction, 0);
        assert.equal(clock.crossStatementRegressions, 0);
        assert.equal(clock.nodeRegressions, 0);
        return "owned-native-cluster-verified";
      } finally {
        await client.end();
      }
    },
    options,
  );
  assert.equal(returned, "owned-native-cluster-verified");
  await assert.rejects(access(metadata.directory));
  summary.lifecycle = true;

  let failedMetadata, password;
  await assert.rejects(
    withNativeFinancePostgres(async (database, ownership) => {
      failedMetadata = ownership;
      password = database.password;
      const client = new Client(database);
      await client.connect();
      try {
        assert.equal((await client.query("SELECT 1 AS n")).rows[0].n, 1);
      } finally {
        await client.end();
      }
      throw new Error(password);
    }, options),
    (error) => !error.message.includes(password),
  );
  await assert.rejects(access(failedMetadata.directory));
  summary.callbackFailureCleanup = true;

  let partialDirectory;
  await assert.rejects(
    withNativeFinancePostgres(
      async () => assert.fail("lost start response cannot run callback"),
      {
        ...options,
        run: async (executable, args, executionOptions) => {
          const result = await exec(executable, args, executionOptions);
          if (
            path.basename(executable) === "pg_ctl" &&
            args.includes("start")
          ) {
            partialDirectory = path.dirname(args[args.indexOf("-D") + 1]);
            throw new Error("synthetic-lost-start-response");
          }
          return { stdout: result.stdout };
        },
      },
    ),
  );
  assert.ok(partialDirectory);
  await assert.rejects(access(partialDirectory));
  summary.partialStartFailureCleanup = true;
  console.log(JSON.stringify({ status: "PASS", ...summary }));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "FAIL",
      name: error.name,
      code: error.code ?? null,
      ...summary,
    }),
  );
  process.exitCode = 1;
}
