import {
  adminLocalLoginFailureCommandSchema,
  adminLocalLoginProgressSchema,
  adminLocalLoginReadCommandSchema,
  adminLocalLoginReadResponseSchema,
  adminLocalLoginStartCommandSchema,
  adminLocalStepCompleteCommandSchema,
  adminLocalStepReadCommandSchema,
  adminLocalStepReadResponseSchema,
  type AdminLocalAccessFailure,
  type AdminLocalLoginProgress,
  type AdminLocalStepCompleteCommand,
} from "@fan-support/contracts";
import type { AdminLocalLoginRepository } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  clearCredentialFailures,
  databaseNow,
  issueSession,
  lockAccount,
  lockIdentity,
  recordCredentialFailure,
  text,
  writeAudit,
} from "./admin-local-access-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const failure = (
  code: AdminLocalAccessFailure["code"],
): AdminLocalAccessFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
const SYSTEM = { type: "SYSTEM", task: "admin-local-access" } as const;
const MAX_STEP_ATTEMPTS = 5;
type SessionMaterial = Pick<
  AdminLocalStepCompleteCommand,
  | "requestId"
  | "sessionId"
  | "sessionTokenDigest"
  | "csrfTokenDigest"
  | "sessionTtlSeconds"
>;

function nextStep(login: DraftRow, account: DraftRow) {
  if (
    login["needs_second_factor"] === true &&
    login["second_factor"] === "NONE"
  )
    return "SECOND_FACTOR" as const;
  if (
    login["needs_new_password"] === true &&
    account["must_change_password"] === true
  )
    return "NEW_PASSWORD" as const;
  return "NONE" as const;
}

/** Sign-in state machine of ADR-021; every consumed login carries the exact audit its trigger demands. */
export function createAdminLocalLoginRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminLocalLoginRepository {
  const tracked = <T>(work: () => Promise<T>): Promise<T> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  async function reject(
    input: Readonly<{
      loginId: string;
      requestId: string;
      reason:
        | "LOGIN_EXPIRED"
        | "SECOND_FACTOR_FAILED"
        | "ACCOUNT_LOCKED"
        | "ACCESS_DENIED";
      stepAttempts?: number;
    }>,
  ): Promise<void> {
    const at = await databaseNow(client);
    const auditId = await writeAudit(client, {
      actor: SYSTEM,
      action: "ADMIN_LOCAL_LOGIN_REJECTED",
      subjectType: "ADMIN_LOCAL_LOGIN",
      subjectId: input.loginId,
      reasonCode: input.reason,
      requestId: input.requestId,
      correlationId: input.loginId,
      outcome: "REJECTED",
      at,
    });
    await client.query(
      "UPDATE public.admin_local_logins SET state='CONSUMED',completed_at=$2::timestamptz,audit_log_id=$3,step_attempts=coalesce($4::smallint,step_attempts) WHERE id=$1",
      [input.loginId, at, auditId, input.stepAttempts ?? null],
    );
  }
  async function finish(
    input: Readonly<{
      loginId: string;
      identityId: string;
      accountId: string;
      locale: unknown;
      secondFactor: "NONE" | "TOTP" | "RECOVERY_CODE";
      session: SessionMaterial;
    }>,
  ): Promise<AdminLocalLoginProgress> {
    // Taken after the login row exists, so completion never precedes creation.
    const at = await databaseNow(client);
    const expiresAt = await issueSession(client, {
      sessionId: input.session.sessionId,
      identityId: input.identityId,
      sessionTokenDigest: input.session.sessionTokenDigest,
      csrfTokenDigest: input.session.csrfTokenDigest,
      sessionTtlSeconds: input.session.sessionTtlSeconds,
      at,
    });
    const auditId = await writeAudit(client, {
      actor: SYSTEM,
      action: "ADMIN_LOCAL_LOGIN_SUCCEEDED",
      subjectType: "ADMIN_LOCAL_LOGIN",
      subjectId: input.loginId,
      reasonCode:
        input.secondFactor === "TOTP"
          ? "AUTHENTICATED_TOTP"
          : input.secondFactor === "RECOVERY_CODE"
            ? "AUTHENTICATED_RECOVERY_CODE"
            : "AUTHENTICATED_PASSWORD",
      requestId: input.session.requestId,
      correlationId: input.loginId,
      outcome: "SUCCEEDED",
      at,
    });
    await client.query(
      "UPDATE public.admin_local_logins SET state='CONSUMED',second_factor=$2,completed_at=$3::timestamptz,session_id=$4,audit_log_id=$5 WHERE id=$1",
      [input.loginId, input.secondFactor, at, input.session.sessionId, auditId],
    );
    await client.query(
      "UPDATE public.admin_local_accounts SET last_login_at=$2::timestamptz,version=version+1,updated_at=greatest(updated_at,$2::timestamptz) WHERE id=$1",
      [input.accountId, at],
    );
    return adminLocalLoginProgressSchema.parse({
      ...success,
      kind: "SESSION_SAVED",
      expiresAt,
      locale: input.locale,
    });
  }
  return {
    read: (input) =>
      tracked(async () => {
        const parsed = adminLocalLoginReadCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const [row] = await draftRows(
          client,
          `SELECT a.id,a.password_hash,i.status='ACTIVE' AS active,coalesce(a.locked_until>clock_timestamp(),false) AS locked
          FROM public.admin_local_accounts a JOIN public.admin_identities i ON i.id=a.admin_identity_id WHERE a.login_name=$1`,
          [parsed.data.loginName],
        );
        if (!row) return { ...success, kind: "NO_ACCOUNT" };
        return adminLocalLoginReadResponseSchema.parse({
          ...success,
          kind: "LOGIN_ACCOUNT",
          accountId: row["id"],
          passwordHash: row["password_hash"],
          active: row["active"] === true,
          locked: row["locked"] === true,
        });
      }),
    recordFailure: (input) =>
      tracked(async () => {
        const parsed = adminLocalLoginFailureCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const account = await lockAccount(client, parsed.data.accountId);
        if (!account) return failure("INVALID_COMMAND");
        const result = await recordCredentialFailure(client, account);
        await writeAudit(client, {
          actor: SYSTEM,
          action: "ADMIN_LOCAL_LOGIN_REJECTED",
          subjectType: "ADMIN_LOCAL_ACCOUNT",
          subjectId: parsed.data.accountId,
          reasonCode: result.locked ? "ACCOUNT_LOCKED" : "INVALID_PASSWORD",
          requestId: parsed.data.requestId,
          correlationId: null,
          outcome: "REJECTED",
          at: String(account["at"]),
        });
        return { ...success, kind: "FAILURE_RECORDED", locked: result.locked };
      }),
    start: (input) =>
      tracked(async () => {
        const parsed = adminLocalLoginStartCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data;
        const [owner] = await draftRows(
          client,
          "SELECT admin_identity_id FROM public.admin_local_accounts WHERE id=$1",
          [c.accountId],
        );
        if (!owner) return failure("INVALID_CREDENTIALS");
        const identityId = String(owner["admin_identity_id"]);
        const status = await lockIdentity(client, identityId);
        const account = await lockAccount(client, c.accountId);
        if (!account) return failure("INVALID_CREDENTIALS");
        if (account["locked"] === true) return failure("ACCOUNT_LOCKED");
        // A password changed or reset since it was verified is no longer the one presented.
        if (
          status !== "ACTIVE" ||
          account["password_hash"] !== c.verifiedPasswordHash
        )
          return failure("INVALID_CREDENTIALS");
        const needsSecondFactor = account["totp_ciphertext"] !== null;
        // With a second factor bound, only its success completes the sign-in and clears failures.
        if (!needsSecondFactor) await clearCredentialFailures(client, account);
        const needsNewPassword = account["must_change_password"] === true;
        const steps = needsSecondFactor || needsNewPassword;
        const [login] = await draftRows(
          client,
          `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
          INSERT INTO public.admin_local_logins(id,account_id,challenge_digest,locale,needs_second_factor,needs_new_password,created_at,expires_at)
          SELECT $1,$2,$3,$4,$5,$6,now,now+interval '300 seconds' FROM instant
          RETURNING ${text("expires_at")} AS expires_at`,
          [
            c.loginId,
            c.accountId,
            steps ? Buffer.from(c.challengeDigest, "hex") : null,
            c.locale,
            needsSecondFactor,
            needsNewPassword,
          ],
        );
        if (steps)
          return adminLocalLoginProgressSchema.parse({
            ...success,
            kind: "STEP_SAVED",
            step: needsSecondFactor ? "SECOND_FACTOR" : "NEW_PASSWORD",
            expiresAt: login?.["expires_at"],
          });
        return finish({
          loginId: c.loginId,
          identityId,
          accountId: c.accountId,
          locale: c.locale,
          secondFactor: "NONE",
          session: c,
        });
      }),
    readStep: (input) =>
      tracked(async () => {
        const parsed = adminLocalStepReadCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const [row] = await draftRows(
          client,
          `SELECT l.id,l.account_id,l.needs_second_factor,l.needs_new_password,l.second_factor,
            l.expires_at<=clock_timestamp() AS expired,a.login_name,a.password_hash,a.must_change_password,
            a.totp_ciphertext,a.totp_encrypted_data_key,a.totp_key_version,a.totp_last_step
          FROM public.admin_local_logins l JOIN public.admin_local_accounts a ON a.id=l.account_id
          WHERE l.challenge_digest=$1 AND l.state='PENDING'`,
          [Buffer.from(parsed.data.challengeDigest, "hex")],
        );
        if (!row) return failure("LOGIN_RESTART_REQUIRED");
        return adminLocalStepReadResponseSchema.parse({
          ...success,
          kind: "LOGIN_STEP",
          loginId: row["id"],
          accountId: row["account_id"],
          loginName: row["login_name"],
          step: nextStep(row, row),
          expired: row["expired"] === true,
          passwordHash: row["password_hash"],
          totp:
            row["totp_ciphertext"] === null
              ? null
              : {
                  ciphertext: row["totp_ciphertext"],
                  encryptedDataKey: row["totp_encrypted_data_key"],
                  keyVersion: row["totp_key_version"],
                  lastStep:
                    row["totp_last_step"] === null
                      ? null
                      : Number(row["totp_last_step"]),
                },
        });
      }),
    completeStep: (input) =>
      tracked(async () => {
        const parsed = adminLocalStepCompleteCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data,
          outcome = c.outcome;
        const [found] = await draftRows(
          client,
          `SELECT a.id AS account_id,a.admin_identity_id FROM public.admin_local_logins l
          JOIN public.admin_local_accounts a ON a.id=l.account_id WHERE l.challenge_digest=$1 AND l.id=$2`,
          [Buffer.from(c.challengeDigest, "hex"), c.loginId],
        );
        if (!found) return failure("LOGIN_RESTART_REQUIRED");
        const identityId = String(found["admin_identity_id"]);
        const status = await lockIdentity(client, identityId);
        const account = await lockAccount(client, String(found["account_id"]));
        const [login] = await draftRows(
          client,
          `SELECT id,state,locale,needs_second_factor,needs_new_password,second_factor,step_attempts,
            ${text("expires_at")} AS expires_at FROM public.admin_local_logins WHERE id=$1 FOR UPDATE`,
          [c.loginId],
        );
        if (!account || !login || login["state"] !== "PENDING")
          return failure("LOGIN_RESTART_REQUIRED");
        const [clock] = await draftRows(
          client,
          "SELECT expires_at<=clock_timestamp() AS expired FROM public.admin_local_logins WHERE id=$1",
          [c.loginId],
        );
        const base = { loginId: c.loginId, requestId: c.requestId };
        if (clock?.["expired"] === true || outcome.kind === "EXPIRED") {
          await reject({ ...base, reason: "LOGIN_EXPIRED" });
          return failure("LOGIN_RESTART_REQUIRED");
        }
        if (outcome.kind === "RESTART" || status !== "ACTIVE") {
          await reject({ ...base, reason: "ACCESS_DENIED" });
          return failure("LOGIN_RESTART_REQUIRED");
        }
        if (account["locked"] === true) {
          await reject({ ...base, reason: "ACCOUNT_LOCKED" });
          return failure("ACCOUNT_LOCKED");
        }
        const step = nextStep(login, account);
        const expected =
          outcome.kind === "NEW_PASSWORD" ? "NEW_PASSWORD" : "SECOND_FACTOR";
        if (step !== expected) return failure("INVALID_COMMAND");
        let secondFactor = login["second_factor"] as
          "NONE" | "TOTP" | "RECOVERY_CODE";
        let mustChangePassword = account["must_change_password"] === true;
        let accepted = false;
        if (outcome.kind === "TOTP" || outcome.kind === "RECOVERY_CODE") {
          if (
            account["totp_ciphertext"] === null ||
            (outcome.kind === "TOTP" &&
              account["totp_ciphertext"] !== outcome.ciphertext)
          ) {
            // The second factor changed after it was read; this login can never satisfy it.
            await reject({ ...base, reason: "ACCESS_DENIED" });
            return failure("LOGIN_RESTART_REQUIRED");
          }
          if (outcome.kind === "TOTP") {
            const last =
              account["totp_last_step"] === null
                ? null
                : Number(account["totp_last_step"]);
            accepted = last === null || outcome.step > last;
            if (accepted)
              await client.query(
                `UPDATE public.admin_local_accounts SET totp_last_step=$2,failed_attempts=0,locked_until=NULL,
                version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1`,
                [account["id"], outcome.step, account["at"]],
              );
          } else {
            const used = await draftRows(
              client,
              `UPDATE public.admin_local_recovery_codes SET used_at=$3::timestamptz
              WHERE account_id=$1 AND code_digest=$2 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
              [
                account["id"],
                Buffer.from(outcome.codeDigest, "hex"),
                account["at"],
              ],
            );
            accepted = used.length === 1;
            if (accepted) await clearCredentialFailures(client, account);
          }
          if (accepted) secondFactor = outcome.kind;
        } else if (outcome.kind === "NEW_PASSWORD") {
          if (account["password_hash"] !== outcome.previousPasswordHash) {
            await reject({ ...base, reason: "ACCESS_DENIED" });
            return failure("LOGIN_RESTART_REQUIRED");
          }
          await client.query(
            `UPDATE public.admin_local_accounts SET password_hash=$2,password_changed_at=$3::timestamptz,must_change_password=false,
            version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1`,
            [account["id"], outcome.newPasswordHash, account["at"]],
          );
          await writeAudit(client, {
            actor: SYSTEM,
            action: "ADMIN_LOCAL_PASSWORD_CHANGED",
            subjectType: "ADMIN_LOCAL_ACCOUNT",
            subjectId: String(account["id"]),
            reasonCode: "TEMPORARY_PASSWORD_REPLACED",
            requestId: c.requestId,
            correlationId: c.loginId,
            outcome: "SUCCEEDED",
            at: String(account["at"]),
          });
          mustChangePassword = false;
          accepted = true;
        }
        if (!accepted) {
          const attempts = Number(login["step_attempts"]) + 1;
          const counted = await recordCredentialFailure(client, account);
          await writeAudit(client, {
            actor: SYSTEM,
            action: "ADMIN_LOCAL_LOGIN_REJECTED",
            subjectType: "ADMIN_LOCAL_ACCOUNT",
            subjectId: String(account["id"]),
            reasonCode: counted.locked
              ? "ACCOUNT_LOCKED"
              : "SECOND_FACTOR_FAILED",
            requestId: c.requestId,
            correlationId: c.loginId,
            outcome: "REJECTED",
            at: String(account["at"]),
          });
          if (counted.locked) {
            await reject({
              ...base,
              reason: "ACCOUNT_LOCKED",
              stepAttempts: attempts,
            });
            return failure("ACCOUNT_LOCKED");
          }
          if (attempts >= MAX_STEP_ATTEMPTS) {
            await reject({
              ...base,
              reason: "SECOND_FACTOR_FAILED",
              stepAttempts: attempts,
            });
            return failure("LOGIN_RESTART_REQUIRED");
          }
          await client.query(
            "UPDATE public.admin_local_logins SET step_attempts=$2 WHERE id=$1",
            [c.loginId, attempts],
          );
          return failure("INVALID_CODE");
        }
        if (login["needs_new_password"] === true && mustChangePassword) {
          await client.query(
            "UPDATE public.admin_local_logins SET second_factor=$2 WHERE id=$1",
            [c.loginId, secondFactor],
          );
          return adminLocalLoginProgressSchema.parse({
            ...success,
            kind: "STEP_SAVED",
            step: "NEW_PASSWORD",
            expiresAt: login["expires_at"],
          });
        }
        return finish({
          loginId: c.loginId,
          identityId,
          accountId: String(account["id"]),
          locale: login["locale"],
          secondFactor,
          session: c,
        });
      }),
  };
}
