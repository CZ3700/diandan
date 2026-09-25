import { timingSafeEqual } from "node:crypto";
import {
  adminAuthorizationResponseSchema,
  publicationAuthorizationCommandSchema,
  contentTimestampSchema,
} from "@fan-support/contracts";
import type { PublicationAuthorizationRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import { baseContentFailure } from "./base-content-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

/** Publication authority always locks the current MFA session and all seven locale grants. */
export function createPublicationAuthorizationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): PublicationAuthorizationRepository {
  return {
    authorize: (input) =>
      scope.trackOperation(async () => {
        const parsed = publicationAuthorizationCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        try {
          const [session] = await draftRows(
            client,
            `WITH instant AS MATERIALIZED(SELECT clock_timestamp() AS now)
        SELECT i.id AS actor_id,s.id AS session_id,s.csrf_token_digest,${utcTimestampSql("s.expires_at")} AS expires_at,
          ${utcTimestampSql("GREATEST(transaction_timestamp(),s.created_at)")} AS authorized_at
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
            `SELECT ar.role_id,${utcTimestampSql("GREATEST(ar.granted_at,rp.granted_at)")} AS granted_at
        FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
        WHERE ar.admin_identity_id=$1 AND p.permission_key=$2 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
        ORDER BY ar.role_id FOR SHARE OF ar,r,rp,p`,
            [session["actor_id"], command.permission],
          );
          if (!permissions.length) return baseContentFailure("FORBIDDEN");
          const locales = await draftRows(
            client,
            `SELECT locale,${utcTimestampSql("granted_at")} AS granted_at FROM public.admin_content_locale_grants
        WHERE admin_identity_id=$1 AND locale=ANY($2::text[]) AND revoked_at IS NULL AND granted_at<=clock_timestamp() ORDER BY locale FOR SHARE`,
            [session["actor_id"], command.locales],
          );
          if (
            command.locales.some(
              (locale) => !locales.some((grant) => grant["locale"] === locale),
            )
          )
            return baseContentFailure("FORBIDDEN");
          const [time] = await draftRows(
            client,
            `SELECT ${utcTimestampSql("max(value)")} AS authorized_at FROM unnest($1::timestamptz[]) value`,
            [
              [
                session["authorized_at"],
                permissions[0]?.["granted_at"],
                ...locales.map((grant) => grant["granted_at"]),
              ],
            ],
          );
          return adminAuthorizationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            principal: {
              schemaVersion: 1,
              actorId: session["actor_id"],
              sessionId: session["session_id"],
              expiresAt: contentTimestampSchema.parse(session["expires_at"]),
              authorizedAt: contentTimestampSchema.parse(
                time?.["authorized_at"],
              ),
            },
          });
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      }),
  };
}
