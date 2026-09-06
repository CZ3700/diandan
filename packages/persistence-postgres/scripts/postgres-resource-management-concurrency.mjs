import { randomUUID } from "node:crypto";

export async function verifyResourceConcurrency({
  client,
  persistence,
  context,
  equal,
  success,
}) {
  const run = (work) =>
    persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
      work,
    );
  const { command, newJobId, reserve, registration, actor, recipe } = context;
  function oneCommit(results, label) {
    const succeeded = results.filter(
      (result) =>
        result.status === "fulfilled" && result.value.outcome === "SUCCESS",
    );
    equal(succeeded.length, 1, `${label}: exactly one commit`);
    const other = results.find(
      (result) =>
        !(result.status === "fulfilled" && result.value.outcome === "SUCCESS"),
    );
    equal(
      other.status === "rejected"
        ? [
            "TRANSACTION_ABORTED",
            "ALREADY_EXISTS",
            "VERSION_CONFLICT",
          ].includes(other.reason.code)
        : ["STALE_VERSION", "CONFLICT"].includes(other.value.code),
      true,
      `${label}: the loser is an explicit concurrency conflict`,
    );
    return succeeded[0].value;
  }
  const enqueues = await Promise.allSettled(
    [randomUUID(), randomUUID()].map((jobId) =>
      run(({ resources }) =>
        resources.enqueueMedia({
          ...recipe,
          fit: "CONTAIN",
          jobId,
          receiptId: randomUUID(),
          expectedVersion: 0,
          ...actor,
          requestId: randomUUID(),
        }),
      ),
    ),
  );
  const enqueued = enqueues.filter(
    (result) =>
      result.status === "fulfilled" && result.value.outcome === "SUCCESS",
  );
  equal(
    enqueued.length >= 1,
    true,
    "simultaneous same-recipe enqueue commits a canonical job",
  );
  equal(
    enqueues.every((result) =>
      result.status === "rejected"
        ? [
            "TRANSACTION_ABORTED",
            "VERSION_CONFLICT",
            "ALREADY_EXISTS",
          ].includes(result.reason.code)
        : result.value.outcome === "SUCCESS" ||
          result.value.code === "CONFLICT",
    ),
    true,
    "same-recipe enqueue never masks a concurrency conflict as unavailability",
  );
  equal(
    new Set(enqueued.map((result) => result.value.resultId)).size,
    1,
    "successful enqueue replays resolve to one canonical job",
  );
  equal(
    (
      await client.query(
        "SELECT count(*)::integer AS count FROM public.media_processing_jobs WHERE source_asset_id=$1 AND source_metadata_revision_id=$2 AND role=$3 AND fit='CONTAIN' AND generation=1",
        [recipe.sourceAssetId, recipe.metadataRevisionId, recipe.role],
      )
    ).rows[0].count,
    1,
    "simultaneous enqueue creates one generation-one recipe",
  );
  equal(
    (
      await client.query(
        "SELECT count(*)::integer AS count FROM public.media_processing_admin_receipts WHERE job_id=$1 AND action='ENQUEUE'",
        [enqueued[0].value.resultId],
      )
    ).rows[0].count,
    enqueued.length,
    "only successful enqueue transactions retain their audit receipts",
  );
  const rights = await Promise.allSettled(
    ["REJECTED", "EXPIRED"].map((rightsStatus) =>
      run(({ resources }) =>
        resources.setRights({
          schemaVersion: 1,
          assetId: command.assetId,
          expectedVersion: 2,
          rightsStatus,
          evidenceReference: "rights:concurrent",
          eventId: randomUUID(),
          ...actor,
          requestId: randomUUID(),
        }),
      ),
    ),
  );
  oneCommit(rights, "concurrent rights updates");
  equal(
    (
      await client.query(
        "SELECT max(version) AS version,count(*)::integer AS count FROM public.media_rights_events WHERE asset_id=$1",
        [command.assetId],
      )
    ).rows[0],
    { version: 3, count: 3 },
    "rights conflict leaves a contiguous single new event",
  );
  const ticket = await reserve();
  const registrations = await Promise.allSettled(
    [registration(ticket), registration(ticket)].map((value) =>
      run(({ resources }) => resources.registerUpload(value)),
    ),
  );
  const registered = oneCommit(
    registrations,
    "concurrent trusted registration",
  );
  equal(
    (
      await client.query(
        "SELECT count(*)::integer AS count FROM public.media_assets WHERE checksum_sha256=$1 AND identity_kind='SOURCE'",
        [ticket.source.checksumSha256],
      )
    ).rows[0].count,
    1,
    "simultaneous registration creates one canonical original",
  );
  equal(
    (
      await client.query(
        "SELECT registered_asset_id FROM public.media_upload_reservations WHERE id=$1",
        [ticket.uploadId],
      )
    ).rows[0].registered_asset_id,
    registered.resultId,
    "ticket is bound to the winner's canonical identity",
  );
  const retries = await Promise.allSettled(
    [randomUUID(), randomUUID()].map((id) =>
      run(({ resources }) =>
        resources.retryMediaJob({
          schemaVersion: 1,
          jobId: newJobId,
          newJobId: id,
          receiptId: randomUUID(),
          expectedVersion: 0,
          ...actor,
          requestId: randomUUID(),
        }),
      ),
    ),
  );
  const retry = oneCommit(retries, "concurrent manual retries");
  equal(
    (
      await client.query(
        "SELECT count(*)::integer AS count FROM public.media_processing_jobs WHERE retry_of_job_id=$1",
        [newJobId],
      )
    ).rows[0].count,
    1,
    "failed generation has one durable successor",
  );
  equal(
    success(
      await run(({ resources }) =>
        resources.readMediaJob({ schemaVersion: 1, jobId: retry.resultId }),
      ),
      "read concurrent retry winner",
    ).job.generation,
    3,
    "concurrent manual retry advances a single generation",
  );
  return { retryId: retry.resultId };
}

export async function verifyResourceRollback({
  client,
  persistence,
  context,
  equal,
  success,
  retryId,
}) {
  const run = (work) =>
    persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
      work,
    );
  const { reserve, registration, actor, command } = context;
  const ticket = await reserve();
  const policy = {
    schemaVersion: 1,
    policyKey: `atomic-policy-${randomUUID()}`,
    kind: "DELIVERY",
    expectedVersion: 0,
    receiptId: randomUUID(),
    ...actor,
    reasonCode: "RESOURCE_ATOMIC_FAULT",
  };
  const upload = {
    ...registration(ticket),
    reasonCode: "RESOURCE_ATOMIC_FAULT",
  };
  const rights = {
    schemaVersion: 1,
    assetId: command.assetId,
    expectedVersion: 3,
    rightsStatus: "PENDING",
    evidenceReference: "rights:atomic",
    eventId: randomUUID(),
    ...actor,
    reasonCode: "RESOURCE_ATOMIC_FAULT",
  };
  await client.query(
    "UPDATE public.media_processing_jobs SET status='FAILED',next_attempt_at=NULL,error_code='SOURCE_CHANGED',error_retryable=false,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
    [retryId],
  );
  const retry = {
    schemaVersion: 1,
    jobId: retryId,
    newJobId: randomUUID(),
    receiptId: randomUUID(),
    expectedVersion: 0,
    ...actor,
    reasonCode: "RESOURCE_ATOMIC_FAULT",
  };
  const counts = async () =>
    (
      await client.query(
        `SELECT jsonb_build_object('audit',(SELECT count(*) FROM public.audit_logs),'policies',(SELECT count(*) FROM public.policies),'policyReceipts',(SELECT count(*) FROM public.policy_registration_receipts),'uploads',(SELECT count(*) FROM public.media_upload_reservations),'registered',(SELECT count(*) FROM public.media_upload_reservations WHERE status='REGISTERED'),'assets',(SELECT count(*) FROM public.media_assets),'rights',(SELECT count(*) FROM public.media_rights_events),'jobs',(SELECT count(*) FROM public.media_processing_jobs),'processingReceipts',(SELECT count(*) FROM public.media_processing_admin_receipts)) AS value`,
      )
    ).rows[0].value;
  await client.query(`CREATE FUNCTION public.resource_fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='RESOURCE_ATOMIC_FAULT' THEN RAISE EXCEPTION 'injected resource audit failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER resource_fixture_reject_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.resource_fixture_reject_audit()`);
  try {
    for (const [method, value] of [
      ["registerPolicy", policy],
      ["registerUpload", upload],
      ["setRights", rights],
      ["retryMediaJob", retry],
    ]) {
      const before = await counts();
      let rejected = false;
      try {
        await run(({ resources }) => resources[method](value));
      } catch {
        rejected = true;
      }
      equal(rejected, true, `${method} rejects an audit persistence failure`);
      equal(
        await counts(),
        before,
        `${method} rolls back every changed row and audit`,
      );
    }
  } finally {
    await client.query(
      "DROP TRIGGER resource_fixture_reject_audit ON public.audit_logs; DROP FUNCTION public.resource_fixture_reject_audit()",
    );
  }
  for (const [method, value] of [
    ["registerPolicy", policy],
    ["registerUpload", upload],
    ["setRights", rights],
    ["retryMediaJob", retry],
  ])
    success(
      await run(({ resources }) => resources[method](value)),
      `${method} original command succeeds after fault is removed`,
    );
  equal(
    (
      await client.query(
        "SELECT version FROM public.media_upload_reservations WHERE id=$1",
        [ticket.uploadId],
      )
    ).rows[0].version,
    2,
    "failed trusted registration retained its reusable pending ticket",
  );
}
