import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const beforeMigration = process.argv.includes("--before-migration");
let assertions = 0;
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0027" },
  });
  const client = new Client(configuration);
  await client.connect();
  try {
    if (!beforeMigration)
      await client.query(
        await readFile(
          new URL(
            "../../../database/migrations/0028_order-access.up.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    const insert = `INSERT INTO public.order_access_rate_limits(scope,bucket_digest,pepper_version,request_count,window_started_at,window_expires_at,updated_at) VALUES($1,decode($2,'hex'),$3,$4,'2026-01-01','2026-01-02','2026-01-01')`;
    for (const values of [
      ["EXCHANGE", "a".repeat(64), "test-pepper-v1", 0],
      ["UNKNOWN", "a".repeat(64), "test-pepper-v1", 1],
      ["EXCHANGE", "a".repeat(62), "test-pepper-v1", 1],
      ["EXCHANGE", "a".repeat(64), "../bad", 1],
    ]) {
      await assert.rejects(client.query(insert, values), { code: "23514" });
      assertions++;
    }
    await client.query(insert, [
      "EXCHANGE",
      "a".repeat(64),
      "test-pepper-v1",
      1,
    ]);
    assertions++;
    await assert.rejects(
      client.query(insert, ["EXCHANGE", "a".repeat(64), "test-pepper-v1", 2]),
      { code: "23505" },
    );
    assertions++;
    await assert.rejects(
      client.query(
        "UPDATE public.order_access_rate_limits SET window_expires_at=window_started_at",
      ),
      { code: "23514" },
    );
    assertions++;
    await assert.rejects(client.query("TRUNCATE public.order_access_audits"), {
      code: "55000",
    });
    assertions++;
    await assert.rejects(
      client.query(
        await readFile(
          new URL(
            "../../../database/migrations/0028_order-access.down.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
      { code: "55000" },
    );
    assertions++;
    assert.equal(
      (
        await client.query(
          "SELECT request_count FROM public.order_access_rate_limits",
        )
      ).rows[0].request_count,
      1,
    );
    assertions++;
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        scope:
          "Actual PostgreSQL constraints and populated rate-limit rollback refusal; order-backed lifecycle and audit atomicity use the HTTP protocol",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        assertions,
        actualSqlState: error.actual?.code ?? error.code ?? null,
        expectedSqlState: error.expected?.code ?? null,
      }) + "\n",
    );
    throw error;
  } finally {
    await client.end();
  }
});
