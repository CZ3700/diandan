import { timingSafeEqual } from "node:crypto";
import {
  adminResourceAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  contentTimestampSchema,
} from "@fan-support/contracts";
import type { ResourceAuthorizationRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  resourceFailure,
  utcTimestampSql,
} from "./resource-management-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

/** Material permissions use the same canonical session proof without inventing locale grants. */
export function createResourceAuthorizationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): ResourceAuthorizationRepository {
  return {
    authorize: (input) =>
      scope.trackOperation(async () => {
        const parsed = adminResourceAuthorizationCommandSchema.safeParse(input);
        if (!parsed.success) return resourceFailure("INVALID_COMMAND");
        const command = parsed.data;
        try {
          const [session] = await draftRows(
            client,
            `WITH instant AS MATERIALIZED(SELECT clock_timestamp() AS now)
        SELECT i.id AS actor_id,s.id AS session_id,s.csrf_token_digest,${utcTimestampSql("s.expires_at")} AS expires_at,${utcTimestampSql("GREATEST(transaction_timestamp(),s.created_at)")} AS now
        FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id CROSS JOIN instant
        WHERE s.session_token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>instant.now AND s.created_at<=instant.now
          AND s.authenticated_with_mfa AND i.status='ACTIVE' FOR SHARE OF s,i`,
            [Buffer.from(command.sessionTokenDigest, "hex")],
          );
          if (!session) return resourceFailure("UNAUTHENTICATED");
          const csrf = session["csrf_token_digest"];
          if (
            !Buffer.isBuffer(csrf) ||
            csrf.length !== 32 ||
            !timingSafeEqual(csrf, Buffer.from(command.csrfTokenDigest, "hex"))
          )
            return resourceFailure("CSRF_INVALID");
          const permissions = await draftRows(
            client,
            `SELECT ar.role_id,${utcTimestampSql("GREATEST(transaction_timestamp(),$3::timestamptz,ar.granted_at,rp.granted_at)")} AS authorized_at FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id
        JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
        WHERE ar.admin_identity_id=$1 AND p.permission_key=$2 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
        ORDER BY GREATEST(ar.granted_at,rp.granted_at) DESC,ar.role_id FOR SHARE OF ar,r,rp,p`,
            [session["actor_id"], command.permission, session["now"]],
          );
          if (permissions.length === 0) return resourceFailure("FORBIDDEN");
          return adminAuthorizationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            principal: {
              schemaVersion: 1,
              actorId: session["actor_id"],
              sessionId: session["session_id"],
              expiresAt: contentTimestampSchema.parse(session["expires_at"]),
              authorizedAt: contentTimestampSchema.parse(
                permissions[0]?.["authorized_at"],
              ),
            },
          });
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      }),
  };
}
