import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Exercises normal database guards; no trigger disabling or job timestamp rewrites. */
export async function verifyPublicationPurgeCases({
  client,
  persistence,
  publications,
  check,
}) {
  const publicationId = publications.policy.publicationId;
  const jobs = (
    await client.query(
      "SELECT * FROM public.content_purge_jobs WHERE publication_id=$1 ORDER BY locale",
      [publicationId],
    )
  ).rows;
  check(jobs.length, 7, "publication has seven durable locale roots");
  async function rejected(sql, values, label) {
    await client.query("BEGIN");
    let failure;
    try {
      if (typeof sql === "function") await sql();
      else await client.query(sql, values);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    } catch (error) {
      failure = error;
    } finally {
      await client.query("ROLLBACK");
    }
    assert.ok(failure && ["23514", "55000"].includes(failure.code), label);
    check(true, true, label);
  }
  await rejected(
    "UPDATE public.content_purge_jobs SET paths=ARRAY['/*'],version=version+1 WHERE id=$1",
    [jobs[0].id],
    "purge paths cannot be broadened after publication",
  );
  await rejected(
    "UPDATE public.content_purge_jobs SET status='COMPLETED',completed_at=clock_timestamp(),next_attempt_at=NULL,version=version+1,updated_at=clock_timestamp(),purge_reference='forged' WHERE id=$1",
    [jobs[0].id],
    "completion requires a current claim and exact attempt receipt",
  );
  await rejected(
    "UPDATE public.content_purge_jobs SET version=version+1 WHERE id=$1",
    [jobs[0].id],
    "arbitrary version advancement cannot bypass operation evidence",
  );
  await rejected(
    "INSERT INTO public.content_purge_attempts(id,job_id,job_version,lease_token,kind,created_at) VALUES($1,$2,2,$3,'COMPLETED',clock_timestamp())",
    [randomUUID(), jobs[0].id, randomUUID()],
    "unbound purge attempt cannot be inserted",
  );
  await rejected(
    "INSERT INTO public.content_purge_jobs(id,publication_id,outbox_event_id,locale,generation,retry_of,paths,created_at,updated_at,next_attempt_at) SELECT $2,publication_id,outbox_event_id,locale,2,id,paths,clock_timestamp(),clock_timestamp(),clock_timestamp() FROM public.content_purge_jobs WHERE id=$1",
    [jobs[0].id, randomUUID()],
    "pending jobs cannot be manually retried",
  );
  const transact = (work) =>
    persistence.publicationPurgeTransactionManager.runInPublicationPurgeTransaction(
      work,
    );
  const claims = await Promise.all(
    [1, 2].map(() =>
      transact(({ publicationPurge }) =>
        publicationPurge.claim({ schemaVersion: 1, leaseSeconds: 60 }),
      ),
    ),
  );
  for (const result of claims)
    check(result.outcome, "SUCCESS", "concurrent purge claim succeeds");
  const [first, second] = claims.map((result) => result.claim);
  assert.ok(first && second);
  check(
    first.job.id !== second.job.id,
    true,
    "SKIP LOCKED claims different durable jobs",
  );
  await rejected(
    async () => {
      await client.query(
        "UPDATE public.content_purge_jobs SET status='SUBMITTED',purge_reference='fixture:forged-timeout',error_code='PURGE_TIMEOUT',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [first.job.id],
      );
      await client.query(
        "INSERT INTO public.content_purge_attempts(id,job_id,job_version,lease_token,kind,error_code,created_at) SELECT $2,id,version,$3,'TIMEOUT','PURGE_TIMEOUT',updated_at FROM public.content_purge_jobs WHERE id=$1",
        [first.job.id, randomUUID(), first.leaseToken],
      );
    },
    [],
    "timeout cannot remain submitted or bypass the absolute deadline",
  );
  const record = (claim, result, overrides = {}) =>
    transact(({ publicationPurge }) =>
      publicationPurge.record({
        schemaVersion: 1,
        jobId: claim.job.id,
        leaseToken: claim.leaseToken,
        expectedVersion: claim.version,
        result,
        ...overrides,
      }),
    );
  check(
    (
      await record(
        first,
        { kind: "COMPLETED", purgeReference: "fixture:completed" },
        { leaseToken: randomUUID() },
      )
    ).code,
    "CONFLICT",
    "wrong lease token cannot complete a job",
  );
  check(
    (
      await record(
        first,
        { kind: "COMPLETED", purgeReference: "fixture:completed" },
        { expectedVersion: first.version + 1 },
      )
    ).code,
    "CONFLICT",
    "wrong lease version cannot complete a job",
  );
  const completed = await record(first, {
    kind: "COMPLETED",
    purgeReference: "fixture:completed",
  });
  check(
    completed.outcome,
    "SUCCESS",
    "provider completion persists with an attempt",
  );
  check(completed.job.status, "COMPLETED", "completion is terminal");
  check(
    (
      await record(first, {
        kind: "COMPLETED",
        purgeReference: "fixture:completed",
      })
    ).code,
    "CONFLICT",
    "late duplicate completion is fenced",
  );
  const failed = await record(second, {
    kind: "FAILURE",
    code: "ACCESS_DENIED",
    retryable: false,
  });
  check(failed.outcome, "SUCCESS", "terminal provider failure persists");
  check(
    failed.job.status,
    "FAILED",
    "nonretryable provider failure stays failed",
  );
  await rejected(
    "UPDATE public.content_purge_jobs SET status='PENDING',next_attempt_at=clock_timestamp(),error_code=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
    [second.job.id],
    "terminal job cannot be reset in place",
  );
  await rejected(
    "UPDATE public.content_purge_attempts SET kind='PENDING' WHERE job_id=$1",
    [first.job.id],
    "purge attempts are immutable",
  );
  const receipts = (
    await client.query(
      "SELECT job_id,count(*)::integer AS count FROM public.content_purge_attempts WHERE job_id=ANY($1::uuid[]) GROUP BY job_id ORDER BY job_id",
      [[first.job.id, second.job.id]],
    )
  ).rows;
  check(
    receipts.map((row) => row.count),
    [2, 2],
    "each claim and result has exactly one immutable attempt",
  );
}
