import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  adminAccountViewSchema,
  type AdminAccountView,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

// L3-10 ③: shared SQL for built-in accounts. Lock order everywhere: identity, then account, then login.

export const LOCAL_ISSUER = "urn:fan-support:local";
const LOCK_THRESHOLD = 5;
export const text = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export type AuditActor =
  | Readonly<{ type: "ADMIN"; id: string }>
  | Readonly<{
      type: "SYSTEM";
      task: "admin-local-access" | "admin-account-cli";
    }>;

export async function databaseNow(client: TransactionClient): Promise<string> {
  const [row] = await draftRows(
    client,
    `SELECT ${text("clock_timestamp()")} AS now`,
  );
  if (typeof row?.["now"] !== "string") throw new Error("missing clock");
  return row["now"];
}

export async function writeAudit(
  client: TransactionClient,
  input: Readonly<{
    actor: AuditActor;
    action: string;
    subjectType: string;
    subjectId: string;
    reasonCode: string | null;
    requestId: string;
    correlationId: string | null;
    outcome: "SUCCEEDED" | "REJECTED";
    fieldCategory?: string;
    at: string;
  }>,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)`,
    [
      id,
      input.actor.type,
      input.actor.type === "ADMIN" ? input.actor.id : null,
      input.actor.type === "SYSTEM" ? input.actor.task : null,
      input.action,
      input.subjectType,
      input.subjectId,
      input.reasonCode,
      input.requestId,
      input.correlationId,
      input.outcome,
      input.fieldCategory ?? null,
      input.at,
    ],
  );
  return id;
}

/** Locks the account row, then reads it with the database clock taken after the lock was granted. */
export async function lockAccount(
  client: TransactionClient,
  accountId: string,
): Promise<DraftRow | undefined> {
  const [held] = await draftRows(
    client,
    "SELECT id FROM public.admin_local_accounts WHERE id=$1 FOR UPDATE",
    [accountId],
  );
  if (!held) return undefined;
  const [row] = await draftRows(
    client,
    `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
    SELECT a.id,a.admin_identity_id,a.login_name,a.password_hash,a.must_change_password,a.failed_attempts,
      a.locked_until IS NOT NULL AS has_lock,
      coalesce(a.locked_until>instant.now,false) AS locked,
      a.totp_ciphertext,a.totp_last_step,a.totp_pending_ciphertext,
      coalesce(a.totp_pending_expires_at<=instant.now,false) AS pending_expired,
      a.version,${text("instant.now")} AS at
    FROM public.admin_local_accounts a CROSS JOIN instant WHERE a.id=$1`,
    [accountId],
  );
  return row;
}

export async function lockIdentity(
  client: TransactionClient,
  identityId: string,
): Promise<string | undefined> {
  const [row] = await draftRows(
    client,
    "SELECT status FROM public.admin_identities WHERE id=$1 FOR UPDATE",
    [identityId],
  );
  return typeof row?.["status"] === "string" ? row["status"] : undefined;
}

/** Consecutive failures on a locked row; the fifth locks sign-in for 15 minutes and restarts the count. */
export async function recordCredentialFailure(
  client: TransactionClient,
  account: DraftRow,
): Promise<Readonly<{ locked: boolean; justLocked: boolean }>> {
  if (account["locked"] === true) return { locked: true, justLocked: false };
  const previous =
    account["has_lock"] === true ? 0 : Number(account["failed_attempts"]);
  const attempts = previous + 1;
  const lock = attempts >= LOCK_THRESHOLD;
  await client.query(
    `UPDATE public.admin_local_accounts SET failed_attempts=$2,
      locked_until=CASE WHEN $3::boolean THEN $4::timestamptz+interval '15 minutes' ELSE NULL END,
      version=version+1,updated_at=greatest(updated_at,$4::timestamptz) WHERE id=$1`,
    [account["id"], lock ? 0 : attempts, lock, account["at"]],
  );
  return { locked: lock, justLocked: lock };
}

export async function clearCredentialFailures(
  client: TransactionClient,
  account: DraftRow,
): Promise<void> {
  if (Number(account["failed_attempts"]) === 0 && account["has_lock"] !== true)
    return;
  await client.query(
    `UPDATE public.admin_local_accounts SET failed_attempts=0,locked_until=NULL,
      version=version+1,updated_at=greatest(updated_at,$2::timestamptz) WHERE id=$1`,
    [account["id"], account["at"]],
  );
}

/** Revokes live sessions of one identity, one exact audit per session as the 0052 trigger requires. */
export async function revokeIdentitySessions(
  client: TransactionClient,
  input: Readonly<{
    identityId: string;
    exceptSessionId: string | null;
    actor: AuditActor;
    reasonCode:
      | "PASSWORD_CHANGED"
      | "PASSWORD_RESET"
      | "ACCOUNT_SUSPENDED"
      | "SECOND_FACTOR_CHANGED";
    requestId: string;
    correlationId: string;
    at: string;
  }>,
): Promise<number> {
  const revoked = await draftRows(
    client,
    `UPDATE public.admin_sessions SET revoked_at=$3::timestamptz
    WHERE admin_identity_id=$1 AND revoked_at IS NULL AND expires_at>$3::timestamptz AND created_at<=$3::timestamptz
      AND ($2::uuid IS NULL OR id<>$2::uuid) RETURNING id`,
    [input.identityId, input.exceptSessionId, input.at],
  );
  for (const session of revoked)
    await writeAudit(client, {
      actor: input.actor,
      action: "ADMIN_SESSIONS_REVOKED",
      subjectType: "ADMIN_SESSION",
      subjectId: String(session["id"]),
      reasonCode: input.reasonCode,
      requestId: input.requestId,
      correlationId: input.correlationId,
      outcome: "SUCCEEDED",
      at: input.at,
    });
  return revoked.length;
}

export async function revokeRecoveryCodes(
  client: TransactionClient,
  accountId: string,
  at: string,
): Promise<void> {
  await client.query(
    "UPDATE public.admin_local_recovery_codes SET revoked_at=$2::timestamptz WHERE account_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
    [accountId, at],
  );
}

export async function insertRecoveryCodes(
  client: TransactionClient,
  input: Readonly<{
    accountId: string;
    batchId: string;
    digests: readonly string[];
    at: string;
  }>,
): Promise<void> {
  for (const digest of input.digests)
    await client.query(
      "INSERT INTO public.admin_local_recovery_codes(id,account_id,batch_id,code_digest,created_at) VALUES($1,$2,$3,$4,$5::timestamptz)",
      [
        randomUUID(),
        input.accountId,
        input.batchId,
        Buffer.from(digest, "hex"),
        input.at,
      ],
    );
}

/** Same session gate as the platform authorization repository: live, MFA-policy session of an ACTIVE identity. */
export async function authenticateSession(
  client: TransactionClient,
  digests: Readonly<{ sessionTokenDigest: string; csrfTokenDigest: string }>,
): Promise<
  | Readonly<{ actorId: string; sessionId: string }>
  | "UNAUTHENTICATED"
  | "CSRF_INVALID"
> {
  const [session] = await draftRows(
    client,
    `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
    SELECT i.id AS actor_id,s.id AS session_id,s.csrf_token_digest
    FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id CROSS JOIN instant
    WHERE s.session_token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>instant.now
      AND s.created_at<=instant.now AND s.authenticated_with_mfa AND i.status='ACTIVE'
    FOR SHARE OF s,i`,
    [Buffer.from(digests.sessionTokenDigest, "hex")],
  );
  if (!session) return "UNAUTHENTICATED";
  const csrf = session["csrf_token_digest"];
  if (
    !Buffer.isBuffer(csrf) ||
    csrf.length !== 32 ||
    !timingSafeEqual(csrf, Buffer.from(digests.csrfTokenDigest, "hex"))
  )
    return "CSRF_INVALID";
  return {
    actorId: String(session["actor_id"]),
    sessionId: String(session["session_id"]),
  };
}

export async function holdsPermission(
  client: TransactionClient,
  actorId: string,
  permission: string,
): Promise<boolean> {
  const rows = await draftRows(
    client,
    `SELECT ar.role_id FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id
    JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ar.admin_identity_id=$1 AND p.permission_key=$2
      AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
    FOR SHARE OF ar,r,rp,p`,
    [actorId, permission],
  );
  return rows.length > 0;
}

export async function issueSession(
  client: TransactionClient,
  input: Readonly<{
    sessionId: string;
    identityId: string;
    sessionTokenDigest: string;
    csrfTokenDigest: string;
    sessionTtlSeconds: number;
    at: string;
  }>,
): Promise<string> {
  const [session] = await draftRows(
    client,
    `INSERT INTO public.admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,last_seen_at,expires_at)
    VALUES($1,$2,$3,$4,true,$5::timestamptz,$5::timestamptz,$5::timestamptz+$6::integer*interval '1 second')
    RETURNING ${text("expires_at")} AS expires_at`,
    [
      input.sessionId,
      input.identityId,
      Buffer.from(input.sessionTokenDigest, "hex"),
      Buffer.from(input.csrfTokenDigest, "hex"),
      input.at,
      input.sessionTtlSeconds,
    ],
  );
  if (typeof session?.["expires_at"] !== "string")
    throw new Error("session was not issued");
  return session["expires_at"];
}

export async function readAccountView(
  client: TransactionClient,
  accountId: string,
): Promise<AdminAccountView> {
  const [row] = await draftRows(
    client,
    `SELECT a.login_name,a.display_name,a.totp_ciphertext IS NOT NULL AS two_factor,
      ${text("a.password_changed_at")} AS password_changed_at,
      (SELECT count(*) FROM public.admin_local_recovery_codes c
        WHERE c.account_id=a.id AND c.used_at IS NULL AND c.revoked_at IS NULL)::integer AS remaining
    FROM public.admin_local_accounts a WHERE a.id=$1`,
    [accountId],
  );
  if (!row) throw new Error("missing built-in account");
  return adminAccountViewSchema.parse({
    loginName: row["login_name"],
    displayName: row["display_name"],
    twoFactorEnabled: row["two_factor"] === true,
    recoveryCodesRemaining: Number(row["remaining"]),
    passwordChangedAt: row["password_changed_at"],
  });
}
