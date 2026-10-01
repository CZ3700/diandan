// Read-only evidence for a failed journey, taken while the owned TEST instance still runs.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const code = (value) =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value)
    ? value
    : null;
const word = (value) =>
  typeof value === "string" && /^[A-Z][A-Z_]{0,31}$/u.test(value)
    ? value
    : null;
const count = (value) =>
  Number.isSafeInteger(Number(value)) && value !== null ? Number(value) : null;
const flag = (value) => (typeof value === "boolean" ? value : null);
const STATES = new Set([
  "active",
  "idle",
  "idle in transaction",
  "idle in transaction (aborted)",
  "fastpath function call",
  "disabled",
]);
const seconds = (column) => `round(extract(epoch FROM (${column})))::int`;

/** Status-only snapshot of durable work; never intents, payloads, identities or free text. */
export async function snapshotJourneyWork(client) {
  const operations = await client.query(
    `SELECT o.intent->>'kind' AS kind,o.status,o.phase,o.attempt_count,o.failure_code,o.failure_retryable,
      jsonb_array_length(o.checkpoint->'jobs') AS jobs,
      jsonb_typeof(o.checkpoint->'preparedMedia')='object' AS media_prepared,
      (o.checkpoint->>'retryRequested')::boolean AS retry_requested,
      ${seconds("now()-o.created_at")} AS age_s,${seconds("now()-o.updated_at")} AS idle_s,
      ${seconds("o.next_attempt_at-now()")} AS next_attempt_in_s,${seconds("o.lease_expires_at-now()")} AS lease_expires_in_s
    FROM public.management_operations o
    WHERE o.status<>'SUCCEEDED' OR o.updated_at>now()-interval '15 minutes'
    ORDER BY o.created_at DESC LIMIT 20`,
  );
  const jobs = await client.query(
    `SELECT j.role,j.status,j.attempt_count,j.error_code,j.error_retryable,
      ${seconds("now()-j.created_at")} AS age_s,${seconds("now()-j.updated_at")} AS idle_s,
      ${seconds("j.next_attempt_at-now()")} AS next_attempt_in_s,${seconds("j.lease_expires_at-now()")} AS lease_expires_in_s
    FROM public.media_processing_jobs j
    WHERE j.status<>'SUCCEEDED' OR j.updated_at>now()-interval '15 minutes'
    ORDER BY j.created_at DESC LIMIT 20`,
  );
  const connections = await client.query(
    `SELECT state,wait_event_type,count(*)::int AS count FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY 1,2 ORDER BY 1,2`,
  );
  const [locks] = (
    await client.query(
      "SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted",
    )
  ).rows;
  return {
    schemaVersion: 1,
    managementOperations: operations.rows.map((row) => ({
      kind: word(row.kind),
      status: word(row.status),
      phase: word(row.phase),
      attemptCount: count(row.attempt_count),
      failureCode: code(row.failure_code),
      failureRetryable: flag(row.failure_retryable),
      jobs: count(row.jobs),
      mediaPrepared: flag(row.media_prepared),
      retryRequested: flag(row.retry_requested),
      ageSeconds: count(row.age_s),
      idleSeconds: count(row.idle_s),
      nextAttemptInSeconds: count(row.next_attempt_in_s),
      leaseExpiresInSeconds: count(row.lease_expires_in_s),
    })),
    mediaProcessingJobs: jobs.rows.map((row) => ({
      role: word(row.role),
      status: word(row.status),
      attemptCount: count(row.attempt_count),
      errorCode: code(row.error_code),
      errorRetryable: flag(row.error_retryable),
      ageSeconds: count(row.age_s),
      idleSeconds: count(row.idle_s),
      nextAttemptInSeconds: count(row.next_attempt_in_s),
      leaseExpiresInSeconds: count(row.lease_expires_in_s),
    })),
    connections: connections.rows.map((row) => ({
      state: STATES.has(row.state) ? row.state : null,
      waitEventType:
        typeof row.wait_event_type === "string" &&
        /^[A-Za-z]{1,32}$/u.test(row.wait_event_type)
          ? row.wait_event_type
          : null,
      count: count(row.count),
    })),
    waitingLocks: count(locks?.waiting),
  };
}

/** Connects to the owned instance's own database; credentials stay in its local config. */
export async function diagnoseJourneyInstance({ config, output }) {
  const client = new Client({
    host: "127.0.0.1",
    port: config.ports.postgres,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  await client.connect();
  try {
    await writeFile(
      path.join(output, "durable-work.json"),
      JSON.stringify(await snapshotJourneyWork(client), null, 2) + "\n",
    );
  } finally {
    await client.end();
  }
}
