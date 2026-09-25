import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Client, Pool } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createAdminCatalogUseCases } from "../../application/dist/admin-catalog.js";
import { digestAdminContentToken } from "../../application/dist/admin-content-tokens.js";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0;
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(config);
  await client.connect();
  const actorId = randomUUID(),
    roleId = randomUUID(),
    permissionId = randomUUID(),
    sessionId = randomUUID();
  const tokenPepper = randomBytes(32).toString("hex");
  const sessionToken = randomBytes(32).toString("base64url"),
    csrfToken = randomBytes(32).toString("base64url");
  const digest = (purpose, token) =>
    Buffer.from(
      digestAdminContentToken({ tokenPepper, purpose, token }),
      "hex",
    );
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO public.admin_identities(id,issuer,external_subject_hash,status,created_at) VALUES($1,'catalog-time-fixture',$2,'ACTIVE',transaction_timestamp()-interval '10 minutes')",
      [actorId, createHash("sha256").update(actorId).digest()],
    );
    await client.query(
      "INSERT INTO public.roles(id,role_key,description,created_at) VALUES($1,$2,'Synthetic catalog clock verification',transaction_timestamp()-interval '10 minutes')",
      [roleId, `catalog-time:${roleId}`],
    );
    await client.query(
      "INSERT INTO public.permissions(id,permission_key,description,created_at) VALUES($1,'content.edit','Synthetic catalog clock verification',transaction_timestamp()-interval '10 minutes')",
      [permissionId],
    );
    await client.query(
      "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) VALUES($1,$2,$1,transaction_timestamp()-interval '10 minutes')",
      [actorId, roleId],
    );
    await client.query(
      "INSERT INTO public.role_permissions(role_id,permission_id,granted_by,granted_at) VALUES($1,$2,$3,transaction_timestamp()-interval '10 minutes')",
      [roleId, permissionId, actorId],
    );
    for (const locale of SUPPORTED_LOCALES) {
      const auditId = randomUUID(),
        requestId = randomUUID();
      await client.query(
        "INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$2,'CATALOG_TIME_FIXTURE',$3,$3,'SUCCEEDED','CONTENT_TRANSLATION',transaction_timestamp()-interval '10 minutes')",
        [auditId, actorId, requestId],
      );
      await client.query(
        "INSERT INTO public.admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id,granted_at) VALUES($1,$2,$1,$3,transaction_timestamp()-interval '10 minutes')",
        [actorId, locale, auditId],
      );
    }
    await client.query(
      "INSERT INTO public.admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,transaction_timestamp()-interval '10 minutes',transaction_timestamp()+interval '2 hours')",
      [
        sessionId,
        actorId,
        digest("admin-session", sessionToken),
        digest("admin-csrf", csrfToken),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  let mode = "NORMAL",
    observations = 0,
    diagnostic;
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    {},
    (db) => {
      const pool = new Pool(db);
      return {
        end: () => pool.end(),
        on: (...args) => pool.on(...args),
        off: (...args) => pool.off(...args),
        connect: async () => {
          const connection = await pool.connect();
          return {
            release: (destroy) => connection.release(destroy),
            query: async (sql, values) => {
              const text = typeof sql === "string" ? sql : sql.text;
              if (
                mode === "LATE_PERMISSION" &&
                text.startsWith("WITH instant AS MATERIALIZED")
              ) {
                // Real fixture grants become effective after BEGIN, before the real authorization locks them.
                await connection.query(
                  "UPDATE public.admin_identity_roles SET granted_at=clock_timestamp() WHERE admin_identity_id=$1 AND role_id=$2",
                  [actorId, roleId],
                );
                await connection.query(
                  "UPDATE public.role_permissions SET granted_at=clock_timestamp() WHERE role_id=$1 AND permission_id=$2",
                  [roleId, permissionId],
                );
              }
              const selected = text.startsWith(
                "SELECT gen_random_uuid() AS id,gen_random_uuid() AS audit_id,gen_random_uuid() AS idol_id,",
              );
              if (selected) observations++;
              const statement =
                mode === "EVENT_CLOCK" && selected
                  ? text.replace(
                      "GREATEST(clock_timestamp(),",
                      "GREATEST((clock_timestamp()+interval '2 seconds'),",
                    )
                  : text;
              if (text === "COMMIT") {
                if (mode === "EXPIRED_SESSION")
                  await connection.query(
                    "UPDATE public.admin_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
                    [sessionId],
                  );
                const {
                  rows: [proof],
                } = await connection.query(
                  `SELECT
                s.admin_identity_id=$1 AS same_actor,i.status='ACTIVE' AS active_identity,s.authenticated_with_mfa AS mfa,s.revoked_at IS NULL AS unrevoked,
                s.created_at<=clock_timestamp() AS session_started,s.expires_at>clock_timestamp() AS session_current,
                r.created_at>=s.created_at AS event_after_start,r.created_at<s.expires_at AS event_before_expiry,
                r.created_at<=GREATEST(clock_timestamp(),transaction_timestamp(),s.created_at,r.previous_updated_at) AS event_within_bound
                FROM public.admin_idol_identity_receipts r JOIN public.admin_sessions s ON s.id=r.session_id JOIN public.admin_identities i ON i.id=s.admin_identity_id
                WHERE r.actor_id=$1 ORDER BY r.created_at DESC LIMIT 1`,
                  [actorId],
                );
                diagnostic = proof;
              }
              try {
                return await connection.query(
                  statement === text
                    ? sql
                    : typeof sql === "string"
                      ? statement
                      : { ...sql, text: statement },
                  values,
                );
              } catch (error) {
                console.error(
                  JSON.stringify({
                    probe: "CATALOG_IDENTITY_TIME",
                    mode,
                    phase: text === "COMMIT" ? "COMMIT" : "STATEMENT",
                    sqlstate: /^[A-Z0-9]{5}$/u.test(error.code ?? "")
                      ? error.code
                      : "NONE",
                    guard:
                      error.message ===
                      "management operation requires current active MFA session and causal time"
                        ? "CATALOG_SESSION_TIME"
                        : "OTHER",
                    ...(text === "COMMIT" ? { beforeCommit: diagnostic } : {}),
                  }),
                );
                throw error;
              }
            },
          };
        },
      };
    },
  );
  const app = createAdminCatalogUseCases({
    transactions: persistence.adminCatalogTransactionManager,
    tokenPepper,
  });
  const execute = (command) =>
    app.execute({
      schemaVersion: 1,
      requestId: randomUUID(),
      sessionToken,
      csrfToken,
      command: {
        schemaVersion: 1,
        idempotencyKey: randomUUID(),
        reasonCode: "CATALOG_TIME_FIXTURE",
        ...command,
      },
    });
  const count = async () =>
    (
      await client.query(
        "SELECT (SELECT count(*)::integer FROM public.idols) AS idols,(SELECT count(*)::integer FROM public.admin_idol_identity_receipts) AS receipts,(SELECT count(*)::integer FROM public.audit_logs) AS audits,(SELECT count(*)::integer FROM public.idempotency_records) AS idempotency",
      )
    ).rows[0];
  try {
    const normal = await execute({
      action: "CREATE_IDOL",
      handle: "normal-identity",
      expectedBaseVersion: 0,
    });
    equal(
      normal.outcome,
      "SUCCESS",
      "unmodified CREATE passes all real authority and identity guards",
    );
    const before = await count();
    mode = "EVENT_CLOCK";
    observations = 0;
    const shifted = await execute({
      action: "CREATE_IDOL",
      handle: "clock-identity",
      expectedBaseVersion: 0,
    });
    equal(observations, 1, "selects only the identity event observation");
    if (shifted.outcome === "FAILURE") {
      equal(
        await count(),
        before,
        "rejected event rolls back identity receipt audit and idempotency atomically",
      );
      console.log(
        JSON.stringify({
          probe: "CATALOG_IDENTITY_TIME",
          outcome: shifted.outcome,
          beforeCommit: diagnostic,
        }),
      );
    }
    equal(
      shifted.outcome,
      "SUCCESS",
      "an earlier wall clock observation cannot poison the persisted identity event",
    );
    equal(
      Object.values(diagnostic).every(Boolean),
      true,
      "normal session authority and stable event time satisfy every observed predicate",
    );
    mode = "NORMAL";
    const renamed = await execute({
      action: "RENAME_IDOL",
      idolId: shifted.idolId,
      newHandle: "clock-identity-renamed",
      expectedBaseVersion: 1,
    });
    equal(
      renamed.outcome,
      "SUCCESS",
      "rename preserves the exact prior causal identity proof",
    );
    mode = "LATE_PERMISSION";
    const late = await execute({
      action: "CREATE_IDOL",
      handle: "later-permission-identity",
      expectedBaseVersion: 0,
    });
    equal(
      late.outcome,
      "SUCCESS",
      "an actually effective permission granted after transaction start remains usable",
    );
    const {
      rows: [lateProof],
    } = await client.query(
      "SELECT r.created_at>=ar.granted_at AND r.created_at>=rp.granted_at AS covers_history,r.created_at=GREATEST(ar.granted_at,rp.granted_at) AS exact_history FROM public.admin_idol_identity_receipts r JOIN public.admin_identity_roles ar ON ar.admin_identity_id=r.actor_id JOIN public.role_permissions rp ON rp.role_id=ar.role_id WHERE r.id=$1",
      [late.resultId],
    );
    equal(
      lateProof,
      { covers_history: true, exact_history: true },
      "persisted event retains exact effective grant history including microseconds",
    );
    mode = "EXPIRED_SESSION";
    const beforeExpired = await count();
    const expired = await execute({
      action: "CREATE_IDOL",
      handle: "expired-identity",
      expectedBaseVersion: 0,
    });
    equal(
      expired.code,
      "CONTENT_UNAVAILABLE",
      "actual canonical session expiry at commit is still rejected",
    );
    equal(
      await count(),
      beforeExpired,
      "expired operation has no committed business or audit side effects",
    );
    equal(
      diagnostic.session_current,
      false,
      "expiry proof actually observes the canonical session as expired",
    );
    console.log(
      `admin catalog causal time PostgreSQL: ${assertions} assertions PASS (earlier wall clock observation, prior identity, actual canonical expiry; all normal triggers retained)`,
    );
  } finally {
    await persistence.close();
    await client.end();
  }
});
