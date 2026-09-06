import { randomUUID, randomBytes } from "node:crypto";

export async function verifyResourceRepositoryCases({
  client,
  persistence,
  fixtures,
  equal,
  success,
}) {
  const run = (work) =>
    persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
      work,
    );
  const actor = {
    actorId: fixtures.editor,
    sessionId: fixtures.sessions.editor,
    reasonCode: "RESOURCE_FIXTURE",
    requestId: randomUUID(),
  };
  const reserve = async (changes = {}) => {
    const uploadId = randomUUID();
    const clock = (
      await client.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
      to_char((clock_timestamp()+interval '600 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at`)
    ).rows[0];
    return success(
      await run(({ resources }) =>
        resources.reserveUpload({
          schemaVersion: 1,
          uploadId,
          objectKey: `uploads/v1/${uploadId}`,
          checksumSha256: randomBytes(32).toString("hex"),
          mimeType: "image/png",
          byteSize: 1000,
          rightsReference: "rights:fixture-original",
          createdAt: clock.created_at,
          expiresAt: clock.expires_at,
          expectedVersion: 0,
          ...actor,
          ...changes,
        }),
      ),
      "reserve private upload",
    ).value;
  };
  const registration = (ticket, changes = {}) => ({
    schemaVersion: 1,
    uploadId: ticket.uploadId,
    assetId: randomUUID(),
    expectedVersion: 1,
    receipt: {
      schemaVersion: 1,
      profileVersion: 1,
      source: ticket.source,
      width: 1600,
      height: 2000,
      orientation: 1,
    },
    ...actor,
    ...changes,
  });
  const readUpload = (ticket, changes = {}) =>
    run(({ resources }) =>
      resources.readUpload({
        schemaVersion: 1,
        uploadId: ticket.uploadId,
        actorId: actor.actorId,
        sessionId: actor.sessionId,
        ...changes,
      }),
    );
  const policyKey = `resource-api-${randomUUID()}`,
    receiptId = randomUUID();
  const policy = success(
    await run(({ resources }) =>
      resources.registerPolicy({
        schemaVersion: 1,
        policyKey,
        kind: "DELIVERY",
        expectedVersion: 0,
        receiptId,
        ...actor,
      }),
    ),
    "register policy owner",
  );
  equal(
    policy.resultId,
    receiptId,
    "policy mutation exposes the UUID receipt reference",
  );
  const policyRead = success(
    await run(({ resources }) =>
      resources.readPolicy({ schemaVersion: 1, policyKey }),
    ),
    "read registered policy",
  );
  equal(
    policyRead.policy.kind,
    "DELIVERY",
    "registered owner is canonically typed",
  );
  equal(
    (
      await run(({ resources }) =>
        resources.registerPolicy({
          schemaVersion: 1,
          policyKey,
          kind: "REFUND",
          expectedVersion: 0,
          receiptId: randomUUID(),
          ...actor,
        }),
      )
    ).code,
    "ALREADY_EXISTS",
    "existing policy kind cannot be rewritten",
  );

  const ticket = await reserve();
  equal(ticket.status, "PENDING", "reservation begins pending");
  equal(ticket.version, 1, "reservation starts at version one");
  equal(
    (
      await readUpload(ticket, {
        actorId: fixtures.reviewer,
        sessionId: fixtures.sessions.reviewer,
      })
    ).code,
    "NOT_FOUND",
    "ticket cannot cross administrator scope",
  );
  equal(
    (await readUpload(ticket, { sessionId: fixtures.sessions.reviewer })).code,
    "NOT_FOUND",
    "ticket cannot cross session scope",
  );
  const command = registration(ticket);
  equal(
    (
      await run(({ resources }) =>
        resources.registerUpload({
          ...command,
          receipt: {
            ...command.receipt,
            source: { ...ticket.source, checksumSha256: "f".repeat(64) },
          },
        }),
      )
    ).code,
    "INVALID_CONTENT",
    "caller cannot register a mismatching byte receipt",
  );
  const registered = success(
    await run(({ resources }) => resources.registerUpload(command)),
    "register verified original",
  );
  equal(
    registered.resultId,
    command.assetId,
    "new source has its reserved canonical UUID",
  );
  const completed = success(
    await readUpload(ticket),
    "read completed upload",
  ).value;
  equal(completed.version, 2, "completed upload advances exactly once");
  equal(
    completed.assetId,
    command.assetId,
    "ticket holds canonical source reference",
  );
  equal(
    (await run(({ resources }) => resources.registerUpload(command))).code,
    "STALE_VERSION",
    "direct second completion cannot append another registration",
  );
  const media = success(
    await run(({ resources }) =>
      resources.readMedia({ schemaVersion: 1, assetId: command.assetId }),
    ),
    "read registered media",
  ).media;
  equal(
    media.identityKind,
    "SOURCE",
    "uploaded bytes never impersonate generated masters",
  );
  equal(
    media.processingStatus,
    "PENDING",
    "source registration does not complete role processing",
  );
  equal(
    media.rightsStatus,
    "PENDING",
    "source registration cannot approve rights",
  );
  equal(
    media.rightsVersion,
    0,
    "unreviewed source has no fabricated rights events",
  );
  equal(
    Object.hasOwn(media, "objectKey"),
    false,
    "ordinary media read does not disclose private object keys",
  );
  const prior = (
    await client.query(
      "SELECT to_jsonb(a.*) AS value FROM public.media_assets a WHERE id=$1",
      [command.assetId],
    )
  ).rows[0].value;
  const duplicate = await reserve({
    checksumSha256: ticket.source.checksumSha256,
    rightsReference: "rights:second-upload",
  });
  equal(
    success(
      await run(({ resources }) =>
        resources.registerUpload(registration(duplicate)),
      ),
      "register duplicate bytes",
    ).resultId,
    command.assetId,
    "validated duplicate source resolves to existing identity",
  );
  equal(
    (
      await client.query(
        "SELECT to_jsonb(a.*) AS value FROM public.media_assets a WHERE id=$1",
        [command.assetId],
      )
    ).rows[0].value,
    prior,
    "deduplication preserves the complete old source identity and rights",
  );

  const rights = (version, status, evidenceReference = "rights:confirmed") =>
    run(({ resources }) =>
      resources.setRights({
        schemaVersion: 1,
        assetId: command.assetId,
        expectedVersion: version,
        rightsStatus: status,
        evidenceReference,
        eventId: randomUUID(),
        ...actor,
        requestId: randomUUID(),
      }),
    );
  success(await rights(0, "APPROVED"), "approve source rights");
  success(
    await rights(1, "APPROVED", "rights:replacement"),
    "append replacement rights evidence with same status",
  );
  equal(
    success(
      await run(({ resources }) =>
        resources.readMedia({ schemaVersion: 1, assetId: command.assetId }),
      ),
      "read updated rights",
    ).media.rightsVersion,
    2,
    "same-status evidence advances continuous rights version",
  );
  equal(
    (await rights(0, "REJECTED")).code,
    "STALE_VERSION",
    "old rights version cannot replace current approval",
  );
  equal(
    (
      await client.query(
        "SELECT rights_reference FROM public.media_assets WHERE id=$1",
        [command.assetId],
      )
    ).rows[0].rights_reference,
    "rights:fixture-original",
    "new evidence never changes original immutable rights reference",
  );

  const source = fixtures.catalog.media[0];
  const rootId = "f0000000-0000-4000-8000-000000000001",
    newJobId = "00000000-0000-4000-8000-000000000002";
  const recipe = {
    schemaVersion: 1,
    sourceAssetId: source.assetId,
    metadataRevisionId: source.revisionId,
    role: "PORTRAIT",
    fit: "COVER",
  };
  success(
    await run(({ resources }) =>
      resources.enqueueMedia({
        ...recipe,
        jobId: rootId,
        receiptId: randomUUID(),
        expectedVersion: 0,
        ...actor,
      }),
    ),
    "enqueue generation one",
  );
  const worker = (work) =>
    persistence.mediaProcessingTransactionManager.runInMediaProcessingTransaction(
      work,
    );
  const claim = success(
    await worker(({ mediaProcessing }) =>
      mediaProcessing.claim({
        schemaVersion: 1,
        leaseToken: randomUUID(),
        leaseSeconds: 60,
      }),
    ),
    "claim root processing job",
  ).value;
  equal(claim.jobId, rootId, "worker selects the root job");
  success(
    await worker(({ mediaProcessing }) =>
      mediaProcessing.fail({
        schemaVersion: 1,
        jobId: rootId,
        leaseToken: claim.leaseToken,
        error: { code: "INVALID_IMAGE", retryable: false },
      }),
    ),
    "preserve terminal root failure",
  );
  const terminal = (
    await client.query(
      "SELECT to_jsonb(j.*) AS value FROM public.media_processing_jobs j WHERE id=$1",
      [rootId],
    )
  ).rows[0].value;
  const retried = success(
    await run(({ resources }) =>
      resources.retryMediaJob({
        schemaVersion: 1,
        jobId: rootId,
        newJobId,
        receiptId: randomUUID(),
        expectedVersion: 1,
        ...actor,
      }),
    ),
    "audited manual retry",
  );
  equal(retried.resultId, newJobId, "manual retry creates a new job identity");
  equal(
    (
      await client.query(
        "SELECT to_jsonb(j.*) AS value FROM public.media_processing_jobs j WHERE id=$1",
        [rootId],
      )
    ).rows[0].value,
    terminal,
    "manual retry does not modify terminal predecessor",
  );
  const next = success(
    await run(({ resources }) =>
      resources.readMediaJob({ schemaVersion: 1, jobId: newJobId }),
    ),
    "read manual retry generation",
  ).job;
  equal(next.generation, 2, "manual retry advances exactly one generation");
  equal(next.retryOfJobId, rootId, "manual retry keeps exact predecessor FK");
  equal(
    next.snapshot.attemptCount,
    0,
    "new generation begins its own bounded attempts",
  );
  const ordinary = success(
    await worker(({ mediaProcessing }) =>
      mediaProcessing.enqueue({
        ...recipe,
        jobId: randomUUID(),
        requestedBy: fixtures.editor,
        reason: "RESOURCE_FIXTURE",
      }),
    ),
    "legacy ordinary enqueue after manual retry",
  );
  equal(
    ordinary.value.jobId,
    rootId,
    "ordinary enqueue always deduplicates generation one even when successor UUID sorts first",
  );
  return {
    ticket,
    command,
    rootId,
    newJobId,
    policyKey,
    reserve,
    registration,
    actor,
    recipe,
  };
}
