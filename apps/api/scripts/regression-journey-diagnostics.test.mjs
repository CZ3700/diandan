import assert from "node:assert/strict";
import test from "node:test";
const module = await import("./regression-journey-diagnostics.mjs").catch(
  () => ({}),
);

function fakeClient(rowsByTable) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      const table = Object.keys(rowsByTable).find((name) => sql.includes(name));
      return { rows: table ? rowsByTable[table] : [] };
    },
  };
}

test("journey work snapshot keeps only status fields of durable work", async () => {
  assert.equal(typeof module.snapshotJourneyWork, "function");
  const client = fakeClient({
    management_operations: [
      {
        kind: "SAVE_GIFT",
        status: "RUNNING",
        phase: "PREPARE_MEDIA",
        attempt_count: 2,
        failure_code: null,
        failure_retryable: null,
        jobs: 1,
        media_prepared: false,
        retry_requested: false,
        age_s: 190,
        idle_s: 185,
        next_attempt_in_s: null,
        lease_expires_in_s: 110,
        intent: { title: "PRIVATE_CANARY" },
      },
    ],
    media_processing_jobs: [
      {
        role: "GIFT_PRIMARY",
        status: "FAILED",
        attempt_count: 6,
        error_code: "STORAGE_UNAVAILABLE",
        error_retryable: true,
        age_s: 190,
        idle_s: 20,
        next_attempt_in_s: null,
        lease_expires_in_s: null,
        reason: "PRIVATE_CANARY",
      },
    ],
    pg_stat_activity: [
      { state: "idle in transaction", wait_event_type: "Lock", count: 1 },
      { state: "PRIVATE_CANARY state", wait_event_type: null, count: 2 },
    ],
    pg_locks: [{ waiting: 1 }],
  });
  const snapshot = await module.snapshotJourneyWork(client);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /PRIVATE_CANARY|intent|reason/u,
  );
  assert.deepEqual(snapshot.managementOperations[0], {
    kind: "SAVE_GIFT",
    status: "RUNNING",
    phase: "PREPARE_MEDIA",
    attemptCount: 2,
    failureCode: null,
    failureRetryable: null,
    jobs: 1,
    mediaPrepared: false,
    retryRequested: false,
    ageSeconds: 190,
    idleSeconds: 185,
    nextAttemptInSeconds: null,
    leaseExpiresInSeconds: 110,
  });
  assert.equal(
    snapshot.mediaProcessingJobs[0].errorCode,
    "STORAGE_UNAVAILABLE",
  );
  assert.deepEqual(snapshot.connections, [
    { state: "idle in transaction", waitEventType: "Lock", count: 1 },
    { state: null, waitEventType: null, count: 2 },
  ]);
  assert.equal(snapshot.waitingLocks, 1);
  // Read-only: no statement may change the retained instance.
  for (const sql of client.queries)
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/iu,
    );
});
