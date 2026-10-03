import {
  adminLocalAccountFailureCommandSchema,
  adminLocalAccountReadCommandSchema,
  adminLocalAccountReadResponseSchema,
  adminLocalAccountUpdateCommandSchema,
  adminLocalAccountUpdateResponseSchema,
  type AdminAccountFailure,
} from "@fan-support/contracts";
import type { AdminLocalAccountRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  authenticateSession,
  insertRecoveryCodes,
  lockAccount,
  readAccountView,
  recordCredentialFailure,
  revokeIdentitySessions,
  revokeRecoveryCodes,
  text,
  writeAudit,
} from "./admin-local-access-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const failure = (code: AdminAccountFailure["code"]): AdminAccountFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;

/** The signed-in account's own settings; the session must belong to the account it changes. */
export function createAdminLocalAccountRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminLocalAccountRepository {
  const tracked = <T>(work: () => Promise<T>): Promise<T> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  async function owned(
    digests: Readonly<{ sessionTokenDigest: string; csrfTokenDigest: string }>,
    accountId: string,
  ) {
    const session = await authenticateSession(client, digests);
    if (typeof session === "string") return session;
    const [row] = await draftRows(
      client,
      "SELECT id FROM public.admin_local_accounts WHERE id=$1 AND admin_identity_id=$2",
      [accountId, session.actorId],
    );
    return row ? session : ("UNAUTHENTICATED" as const);
  }
  return {
    read: (input) =>
      tracked(async () => {
        const parsed = adminLocalAccountReadCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const session = await authenticateSession(client, parsed.data);
        if (typeof session === "string") return failure(session);
        const [row] = await draftRows(
          client,
          `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
          SELECT a.id,a.password_hash,coalesce(a.locked_until>instant.now,false) AS locked,
            a.totp_ciphertext,a.totp_encrypted_data_key,a.totp_key_version,a.totp_last_step,
            a.totp_pending_ciphertext,a.totp_pending_encrypted_data_key,a.totp_pending_key_version,
            coalesce(a.totp_pending_expires_at<=instant.now,false) AS pending_expired
          FROM public.admin_local_accounts a CROSS JOIN instant WHERE a.admin_identity_id=$1`,
          [session.actorId],
        );
        if (!row) return { ...success, kind: "NOT_LOCAL" };
        return adminLocalAccountReadResponseSchema.parse({
          ...success,
          kind: "ACCOUNT_STATE",
          accountId: row["id"],
          account: await readAccountView(client, String(row["id"])),
          passwordHash: row["password_hash"],
          locked: row["locked"] === true,
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
          pending:
            row["totp_pending_ciphertext"] === null
              ? null
              : {
                  ciphertext: row["totp_pending_ciphertext"],
                  encryptedDataKey: row["totp_pending_encrypted_data_key"],
                  keyVersion: row["totp_pending_key_version"],
                  expired: row["pending_expired"] === true,
                },
        });
      }),
    recordFailure: (input) =>
      tracked(async () => {
        const parsed = adminLocalAccountFailureCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data;
        const session = await owned(c, c.accountId);
        if (typeof session === "string") return failure(session);
        const account = await lockAccount(client, c.accountId);
        if (!account) return failure("UNAUTHENTICATED");
        const result = await recordCredentialFailure(client, account);
        await writeAudit(client, {
          actor: { type: "ADMIN", id: session.actorId },
          action: "ADMIN_LOCAL_ACCOUNT_VERIFICATION_FAILED",
          subjectType: "ADMIN_LOCAL_ACCOUNT",
          subjectId: c.accountId,
          reasonCode: result.locked ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIAL",
          requestId: c.requestId,
          correlationId: session.sessionId,
          outcome: "REJECTED",
          at: String(account["at"]),
        });
        return { ...success, kind: "FAILURE_RECORDED", locked: result.locked };
      }),
    update: (input) =>
      tracked(async () => {
        const parsed = adminLocalAccountUpdateCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data,
          change = c.change;
        const session = await owned(c, c.accountId);
        if (typeof session === "string") return failure(session);
        const account = await lockAccount(client, c.accountId);
        if (!account) return failure("UNAUTHENTICATED");
        const at = String(account["at"]);
        const actor = { type: "ADMIN", id: session.actorId } as const;
        const audit = (action: string, reasonCode: string | null = null) =>
          writeAudit(client, {
            actor,
            action,
            subjectType: "ADMIN_LOCAL_ACCOUNT",
            subjectId: c.accountId,
            reasonCode,
            requestId: c.requestId,
            correlationId: session.sessionId,
            outcome: "SUCCEEDED",
            at,
          });
        const revokeOthers = (
          reasonCode: "PASSWORD_CHANGED" | "SECOND_FACTOR_CHANGED",
        ) =>
          revokeIdentitySessions(client, {
            identityId: session.actorId,
            exceptSessionId: session.sessionId,
            actor,
            reasonCode,
            requestId: c.requestId,
            correlationId: c.accountId,
            at,
          });
        if (change.kind !== "CONFIRM_TOTP") {
          if (account["locked"] === true) return failure("ACCOUNT_LOCKED");
          // Changed since verification: the password presented is no longer current.
          if (account["password_hash"] !== change.previousPasswordHash)
            return failure("INVALID_PASSWORD");
        }
        const enabled = account["totp_ciphertext"] !== null;
        const codeFresh = (step: number) =>
          account["totp_last_step"] === null ||
          step > Number(account["totp_last_step"]);
        switch (change.kind) {
          case "CHANGE_PASSWORD":
            await client.query(
              `UPDATE public.admin_local_accounts SET password_hash=$2,password_changed_at=$3::timestamptz,
              must_change_password=false,failed_attempts=0,locked_until=NULL,
              version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1`,
              [c.accountId, change.newPasswordHash, at],
            );
            await revokeOthers("PASSWORD_CHANGED");
            await audit("ADMIN_LOCAL_PASSWORD_CHANGED", "SELF_SERVICE");
            break;
          case "BEGIN_TOTP": {
            if (enabled) return failure("TOTP_ALREADY_ENABLED");
            const [saved] = await draftRows(
              client,
              `UPDATE public.admin_local_accounts SET totp_pending_ciphertext=$2,totp_pending_encrypted_data_key=$3,
                totp_pending_key_version=$4,totp_pending_expires_at=$5::timestamptz+interval '10 minutes',
                failed_attempts=0,locked_until=NULL,version=version+1,updated_at=greatest(updated_at,$5::timestamptz)
              WHERE id=$1 RETURNING ${text("totp_pending_expires_at")} AS expires_at`,
              [
                c.accountId,
                change.pending.ciphertext,
                change.pending.encryptedDataKey,
                change.pending.keyVersion,
                at,
              ],
            );
            await audit("ADMIN_LOCAL_TOTP_ENROLLMENT_STARTED");
            return adminLocalAccountUpdateResponseSchema.parse({
              ...success,
              kind: "ENROLLMENT_SAVED",
              expiresAt: saved?.["expires_at"],
            });
          }
          case "CONFIRM_TOTP":
            if (enabled) return failure("TOTP_ALREADY_ENABLED");
            if (
              account["totp_pending_ciphertext"] !== change.pendingCiphertext ||
              account["pending_expired"] === true
            )
              return failure("ENROLLMENT_EXPIRED");
            await client.query(
              `UPDATE public.admin_local_accounts SET totp_ciphertext=totp_pending_ciphertext,
                totp_encrypted_data_key=totp_pending_encrypted_data_key,totp_key_version=totp_pending_key_version,
                totp_enabled_at=$3::timestamptz,totp_last_step=$2,totp_pending_ciphertext=NULL,
                totp_pending_encrypted_data_key=NULL,totp_pending_key_version=NULL,totp_pending_expires_at=NULL,
                version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1`,
              [c.accountId, change.step, at],
            );
            await revokeRecoveryCodes(client, c.accountId, at);
            await insertRecoveryCodes(client, {
              accountId: c.accountId,
              batchId: change.batchId,
              digests: change.recoveryCodeDigests,
              at,
            });
            await audit("ADMIN_LOCAL_TOTP_ENABLED");
            break;
          case "DISABLE_TOTP":
          case "REGENERATE_RECOVERY_CODES":
            if (!enabled) return failure("TOTP_NOT_ENABLED");
            if (
              account["totp_ciphertext"] !== change.ciphertext ||
              !codeFresh(change.step)
            )
              return failure("INVALID_CODE");
            await revokeRecoveryCodes(client, c.accountId, at);
            if (change.kind === "DISABLE_TOTP") {
              await client.query(
                `UPDATE public.admin_local_accounts SET totp_ciphertext=NULL,totp_encrypted_data_key=NULL,
                  totp_key_version=NULL,totp_enabled_at=NULL,totp_last_step=NULL,totp_pending_ciphertext=NULL,
                  totp_pending_encrypted_data_key=NULL,totp_pending_key_version=NULL,totp_pending_expires_at=NULL,
                  failed_attempts=0,locked_until=NULL,version=version+1,updated_at=greatest(updated_at,$2::timestamptz)
                WHERE id=$1`,
                [c.accountId, at],
              );
              await revokeOthers("SECOND_FACTOR_CHANGED");
              await audit("ADMIN_LOCAL_TOTP_DISABLED");
            } else {
              await client.query(
                `UPDATE public.admin_local_accounts SET totp_last_step=$2,failed_attempts=0,locked_until=NULL,
                  version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1`,
                [c.accountId, change.step, at],
              );
              await insertRecoveryCodes(client, {
                accountId: c.accountId,
                batchId: change.batchId,
                digests: change.recoveryCodeDigests,
                at,
              });
              await audit("ADMIN_LOCAL_RECOVERY_CODES_REGENERATED");
            }
            break;
        }
        return adminLocalAccountUpdateResponseSchema.parse({
          ...success,
          kind: "ACCOUNT_UPDATED",
          account: await readAccountView(client, c.accountId),
        });
      }),
  };
}
