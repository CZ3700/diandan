import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { grantAdminContentLocale } from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";

/** Synthetic identity uses the normal RBAC, session and audited locale tables. */
export async function seedJapaneseReviewer(client, fixtures, digests) {
  const identityId = randomUUID();
  const sessionId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'base-content-http-fixture',$2,'ACTIVE')",
      [identityId, createHash("sha256").update(identityId).digest()],
    );
    await client.query(
      "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) SELECT $1,role_id,$2 FROM admin_identity_roles WHERE admin_identity_id=$3",
      [identityId, fixtures.editor, fixtures.reviewer],
    );
    await client.query(
      "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 hour')",
      [
        sessionId,
        identityId,
        Buffer.from(digests.sessionTokenDigest, "hex"),
        Buffer.from(digests.csrfTokenDigest, "hex"),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  await grantAdminContentLocale(client, {
    adminIdentityId: identityId,
    locale: "ja",
    actorId: fixtures.editor,
  });
  return { identityId, sessionId };
}

/** Normal audit failure proves the whole review/idempotency transaction rolls back. */
export async function installBaseReviewAuditFault(client) {
  await client.query(`CREATE FUNCTION http_base_review_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.reason_code='HTTP_BASE_ATOMICITY' THEN RAISE EXCEPTION 'synthetic base content audit fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$`);
  await client.query(
    "CREATE TRIGGER http_base_review_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION http_base_review_audit_fault()",
  );
}
export async function removeBaseReviewAuditFault(client) {
  await client.query("DROP TRIGGER http_base_review_audit_fault ON audit_logs");
  await client.query("DROP FUNCTION http_base_review_audit_fault()");
}
export async function baseReviewCounts(client) {
  const result = await client.query(`SELECT
    (SELECT count(*) FROM audit_logs) AS audit,
    (SELECT count(*) FROM idempotency_records) AS idempotency,
    (SELECT count(*) FROM base_content_review_receipts) AS receipts,
    (SELECT count(*) FROM idol_translation_reviews) AS idol,
    (SELECT count(*) FROM gift_translation_reviews) AS gift,
    (SELECT count(*) FROM media_metadata_translation_reviews) AS media,
    (SELECT count(*) FROM homepage_translation_reviews) AS homepage,
    (SELECT count(*) FROM policy_translation_reviews) AS policy`);
  return JSON.stringify(result.rows[0]);
}

/** Already elapsed grant history is inserted with exact normal audit; no clocks or guards are changed. */
export async function seedElapsedBasePreview(
  client,
  { sourceGrantId, tokenDigest },
) {
  const grantId = randomUUID(),
    auditId = randomUUID(),
    requestId = randomUUID();
  await client.query("BEGIN");
  try {
    const createdAt = (
      await client.query(
        "SELECT to_char((transaction_timestamp()-interval '120 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0].at;
    await client.query(
      `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
      SELECT $1,'ADMIN',actor_id,'BASE_CONTENT_PREVIEW_ISSUE','BASE_CONTENT_PREVIEW_GRANT',$2,'HTTP_ELAPSED_PREVIEW',$3,$3,'SUCCEEDED','CONTENT_TRANSLATION',$4 FROM base_content_preview_grants WHERE id=$5`,
      [auditId, grantId, requestId, createdAt, sourceGrantId],
    );
    await client.query(
      `INSERT INTO base_content_preview_grants(id,token_digest,idol_revision_id,gift_revision_id,homepage_revision_id,policy_revision_id,media_metadata_revision_id,locale,actor_id,session_id,audit_log_id,created_at,expires_at)
      SELECT $1,decode($2,'hex'),idol_revision_id,gift_revision_id,homepage_revision_id,policy_revision_id,media_metadata_revision_id,locale,actor_id,session_id,$3,$4::timestamptz,$4::timestamptz+interval '60 seconds' FROM base_content_preview_grants WHERE id=$5`,
      [grantId, tokenDigest, auditId, createdAt, sourceGrantId],
    );
    await client.query("COMMIT");
    return grantId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function seedShortBaseSession(client, fixtures, digests) {
  const sessionId = randomUUID();
  await client.query(
    "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,transaction_timestamp()-interval '1 day',date_trunc('milliseconds',transaction_timestamp())+interval '30 seconds 789 microseconds')",
    [
      sessionId,
      fixtures.editor,
      digests.sessionTokenDigest,
      digests.csrfTokenDigest,
    ],
  );
  return sessionId;
}
