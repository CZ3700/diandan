import { randomUUID } from "node:crypto";

export async function installResourceAuditFault(client) {
  await client.query(`CREATE FUNCTION http_resource_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.reason_code='HTTP_RESOURCE_ATOMICITY' THEN RAISE EXCEPTION 'synthetic resource audit fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`);
  await client.query(
    "CREATE TRIGGER http_resource_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION http_resource_audit_fault()",
  );
}
export async function removeResourceAuditFault(client) {
  await client.query("DROP TRIGGER http_resource_audit_fault ON audit_logs");
  await client.query("DROP FUNCTION http_resource_audit_fault()");
}
export async function resourceCounts(client) {
  return JSON.stringify(
    (
      await client.query(`SELECT
    (SELECT count(*) FROM audit_logs) AS audit,
    (SELECT count(*) FROM idempotency_records) AS idempotency,
    (SELECT count(*) FROM policies) AS policies,
    (SELECT count(*) FROM policy_registration_receipts) AS policy_receipts,
    (SELECT count(*) FROM media_assets) AS assets,
    (SELECT count(*) FROM media_upload_reservations) AS uploads,
    (SELECT count(*) FROM media_rights_events) AS rights,
    (SELECT count(*) FROM media_processing_jobs) AS jobs,
    (SELECT count(*) FROM media_processing_admin_receipts) AS processing_receipts`)
    ).rows[0],
  );
}
export async function seedResourceSession(
  client,
  fixtures,
  digests,
  short = false,
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at)
    VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,transaction_timestamp()-interval '1 day',date_trunc('milliseconds',transaction_timestamp()) + $5::interval)`,
    [
      id,
      fixtures.editor,
      digests.sessionTokenDigest,
      digests.csrfTokenDigest,
      short ? "45 seconds 789 microseconds" : "1 hour",
    ],
  );
  return id;
}
/** An already expired reservation still uses exact normal audit and immutable ticket constraints. */
export async function seedExpiredResourceUpload(
  client,
  { actorId, sessionId },
) {
  const uploadId = randomUUID(),
    auditId = randomUUID(),
    requestId = randomUUID();
  await client.query("BEGIN");
  try {
    const at = (
      await client.query(
        "SELECT to_char((transaction_timestamp()-interval '120 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0].at;
    await client.query(
      `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
      VALUES($1,'ADMIN',$2,'MEDIA_UPLOAD_BEGIN','MEDIA_UPLOAD_RESERVATION',$3,'HTTP_EXPIRED_UPLOAD',$4,$4,'SUCCEEDED','RESOURCE_MANAGEMENT',$5)`,
      [auditId, actorId, uploadId, requestId, at],
    );
    await client.query(
      `INSERT INTO media_upload_reservations(id,actor_id,session_id,object_key,checksum_sha256,mime_type,byte_size,rights_reference,created_at,expires_at,audit_log_id)
      VALUES($1,$2,$3,$4,$5,'image/jpeg',1,'rights:expired',$6::timestamptz,$6::timestamptz+interval '60 seconds',$7)`,
      [
        uploadId,
        actorId,
        sessionId,
        `uploads/v1/${uploadId}`,
        "a".repeat(64),
        at,
        auditId,
      ],
    );
    await client.query("COMMIT");
    return uploadId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
