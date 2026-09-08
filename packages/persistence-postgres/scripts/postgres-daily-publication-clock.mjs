import assert from "node:assert/strict";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { withEphemeralPostgres } from "../dist/testing/ephemeral-postgres.js";

// Exercise the actual reader's clock expression against PostgreSQL in the same
// transaction as a later publication. No fixture proof or database clock is mocked.
const source = await readFile(
  new URL("../src/daily-publication-read.ts", import.meta.url),
  "utf8",
);
const expression = source.match(
  /public\.publication_utc\(([^\n]+?)\) evaluated_at/u,
)?.[1];
assert.ok(expression, "the actual daily reader exposes its evaluated clock");
assert.match(expression, /^(?:transaction_timestamp|clock_timestamp)\(\)$/u);
await withEphemeralPostgres(async (configuration) => {
  const client = new Client(configuration);
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_sleep(0.03)");
    const {
      rows: [publication],
    } = await client.query(
      "SELECT clock_timestamp() published_at, transaction_timestamp() transaction_started",
    );
    const {
      rows: [observation],
    } = await client.query(`SELECT ${expression} evaluated_at`);
    assert.ok(
      publication.published_at > publication.transaction_started,
      "the real publication occurs after this transaction began",
    );
    assert.ok(
      observation.evaluated_at >= publication.published_at,
      "the daily reader must observe a publication written earlier in this same transaction",
    );
    await client.query("ROLLBACK");
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        result: "PASS",
        assertions: 4,
        database: "real isolated PostgreSQL",
        clockExpression: expression,
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        result: "FAIL",
        clockExpression: expression,
        assertion:
          error instanceof assert.AssertionError
            ? error.message
            : "database clock probe failed",
      }) + "\n",
    );
    throw error;
  } finally {
    await client.end();
  }
});
