import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { canonicalPublicationValue } from "../../content/dist/publication-manifest-canonical.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";

export async function verifyPublicationClockCases({
  client,
  clientConfig,
  check,
}) {
  for (const value of [
    { focal: 1e-7, text: "中文🎁" },
    { focal: 1e-12, text: "e\u0301" },
    { focal: 0.00001, text: '\u2028\n\\"' },
  ]) {
    const expected = canonicalPublicationValue(value);
    const actual = (
      await client.query(
        "SELECT public.canonical_publication_json($1::jsonb) AS value",
        [expected],
      )
    ).rows[0].value;
    check(
      actual,
      expected,
      "SQL and JavaScript preserve decimal numbers and raw Unicode canonical bytes",
    );
  }
  const boundary = (
    await client.query(`WITH test_instant AS MATERIALIZED(SELECT clock_timestamp() AS now),deadline AS(SELECT now,now-interval '599 seconds' AS created FROM test_instant)
    SELECT LEAST(now+interval '60 seconds',created+interval '10 minutes')=now+interval '1 second' AS clipped,
      now<created+interval '10 minutes' AS active,(now+interval '1 second')>=created+interval '10 minutes' AS expired FROM deadline`)
  ).rows[0];
  check(
    boundary,
    { clipped: true, active: true, expired: true },
    "SQL tail lease truncates to one second and reaches the exact absolute deadline",
  );
  const pending = (
    await client.query(
      "SELECT id FROM public.content_purge_jobs WHERE status='PENDING' AND lease_token IS NULL ORDER BY id LIMIT 1",
    )
  ).rows[0];
  assert.ok(pending, "unclaimed durable job exists");
  let shortLease = true;
  const persistence = createPostgresPersistenceWithPoolFactory(
    clientConfig,
    {},
    (config) => {
      const pool = new Pool(config);
      return {
        end: () => pool.end(),
        on: (event, listener) => pool.on(event, listener),
        off: (event, listener) => pool.off(event, listener),
        connect: async () => {
          const connection = await pool.connect();
          return {
            release: (error) => connection.release(error),
            query: (sql, values) => {
              if (sql.includes("FOR UPDATE OF j SKIP LOCKED")) {
                sql = sql.replace(
                  "WHERE j.status",
                  "WHERE j.id=$1::uuid AND j.status",
                );
                values = [pending.id];
              }
              // Test-only shortening; all real trigger lease, receipt and clock checks remain enabled.
              if (
                shortLease &&
                sql.includes("lease_expires_at=LEAST(clock_timestamp()+$5")
              ) {
                sql = sql.replace(
                  "clock_timestamp()+$5*interval '1 second'",
                  "clock_timestamp()+$5*interval '0.001 second'",
                );
                values = [...values];
                values[4] = 50;
              }
              return connection.query(sql, values);
            },
          };
        },
      };
    },
  );
  const run = (work) =>
    persistence.publicationPurgeTransactionManager.runInPublicationPurgeTransaction(
      work,
    );
  try {
    const first = await run(({ publicationPurge }) =>
      publicationPurge.claim({ schemaVersion: 1, leaseSeconds: 60 }),
    );
    check(
      first.outcome,
      "SUCCESS",
      "normal triggers accept a deliberately shortened test lease",
    );
    assert.ok(first.claim);
    const deadline = performance.now() + 3000;
    for (;;) {
      const expired = (
        await client.query(
          "SELECT lease_expires_at<=clock_timestamp() AS expired FROM public.content_purge_jobs WHERE id=$1",
          [pending.id],
        )
      ).rows[0].expired;
      if (expired) break;
      assert.ok(
        performance.now() < deadline,
        "actual database lease reaches expiry in bounded time",
      );
      await delay(10);
    }
    const result = await run(({ publicationPurge }) =>
      publicationPurge.record({
        schemaVersion: 1,
        jobId: pending.id,
        leaseToken: first.claim.leaseToken,
        expectedVersion: first.claim.version,
        result: { kind: "COMPLETED", purgeReference: "fixture:late" },
      }),
    );
    check(
      result.code,
      "CONFLICT",
      "actual wall-clock expiry fences a late provider completion",
    );
    shortLease = false;
    const recovered = await run(({ publicationPurge }) =>
      publicationPurge.claim({ schemaVersion: 1, leaseSeconds: 60 }),
    );
    check(
      recovered.outcome,
      "SUCCESS",
      "expired durable lease can be claimed after restart",
    );
    assert.ok(recovered.claim);
    check(
      recovered.claim.job.id,
      pending.id,
      "recovery keeps the same durable job and provider idempotency key",
    );
    check(
      recovered.claim.leaseToken !== first.claim.leaseToken,
      true,
      "recovery issues a fresh fencing token",
    );
    check(
      recovered.claim.version,
      first.claim.version + 1,
      "recovery advances exactly one version",
    );
    const completed = await run(({ publicationPurge }) =>
      publicationPurge.record({
        schemaVersion: 1,
        jobId: pending.id,
        leaseToken: recovered.claim.leaseToken,
        expectedVersion: recovered.claim.version,
        result: { kind: "COMPLETED", purgeReference: "fixture:recovered" },
      }),
    );
    check(
      completed.outcome,
      "SUCCESS",
      "only recovered current lease can complete the job",
    );
  } finally {
    await persistence.close();
  }
}
