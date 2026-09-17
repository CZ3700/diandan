import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  adminAccessCreateCommandSchema,
  adminAccessCreateResponseSchema,
  adminAccessClaimCommandSchema,
  adminAccessClaimResponseSchema,
  adminAccessCompleteCommandSchema,
  adminAccessCompleteResponseSchema,
  adminAccessRejectCommandSchema,
  adminAccessRevokeCommandSchema,
  type AdminAccessFailure,
} from "@fan-support/contracts";
import type { AdminAccessRepository } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const failure = (code: AdminAccessFailure["code"]): AdminAccessFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
const timestamp = `to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const sameDigest = (stored: unknown, supplied: string) =>
  Buffer.isBuffer(stored) &&
  stored.length === 32 &&
  timingSafeEqual(stored, Buffer.from(supplied, "hex"));

/** Only short database work belongs here; exchange/verification completes before this boundary. */
export function createAdminAccessRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminAccessRepository {
  const tracked = <T>(work: () => Promise<T>): Promise<T> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  async function lockClaim(
    id: string,
    claim: string,
  ): Promise<DraftRow | undefined> {
    const [row] = await draftRows(
      client,
      "SELECT * FROM public.admin_login_challenges WHERE id=$1 FOR UPDATE",
      [id],
    );
    return row?.["state"] === "CLAIMED" &&
      sameDigest(row["claim_digest"], claim)
      ? row
      : undefined;
  }
  async function consume(
    id: string,
    request: string,
    reason: string,
    time: unknown,
    sessionId: string | null = null,
  ) {
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO public.audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
      VALUES($1,'SYSTEM','admin-access',$2,'ADMIN_LOGIN_CHALLENGE',$3,$4,$5,$3,$6,$7::timestamptz)`,
      [
        auditId,
        sessionId ? "ADMIN_LOGIN_SUCCEEDED" : "ADMIN_LOGIN_REJECTED",
        id,
        reason,
        request,
        sessionId ? "SUCCEEDED" : "REJECTED",
        time,
      ],
    );
    await client.query(
      "UPDATE public.admin_login_challenges SET state='CONSUMED',completed_at=$2::timestamptz,session_id=$3,audit_log_id=$4 WHERE id=$1",
      [id, time, sessionId, auditId],
    );
  }
  return {
    create: (input) =>
      tracked(async () => {
        const parsed = adminAccessCreateCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data;
        const [created] = await draftRows(
          client,
          `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
        INSERT INTO public.admin_login_challenges(id,state_digest,binding_digest,configuration_digest,locale,created_at,expires_at)
        SELECT $1,$2,$3,$4,$5,now,now+$6::integer*interval '1 second' FROM instant ON CONFLICT DO NOTHING
        RETURNING to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at`,
          [
            c.challengeId,
            Buffer.from(c.stateDigest, "hex"),
            Buffer.from(c.bindingDigest, "hex"),
            Buffer.from(c.configurationDigest, "hex"),
            c.locale,
            c.ttlSeconds,
          ],
        );
        return created
          ? adminAccessCreateResponseSchema.parse({
              ...success,
              kind: "LOGIN_CREATED",
              expiresAt: created["expires_at"],
            })
          : failure("LOGIN_RESTART_REQUIRED");
      }),
    claim: (input) =>
      tracked(async () => {
        const parsed = adminAccessClaimCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data;
        // Read the clock only after a contended challenge lock is acquired.
        const [ready] = await draftRows(
          client,
          "SELECT id FROM public.admin_login_challenges WHERE state_digest=$1 AND binding_digest=$2 AND configuration_digest=$3 AND state='READY' FOR UPDATE",
          [
            Buffer.from(c.stateDigest, "hex"),
            Buffer.from(c.bindingDigest, "hex"),
            Buffer.from(c.configurationDigest, "hex"),
          ],
        );
        if (!ready) return failure("LOGIN_RESTART_REQUIRED");
        const [claimed] = await draftRows(
          client,
          `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
        UPDATE public.admin_login_challenges SET state='CLAIMED',claim_digest=$4,claimed_at=instant.now FROM instant
        WHERE state_digest=$1 AND binding_digest=$2 AND configuration_digest=$3 AND state='READY' AND created_at<=instant.now AND expires_at>instant.now RETURNING id`,
          [
            Buffer.from(c.stateDigest, "hex"),
            Buffer.from(c.bindingDigest, "hex"),
            Buffer.from(c.configurationDigest, "hex"),
            Buffer.from(c.claimDigest, "hex"),
          ],
        );
        return claimed
          ? adminAccessClaimResponseSchema.parse({
              ...success,
              kind: "LOGIN_CLAIMED",
              challengeId: claimed["id"],
            })
          : failure("LOGIN_RESTART_REQUIRED");
      }),
    complete: (input) =>
      tracked(async () => {
        const parsed = adminAccessCompleteCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data,
          challenge = await lockClaim(c.challengeId, c.claimDigest);
        if (!challenge) return failure("LOGIN_RESTART_REQUIRED");
        // Serialize session issuance against suspension and logout-all on the canonical identity.
        const [identity] = await draftRows(
          client,
          "SELECT id,status FROM public.admin_identities WHERE issuer=$1 AND external_subject_hash=$2 FOR UPDATE",
          [c.issuer, Buffer.from(c.subjectDigest, "hex")],
        );
        const [instant] = await draftRows(
          client,
          `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
        SELECT to_char(now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now,
        expires_at>now AS unexpired,$2::timestamptz<=now AND $2::timestamptz>=now-$3::integer*interval '1 second' AS fresh
        FROM public.admin_login_challenges CROSS JOIN instant WHERE id=$1`,
          [c.challengeId, c.authenticatedAt, c.maxAuthenticationAgeSeconds],
        );
        if (!instant) throw new Error("missing locked challenge");
        if (instant["unexpired"] !== true) {
          await consume(
            c.challengeId,
            c.requestId,
            "LOGIN_EXPIRED",
            instant["now"],
          );
          return failure("LOGIN_RESTART_REQUIRED");
        }
        if (
          !identity ||
          identity["status"] !== "ACTIVE" ||
          instant["fresh"] !== true
        ) {
          await consume(
            c.challengeId,
            c.requestId,
            instant["fresh"] === true
              ? "ACCESS_DENIED"
              : "AUTHENTICATION_EXPIRED",
            instant["now"],
          );
          return failure("ACCESS_DENIED");
        }
        const [session] = await draftRows(
          client,
          `INSERT INTO public.admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,last_seen_at,expires_at)
        VALUES($1,$2,$3,$4,true,$5::timestamptz,$5::timestamptz,$5::timestamptz+$6::integer*interval '1 second')
        RETURNING to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at`,
          [
            c.sessionId,
            identity["id"],
            Buffer.from(c.sessionTokenDigest, "hex"),
            Buffer.from(c.csrfTokenDigest, "hex"),
            instant["now"],
            c.sessionTtlSeconds,
          ],
        );
        await consume(
          c.challengeId,
          c.requestId,
          "AUTHENTICATED",
          instant["now"],
          c.sessionId,
        );
        return adminAccessCompleteResponseSchema.parse({
          ...success,
          kind: "SESSION_SAVED",
          expiresAt: session?.["expires_at"],
          locale: challenge["locale"],
        });
      }),
    reject: (input) =>
      tracked(async () => {
        const parsed = adminAccessRejectCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data;
        if (!(await lockClaim(c.challengeId, c.claimDigest)))
          return failure("LOGIN_RESTART_REQUIRED");
        const [instant] = await draftRows(client, `SELECT ${timestamp} AS now`);
        await consume(
          c.challengeId,
          c.requestId,
          c.reasonCode,
          instant?.["now"],
        );
        return { ...success, kind: "LOGIN_REJECTED" };
      }),
    revoke: (input) =>
      tracked(async () => {
        const parsed = adminAccessRevokeCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data,
          token = Buffer.from(c.sessionTokenDigest, "hex");
        const [owner] = await draftRows(
          client,
          "SELECT admin_identity_id FROM public.admin_sessions WHERE session_token_digest=$1",
          [token],
        );
        if (!owner) return failure("UNAUTHENTICATED");
        const [identity] = await draftRows(
          client,
          "SELECT id,status FROM public.admin_identities WHERE id=$1 FOR UPDATE",
          [owner["admin_identity_id"]],
        );
        const [session] = await draftRows(
          client,
          "SELECT id,admin_identity_id,csrf_token_digest,revoked_at FROM public.admin_sessions WHERE session_token_digest=$1 FOR UPDATE",
          [token],
        );
        if (!session) return failure("UNAUTHENTICATED");
        if (!sameDigest(session["csrf_token_digest"], c.csrfTokenDigest))
          return failure("CSRF_INVALID");
        if (session["revoked_at"] !== null)
          return c.revokeAll
            ? failure("UNAUTHENTICATED")
            : { ...success, kind: "LOGGED_OUT" };
        const [instant] = await draftRows(
          client,
          `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
          SELECT to_char(now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now,
          expires_at>now AND created_at<=now AS live FROM public.admin_sessions CROSS JOIN instant WHERE id=$1`,
          [session["id"]],
        );
        if (
          c.revokeAll &&
          (instant?.["live"] !== true || identity?.["status"] !== "ACTIVE")
        )
          return failure("UNAUTHENTICATED");
        const revokedSessions = await draftRows(
          client,
          `UPDATE public.admin_sessions SET revoked_at=$3::timestamptz WHERE revoked_at IS NULL AND ($1::boolean AND admin_identity_id=$2::uuid OR NOT $1::boolean AND id=$4::uuid) RETURNING id`,
          [
            c.revokeAll,
            session["admin_identity_id"],
            instant?.["now"],
            session["id"],
          ],
        );
        for (const revokedSession of revokedSessions)
          await client.query(
            `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
        VALUES($1,'ADMIN',$2,$3,'ADMIN_SESSION',$4,'USER_LOGOUT',$5,$7,'SUCCEEDED',$6::timestamptz)`,
            [
              randomUUID(),
              session["admin_identity_id"],
              c.revokeAll ? "ADMIN_SESSIONS_REVOKED" : "ADMIN_SESSION_REVOKED",
              revokedSession["id"],
              c.requestId,
              instant?.["now"],
              session["id"],
            ],
          );
        return { ...success, kind: "LOGGED_OUT" };
      }),
  };
}
