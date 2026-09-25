import { randomUUID } from "node:crypto";

export async function verifyResourceSqlConstraints({
  client,
  fixtures,
  context,
  equal,
  rejectsSql,
  transaction,
  audit,
}) {
  const { ticket, command, rootId, newJobId, policyKey } = context;
  for (const table of [
    "policy_registration_receipts",
    "media_upload_reservations",
    "media_rights_events",
    "media_processing_admin_receipts",
  ]) {
    await rejectsSql(client, `${table} history cannot be deleted`, () =>
      client.query(`DELETE FROM public.${table}`),
    );
    await rejectsSql(client, `${table} history cannot be truncated`, () =>
      client.query(`TRUNCATE public.${table}`),
    );
  }
  await rejectsSql(client, "registered policy owner cannot be rewritten", () =>
    client.query(
      "UPDATE public.policies SET kind='REFUND' WHERE policy_key=$1",
      [policyKey],
    ),
  );
  await rejectsSql(client, "policy audit receipt cannot be rewritten", () =>
    client.query(
      "UPDATE public.policy_registration_receipts SET field_paths=ARRAY['kind'] WHERE policy_key=$1",
      [policyKey],
    ),
  );
  for (const [column, value] of [
    ["object_key", "uploads/v1/forged"],
    ["checksum_sha256", "a".repeat(64)],
    ["rights_reference", "rights:replacement"],
    ["version", 1],
    ["status", "PENDING"],
  ]) {
    await rejectsSql(client, `completed ticket cannot change ${column}`, () =>
      client.query(
        `UPDATE public.media_upload_reservations SET ${column}=$2 WHERE id=$1`,
        [ticket.uploadId, value],
      ),
    );
  }
  await rejectsSql(
    client,
    "private uploads namespace requires a completed reservation",
    () =>
      client.query(
        `INSERT INTO public.media_assets(id,identity_kind,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference)
    VALUES($1,'SOURCE',$2,'image/png',1600,2000,1000,$3,'PENDING','PENDING','rights:forged')`,
        [randomUUID(), "1".repeat(64), `uploads/v1/${randomUUID()}`],
      ),
  );
  await rejectsSql(
    client,
    "direct asset rights change requires a new exact event",
    () =>
      client.query(
        "UPDATE public.media_assets SET rights_status='REJECTED' WHERE id=$1",
        [command.assetId],
      ),
  );
  await rejectsSql(client, "rights evidence itself is append-only", () =>
    client.query(
      "UPDATE public.media_rights_events SET evidence_reference='rights:forged' WHERE asset_id=$1",
      [command.assetId],
    ),
  );
  const rightsEvent = async (changes = {}) => {
    const eventId = randomUUID();
    const value = {
      assetId: command.assetId,
      version: 3,
      from: "APPROVED",
      to: "APPROVED",
      actorId: fixtures.editor,
      sessionId: fixtures.sessions.editor,
      reference: "rights:new-evidence",
      paths: ["rightsEvidence"],
      ...changes,
    };
    const evidence = await audit(
      client,
      value.actorId,
      value.sessionId,
      "MEDIA_RIGHTS_SET",
      "MEDIA_RIGHTS_EVENT",
      eventId,
    );
    await client.query(
      "INSERT INTO public.media_rights_events(id,asset_id,version,previous_status,new_status,evidence_reference,actor_id,session_id,audit_log_id,created_at,field_paths) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        eventId,
        value.assetId,
        value.version,
        value.from,
        value.to,
        value.reference,
        value.actorId,
        value.sessionId,
        evidence.id,
        value.at ?? evidence.time,
        value.paths,
      ],
    );
  };
  await rejectsSql(client, "rights sequence cannot skip a version", () =>
    rightsEvent({ version: 4 }),
  );
  await rejectsSql(
    client,
    "rights event must use current previous status",
    () =>
      rightsEvent({
        from: "PENDING",
        paths: ["rightsStatus", "rightsEvidence"],
      }),
  );
  await rejectsSql(
    client,
    "rights event must use exact semantic field paths",
    () => rightsEvent({ paths: ["objectKey"] }),
  );
  await rejectsSql(client, "rights event cannot borrow another session", () =>
    rightsEvent({ sessionId: fixtures.sessions.reviewer }),
  );
  await rejectsSql(
    client,
    "read-only material permission cannot change copyright",
    () =>
      rightsEvent({
        actorId: fixtures.reviewer,
        sessionId: fixtures.sessions.reviewer,
      }),
  );
  await rejectsSql(client, "rights evidence rejects capability URLs", () =>
    rightsEvent({ reference: "https://example.invalid/evidence" }),
  );
  await rejectsSql(client, "rights evidence rejects traversal references", () =>
    rightsEvent({ reference: "rights:../private" }),
  );

  const prior = await client.query(
    "SELECT to_jsonb(j.*) AS value FROM public.media_processing_jobs j WHERE id=$1",
    [rootId],
  );
  await rejectsSql(client, "terminal root job remains immutable", () =>
    client.query(
      "UPDATE public.media_processing_jobs SET status='PENDING',completed_at=NULL,error_code=NULL,error_retryable=NULL,next_attempt_at=clock_timestamp() WHERE id=$1",
      [rootId],
    ),
  );
  await rejectsSql(client, "generation identity is immutable", () =>
    client.query(
      "UPDATE public.media_processing_jobs SET generation=3 WHERE id=$1",
      [newJobId],
    ),
  );
  await rejectsSql(client, "processing retry receipt cannot change actor", () =>
    client.query(
      "UPDATE public.media_processing_admin_receipts SET actor_id=$2 WHERE job_id=$1",
      [newJobId, fixtures.reviewer],
    ),
  );
  equal(
    (
      await client.query(
        "SELECT to_jsonb(j.*) AS value FROM public.media_processing_jobs j WHERE id=$1",
        [rootId],
      )
    ).rows[0].value,
    prior.rows[0].value,
    "rejected retries preserve predecessor byte-for-byte row evidence",
  );
  const directRetry = async (changes = {}) => {
    const { parent = newJobId, generation = 3, hash = null, ...rest } = changes;
    await client.query(
      `INSERT INTO public.media_processing_jobs(id,source_asset_id,source_metadata_revision_id,source_checksum_sha256,profile_version,role,fit,focal_x,focal_y,command_hash,requested_by,reason,status,next_attempt_at,created_at,updated_at,generation,retry_of_job_id)
      SELECT $2,source_asset_id,source_metadata_revision_id,source_checksum_sha256,profile_version,role,fit,focal_x,focal_y,COALESCE($4,command_hash),$5,'RESOURCE_FIXTURE','PENDING',clock_timestamp(),GREATEST(transaction_timestamp(),created_at,updated_at,completed_at),GREATEST(transaction_timestamp(),created_at,updated_at,completed_at),$3,id FROM public.media_processing_jobs WHERE id=$1`,
      [parent, rest.id ?? randomUUID(), generation, hash, fixtures.editor],
    );
  };
  await rejectsSql(
    client,
    "pending generation cannot receive a manual successor",
    () => directRetry(),
  );
  await rejectsSql(
    client,
    "root generation cannot acquire a second successor",
    () => directRetry({ parent: rootId, generation: 2 }),
  );
  await transaction(client, () =>
    client.query(
      "UPDATE public.media_processing_jobs SET status='FAILED',next_attempt_at=NULL,error_code='SOURCE_CHANGED',error_retryable=false,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
      [newJobId],
    ),
  );
  await rejectsSql(
    client,
    "new generation cannot skip its immediate predecessor",
    () => directRetry({ generation: 4 }),
  );
  await rejectsSql(
    client,
    "new generation cannot change canonical recipe hash",
    () => directRetry({ hash: "b".repeat(64) }),
  );
  await rejectsSql(
    client,
    "new generation cannot commit without its retry audit receipt",
    () => directRetry(),
  );
  equal(
    (
      await client.query(
        "SELECT count(*)::integer AS count FROM public.media_processing_jobs WHERE retry_of_job_id=$1",
        [newJobId],
      )
    ).rows[0].count,
    0,
    "rejected direct successors leave no jobs behind",
  );
}
