import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { cartHeaderColumns, cartTimestamp } from "../dist/cart-runtime-data.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const source = await readFile(
  new URL("../src/cart-runtime-repository.ts", import.meta.url),
  "utf8",
);
const sql = [...source.matchAll(/`([^`]+)`/gu)]
  .map((match) => match[1])
  .filter((value) => value.includes("public."))
  .map((value) =>
    value
      .replaceAll("${cartHeaderColumns}", cartHeaderColumns)
      .replace(/\$\{cartTimestamp\("([^"]+)"\)\}/gu, (_match, column) =>
        cartTimestamp(column),
      ),
  );
assert.equal(sql.length, 7, "probe covers every literal cart repository query");
const initialize = sql.find((query) => query.startsWith("WITH instant"));
assert.ok(initialize, "probe extracts the actual initialization statement");
let stage = "MIGRATIONS",
  assertions = 0;
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(configuration);
  await client.connect();
  try {
    stage = "PREPARE_ALL_CART_SQL";
    for (const [index, query] of sql.entries()) {
      await client.query(`PREPARE cart_statement_${index} AS ${query}`);
      assertions++;
    }
    stage = "ACTUAL_CART_INSERT";
    const id = randomUUID();
    const expiresAt = (
      await client.query(
        "SELECT to_char((clock_timestamp()+interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value",
      )
    ).rows[0].value;
    const result = await client.query(initialize, [
      id,
      "a".repeat(64),
      "test-cart-parameter",
      "en",
      "TEST",
      "USD",
      expiresAt,
    ]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, id);
    assert.equal(result.rows[0].expires_at, expiresAt);
    assert.equal(result.rows[0].expired, false);
    assert.equal(result.rows[0].created_at, result.rows[0].updated_at);
    assertions += 5;
    stage = "ACTUAL_EXPIRED_INSERT_REJECTED";
    const expired = await client.query(initialize, [
      randomUUID(),
      "b".repeat(64),
      "test-cart-parameter",
      "en",
      "TEST",
      "USD",
      "2020-01-01T00:00:00.123456Z",
    ]);
    assert.equal(expired.rows.length, 0);
    assert.equal(
      (await client.query("SELECT count(*)::integer count FROM public.carts"))
        .rows[0].count,
      1,
    );
    assertions += 2;
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        scope:
          "Actual repository SQL PostgreSQL parameter inference and cart INSERT; no commerce proof fixture",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        stage,
        sqlState: typeof error.code === "string" ? error.code : null,
      }) + "\n",
    );
    throw new Error("Cart SQL parameter probe failed", { cause: error });
  } finally {
    await client.end();
  }
});
