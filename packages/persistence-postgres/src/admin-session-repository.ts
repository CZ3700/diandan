import type { AdminSessionRepository } from "@fan-support/persistence-port";
import {
  adminSessionReadCommandSchema,
  adminSessionResponseSchema,
  adminSessionPermissionSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { timingSafeEqual } from "node:crypto";
import { draftRows } from "./content-draft-data.js";
import { baseContentFailure } from "./base-content-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

/** Current MFA session and current database grants; no session creation or privilege inference. */
export function createAdminSessionRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminSessionRepository {
  return {
    read: (input) =>
      scope.trackOperation(async () => {
        const parsed = adminSessionReadCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        try {
          const [session] = await draftRows(
            client,
            `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
        SELECT i.id AS actor_id,s.csrf_token_digest
        FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id CROSS JOIN instant
        WHERE s.session_token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>instant.now AND s.created_at<=instant.now
          AND s.authenticated_with_mfa AND i.status='ACTIVE' FOR SHARE OF s,i`,
            [Buffer.from(command.sessionTokenDigest, "hex")],
          );
          if (!session) return baseContentFailure("UNAUTHENTICATED");
          const csrf = session["csrf_token_digest"];
          if (
            !Buffer.isBuffer(csrf) ||
            csrf.length !== 32 ||
            !timingSafeEqual(csrf, Buffer.from(command.csrfTokenDigest, "hex"))
          )
            return baseContentFailure("CSRF_INVALID");
          const permissions = await draftRows(
            client,
            `SELECT p.permission_key FROM public.admin_identity_roles ar
        JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
        WHERE ar.admin_identity_id=$1 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
        ORDER BY ar.role_id,p.permission_key FOR SHARE OF ar,r,rp,p`,
            [session["actor_id"]],
          );
          const locales = await draftRows(
            client,
            `SELECT locale FROM public.admin_content_locale_grants
        WHERE admin_identity_id=$1 AND revoked_at IS NULL AND granted_at<=clock_timestamp() ORDER BY locale FOR SHARE`,
            [session["actor_id"]],
          );
          return adminSessionResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "ADMIN_SESSION",
            actorId: session["actor_id"],
            permissions: adminSessionPermissionSchema.options.filter((key) =>
              permissions.some((row) => row["permission_key"] === key),
            ),
            localeScopes: SUPPORTED_LOCALES.filter((locale) =>
              locales.some((row) => row["locale"] === locale),
            ),
          });
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      }),
  };
}
