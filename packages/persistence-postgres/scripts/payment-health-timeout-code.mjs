import assert from "node:assert/strict";
import { Client } from "pg";
import { withEphemeralPostgres } from "../dist/index.js";
await withEphemeralPostgres(async (config) => {
  const client = new Client(config);
  client.on("error", () => undefined);
  await client.connect();
  let observed;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL transaction_timeout='100ms'");
    try {
      await client.query("SELECT pg_sleep(1)");
    } catch (error) {
      observed = error.code;
    }
    assert.equal(observed, "25P04");
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        outcome: "PASS",
        scope: "actual PostgreSQL transaction_timeout SQLSTATE",
        code: observed,
      }),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}).catch(() => {
  process.exitCode = 1;
});
