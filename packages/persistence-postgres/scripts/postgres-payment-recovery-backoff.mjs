#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";

// Audit PAY-01: the exact deferral and reset statements from source, run against one migrated
// recovery row. Only the seed skips triggers; each update passes the real operation guard.
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
async function statement(file, marker) {
  const source = await readFile(
    new URL(`../src/${file}`, import.meta.url),
    "utf8",
  );
  const matches = [
    ...source.matchAll(/`(UPDATE public\.payment_runtime_operations[^`]*)`/gu),
  ]
    .map((match) => match[1])
    .filter((text) => text.includes(marker));
  assert.equal(matches.length, 1, `${file} has one statement with ${marker}`);
  assert.ok(!matches[0].includes("${"), "statement is static SQL");
  return matches[0];
}
const defer = await statement(
  "payment-runtime-recovery.ts",
  "defer_count=defer_count+1",
);
const reconciled = await statement("payment-runtime-recovery.ts", "phase=$2");
const created = await statement(
  "payment-runtime-write.ts",
  "phase='RECONCILE'",
);

await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(config);
  await client.connect();
  const id = randomUUID();
  const observe = async () =>
    (
      await client.query(
        `SELECT defer_count, round(extract(epoch FROM next_attempt_at-clock_timestamp())*1000)::bigint AS wait_ms, last_error_code FROM public.payment_runtime_operations WHERE id=$1`,
        [id],
      )
    ).rows[0];
  const near = (actual, expected, label) =>
    assert.ok(
      Number(actual) <= expected && Number(actual) >= expected - 2000,
      `${label}: waited ${actual} ms, expected about ${expected}`,
    );
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO public.payment_runtime_operations(id,attempt_id,phase,next_attempt_at,request_id,correlation_id,task_name,created_at,updated_at) VALUES($1,$2,'RECONCILE',clock_timestamp(),$3,$4,'payment-recovery-backoff',clock_timestamp(),clock_timestamp())`,
      [id, randomUUID(), randomUUID(), randomUUID()],
    );
    await client.query("COMMIT");
    assert.equal(
      (await observe()).defer_count,
      0,
      "existing rows start at zero",
    );
    const waits = [];
    for (let k = 0; k < 12; k++) {
      await client.query(defer, [id, 10_000, "PROVIDER_QUERY_UNAVAILABLE"]);
      const row = await observe();
      assert.equal(row.defer_count, k + 1, "each deferral counts once");
      assert.equal(row.last_error_code, "PROVIDER_QUERY_UNAVAILABLE");
      near(
        row.wait_ms,
        Math.min(3_600_000, 10_000 * 2 ** Math.min(k, 9)),
        `deferral ${k + 1}`,
      );
      waits.push(Number(row.wait_ms));
    }
    await client.query(reconciled, [id, "RECONCILE", 10_000]);
    const row = await observe();
    assert.equal(row.defer_count, 0, "a recorded reconcile resets the count");
    near(row.wait_ms, 10_000, "reconcile keeps its fixed delay");
    await client.query(defer, [id, 10_000, "PROVIDER_QUERY_UNAVAILABLE"]);
    near(
      (await observe()).wait_ms,
      10_000,
      "the first deferral after a result waits the base delay",
    );
    assert.match(
      created,
      /defer_count=0/u,
      "a settled create also resets the count",
    );
    await assert.rejects(
      client.query(
        "UPDATE public.payment_runtime_operations SET defer_count=-1,version=version+1 WHERE id=$1",
        [id],
      ),
      { code: "23514" },
    );
    console.log(JSON.stringify({ status: "PASS", waits }));
  } finally {
    await client.end();
  }
});
