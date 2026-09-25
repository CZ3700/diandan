import { timingSafeEqual } from "node:crypto";
import {
  giftCommerceAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  contentTimestampSchema,
  giftCommerceAccessContextCommandSchema,
  giftCommerceAccessContextResponseSchema,
  giftCommercePermissionSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import type { GiftCommerceAuthorizationRepository } from "@fan-support/persistence-port";
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

async function loadSession(
  client: TransactionClient,
  command: { sessionTokenDigest: string; csrfTokenDigest: string },
) {
  const [session] = await draftRows(
    client,
    `WITH instant AS MATERIALIZED(SELECT clock_timestamp() AS now)
            SELECT i.id AS actor_id,s.id AS session_id,s.csrf_token_digest,
              ${utcTimestampSql("s.expires_at")} AS expires_at,
              ${utcTimestampSql("GREATEST(transaction_timestamp(),s.created_at)")} AS now
            FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id CROSS JOIN instant
            WHERE s.session_token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>instant.now
              AND s.created_at<=instant.now AND s.authenticated_with_mfa AND i.status='ACTIVE'
            FOR SHARE OF s,i`,
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
  return { outcome: "SUCCESS" as const, session };
}

/** The new capability vocabulary uses the same canonical session, MFA and role grants. */
export function createGiftCommerceAuthorizationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): GiftCommerceAuthorizationRepository {
  return {
    context(input) {
      return scope.trackOperation(async () => {
        const parsed = giftCommerceAccessContextCommandSchema.safeParse(input);
        if (!parsed.success) return resourceFailure("INVALID_COMMAND");
        try {
          const authentication = await loadSession(client, parsed.data);
          if (authentication.outcome === "FAILURE") return authentication;
          const session = authentication.session;
          const grants = await draftRows(
            client,
            `SELECT p.permission_key FROM public.admin_identity_roles ar
            JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id
            JOIN public.permissions p ON p.id=rp.permission_id
            WHERE ar.admin_identity_id=$1 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
            ORDER BY ar.role_id,p.permission_key FOR SHARE OF ar,r,rp,p`,
            [session["actor_id"]],
          );
          const locales = await draftRows(
            client,
            `SELECT locale FROM public.admin_content_locale_grants
            WHERE admin_identity_id=$1 AND revoked_at IS NULL AND granted_at<=clock_timestamp()
            ORDER BY locale FOR SHARE`,
            [session["actor_id"]],
          );
          return giftCommerceAccessContextResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            principal: {
              schemaVersion: 1,
              actorId: session["actor_id"],
              sessionId: session["session_id"],
              expiresAt: session["expires_at"],
              authorizedAt: session["now"],
            },
            permissions: giftCommercePermissionSchema.options.filter(
              (permission) =>
                grants.some((row) => row["permission_key"] === permission),
            ),
            localeScopes: SUPPORTED_LOCALES.filter((locale) =>
              locales.some((row) => row["locale"] === locale),
            ),
          });
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      });
    },
    authorize(input: unknown) {
      return scope.trackOperation(async () => {
        const parsed = giftCommerceAuthorizationCommandSchema.safeParse(input);
        if (!parsed.success) return resourceFailure("INVALID_COMMAND");
        const command = parsed.data;
        try {
          const authentication = await loadSession(client, command);
          if (authentication.outcome === "FAILURE") return authentication;
          const session = authentication.session;
          const permissions = await draftRows(
            client,
            `SELECT ar.role_id,
              ${utcTimestampSql("GREATEST(transaction_timestamp(),$3::timestamptz,ar.granted_at,rp.granted_at)")} AS authorized_at
            FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id
            JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
            WHERE ar.admin_identity_id=$1 AND p.permission_key=$2
              AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
            ORDER BY GREATEST(ar.granted_at,rp.granted_at) DESC,ar.role_id
            FOR SHARE OF ar,r,rp,p`,
            [session["actor_id"], command.permission, session["now"]],
          );
          if (permissions.length === 0) return resourceFailure("FORBIDDEN");
          let authorizedAt = contentTimestampSchema.parse(
            permissions[0]?.["authorized_at"],
          );
          if (command.locales.length > 0) {
            const grants = await draftRows(
              client,
              `SELECT locale,${utcTimestampSql("GREATEST($3::timestamptz,granted_at)")} AS authorized_at
              FROM public.admin_content_locale_grants
              WHERE admin_identity_id=$1 AND locale=ANY($2::text[]) AND revoked_at IS NULL AND granted_at<=clock_timestamp()
              ORDER BY granted_at DESC,locale FOR SHARE`,
              [session["actor_id"], command.locales, authorizedAt],
            );
            if (
              command.locales.some(
                (locale) => !grants.some((grant) => grant["locale"] === locale),
              )
            )
              return resourceFailure("FORBIDDEN");
            authorizedAt = contentTimestampSchema.parse(
              grants[0]?.["authorized_at"],
            );
          }
          return adminAuthorizationResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            principal: {
              schemaVersion: 1,
              actorId: session["actor_id"],
              sessionId: session["session_id"],
              expiresAt: contentTimestampSchema.parse(session["expires_at"]),
              authorizedAt,
            },
          });
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      });
    },
  };
}
