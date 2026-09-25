import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createAdminCatalogUseCases } from "../../application/dist/admin-catalog.js";
import { digestAdminContentToken } from "../../application/dist/admin-content-tokens.js";

/** Adds a real current-session operator to an existing legacy catalog fixture. */
export async function seedAdminCatalogOperator(client, persistence, actorId) {
  const tokenPepper = randomBytes(32).toString("hex");
  const credentials = {
    sessionToken: randomBytes(32).toString("base64url"),
    csrfToken: randomBytes(32).toString("base64url"),
  };
  const roleId = randomUUID(),
    sessionId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Catalog operator fixture')",
      [roleId, `catalog-operator:${roleId}`],
    );
    for (const key of ["content.read", "content.edit"]) {
      const existing = await client.query(
        "SELECT id FROM permissions WHERE permission_key=$1",
        [key],
      );
      const id = existing.rows[0]?.id ?? randomUUID();
      if (!existing.rows[0])
        await client.query(
          "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Catalog permission fixture')",
          [id, key],
        );
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
        [roleId, id, actorId],
      );
    }
    await client.query(
      "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$1)",
      [actorId, roleId],
    );
    for (const locale of SUPPORTED_LOCALES) {
      const prior = await client.query(
        "SELECT id FROM admin_content_locale_grants WHERE admin_identity_id=$1 AND locale=$2 AND revoked_at IS NULL",
        [actorId, locale],
      );
      if (prior.rows.length) continue;
      const auditId = randomUUID(),
        requestId = randomUUID();
      await client.query(
        "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$2,'CATALOG_FIXTURE',$3,$3,'SUCCEEDED','CONTENT_TRANSLATION')",
        [auditId, actorId, requestId],
      );
      await client.query(
        "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$1,$3)",
        [actorId, locale, auditId],
      );
    }
    const digest = (purpose, token) =>
      Buffer.from(
        digestAdminContentToken({ tokenPepper, purpose, token }),
        "hex",
      );
    await client.query(
      "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 hour')",
      [
        sessionId,
        actorId,
        digest("admin-session", credentials.sessionToken),
        digest("admin-csrf", credentials.csrfToken),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  // A positive fixture begins only once its actual DB permission history is effective.
  const started = performance.now();
  while (true) {
    const ready = await client.query(
      "SELECT clock_timestamp()>=GREATEST((SELECT max(granted_at) FROM admin_identity_roles WHERE admin_identity_id=$1),(SELECT max(granted_at) FROM role_permissions WHERE role_id=$2),(SELECT max(granted_at) FROM admin_content_locale_grants WHERE admin_identity_id=$1 AND revoked_at IS NULL)) AS ready",
      [actorId, roleId],
    );
    if (ready.rows[0].ready) break;
    assert.ok(
      performance.now() - started < 5000,
      "catalog fixture grants become effective within a bounded interval",
    );
    await delay(5);
  }
  const app = createAdminCatalogUseCases({
    transactions: persistence.adminCatalogTransactionManager,
    tokenPepper,
  });
  return async (command) => {
    const result = await app.execute({
      schemaVersion: 1,
      requestId: randomUUID(),
      ...credentials,
      command: {
        schemaVersion: 1,
        idempotencyKey: randomUUID(),
        reasonCode: "CATALOG_FIXTURE",
        ...command,
      },
    });
    assert.equal(
      result.outcome,
      "SUCCESS",
      `audited catalog fixture: ${result.code ?? "unexpected result"}`,
    );
    return result;
  };
}
