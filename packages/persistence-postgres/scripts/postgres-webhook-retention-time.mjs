import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const source = await readFile(
  new URL("../src/reliable-event-repositories.ts", import.meta.url),
  "utf8",
);
const statements = [...source.matchAll(/`([^`]+)`/gu)]
  .map((match) => match[1])
  .filter((sql) => sql.includes("/* reliable-event:insert-webhook-payload */"));
assert.equal(statements.length, 1, "one actual payload insertion is covered");
const sql = statements[0];
assert.ok(!sql.includes("${"), "the production statement is fully extracted");

let assertions = 2;
const results = [];
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
const cases = [
  ["APPLICATION_CLOCK_LEADS_20MS", "7 days 20 milliseconds", false, true],
  ["SHORTER_AUTHORIZED_EXPIRY", "1 hour 0.123456 seconds", false, false],
  ["EXACT_DATABASE_RETENTION_LIMIT", "7 days", false, true],
  ["ALREADY_EXPIRED", "-1 second", true, false],
  ["EXACT_CREATION_BOUNDARY", "0 seconds", true, false],
];

try {
  await withEphemeralPostgres(async (clientConfig) => {
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(clientConfig);
    await client.connect();
    try {
      for (const [mode, offset, rejected, capped] of cases) {
        await client.query("BEGIN");
        const id = randomUUID();
        try {
          const authorizedExpiry = (
            await client.query(
              `SELECT to_char((transaction_timestamp()+$1::interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expiry`,
              [offset],
            )
          ).rows[0].expiry;
          const insert = () =>
            client.query(sql, [
              id,
              Buffer.alloc(32, 1),
              Buffer.alloc(32, 2),
              "test-retention-v1",
              "a".repeat(64),
              authorizedExpiry,
            ]);
          if (rejected) {
            await assert.rejects(insert(), {
              code: "23514",
              constraint: "webhook_payloads_retention_check",
            });
            assertions++;
            await client.query("ROLLBACK");
            check(
              (
                await client.query(
                  "SELECT count(*)::integer AS count FROM public.webhook_payloads WHERE id=$1",
                  [id],
                )
              ).rows[0].count,
              0,
              "an expired authorization never creates a retained payload",
            );
          } else {
            check(
              (await insert()).rows,
              [{ id }],
              "actual writer inserts payload",
            );
            check(
              (
                await client.query(
                  `SELECT created_at=transaction_timestamp() AS server_created,
                   retention_expires_at<=created_at+interval '7 days' AS database_limit,
                   retention_expires_at<=$2::timestamptz AS authorized_limit,
                   retention_expires_at>created_at AS unexpired,
                   retention_expires_at=CASE WHEN $3::boolean THEN created_at+interval '7 days' ELSE $2::timestamptz END AS exact_expiry,
                   status='RETAINED' AND payload_ciphertext=$4::bytea AND encrypted_data_key=$5::bytea AND encryption_key_version='test-retention-v1' AND payload_sha256=$6 AS payload_unchanged
                   FROM public.webhook_payloads WHERE id=$1`,
                  [
                    id,
                    authorizedExpiry,
                    capped,
                    Buffer.alloc(32, 1),
                    Buffer.alloc(32, 2),
                    "a".repeat(64),
                  ],
                )
              ).rows[0],
              {
                server_created: true,
                database_limit: true,
                authorized_limit: true,
                unexpired: true,
                exact_expiry: true,
                payload_unchanged: true,
              },
              "stored retention obeys both immutable limits without changing payload or receipt time",
            );
          }
          results.push({ mode, status: "PASS" });
        } catch (error) {
          results.push({
            mode,
            status: "FAIL",
            sqlState: /^[A-Z0-9]{5}$/u.test(error.code ?? "")
              ? error.code
              : null,
            retentionConstraint:
              error.constraint === "webhook_payloads_retention_check",
            ...(error.code === "42883" &&
            /^operator does not exist: [a-z_ ]+ [=<>]+ [a-z_ ]+$/u.test(
              error.message ?? "",
            )
              ? { operatorDiagnostic: error.message }
              : {}),
          });
        } finally {
          await client.query("ROLLBACK");
        }
      }
      check(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM public.webhook_payloads",
          )
        ).rows[0].count,
        0,
        "isolated timing probes leave no durable payload or business fixture",
      );
      process.stdout.write(
        JSON.stringify({
          schemaVersion: 1,
          status: results.every((result) => result.status === "PASS")
            ? "PASS"
            : "FAIL",
          assertions,
          results,
          scope:
            "Actual parameterized production payload INSERT on the fully migrated original PostgreSQL table and triggers; controlled authorization expiry inputs, no sleeps or clock/constraint changes; webhook signature and concurrency use original suites",
        }) + "\n",
      );
      assert.ok(results.every((result) => result.status === "PASS"));
    } finally {
      await client.end();
    }
  });
} catch {
  process.exitCode = 1;
}
