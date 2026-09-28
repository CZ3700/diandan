import { timingSafeEqual } from "node:crypto";
import {
  adminAuthorizationCommandSchema,
  homeLayoutAuthorizationCommandSchema,
  informationPageAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  contentTimestampSchema,
  type AdminContentFailure,
} from "@fan-support/contracts";
import type {
  AdminAuthorizationRepository,
  HomeLayoutAuthorizationRepository,
  InformationPageAuthorizationRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
const failure = (code: AdminContentFailure["code"]): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

/** Locks the canonical session and grants until the enclosing content transaction ends. */
export function createAdminAuthorizationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminAuthorizationRepository {
  return createAuthorizationRepository(client, scope, (input) =>
    adminAuthorizationCommandSchema.safeParse(input),
  );
}
/** Layout capabilities carry no linguistic scope and never widen the original content contract. */
export function createHomeLayoutAuthorizationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): HomeLayoutAuthorizationRepository {
  return createAuthorizationRepository(client, scope, (input) =>
    homeLayoutAuthorizationCommandSchema.safeParse(input),
  );
}
export function createInformationPageAuthorizationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): InformationPageAuthorizationRepository {
  return createAuthorizationRepository(client, scope, (input) =>
    informationPageAuthorizationCommandSchema.safeParse(input),
  );
}
function createAuthorizationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  parse: (
    input: unknown,
  ) =>
    | ReturnType<typeof adminAuthorizationCommandSchema.safeParse>
    | ReturnType<typeof homeLayoutAuthorizationCommandSchema.safeParse>
    | ReturnType<typeof informationPageAuthorizationCommandSchema.safeParse>,
) {
  return {
    authorize: (input: unknown) =>
      scope.trackOperation(async () => {
        const parsed = parse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const command = parsed.data;
        try {
          const [session] = await draftRows(
            client,
            `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now)
          SELECT i.id AS actor_id,s.id AS session_id,s.csrf_token_digest,
            to_char(s.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
            to_char(instant.now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now
          FROM public.admin_sessions s JOIN public.admin_identities i ON i.id = s.admin_identity_id CROSS JOIN instant
          WHERE s.session_token_digest = $1 AND s.revoked_at IS NULL AND s.expires_at > instant.now
          AND s.created_at <= instant.now AND s.authenticated_with_mfa AND i.status = 'ACTIVE'
          FOR SHARE OF s,i`,
            [Buffer.from(command.sessionTokenDigest, "hex")],
          );
          if (!session) return failure("UNAUTHENTICATED");
          const csrf = session["csrf_token_digest"];
          if (
            !Buffer.isBuffer(csrf) ||
            csrf.length !== 32 ||
            !timingSafeEqual(csrf, Buffer.from(command.csrfTokenDigest, "hex"))
          )
            return failure("CSRF_INVALID");
          const permissions = await draftRows(
            client,
            `SELECT ar.role_id
          FROM public.admin_identity_roles ar JOIN public.roles r ON r.id = ar.role_id
          JOIN public.role_permissions rp ON rp.role_id = r.id JOIN public.permissions p ON p.id = rp.permission_id
          WHERE ar.admin_identity_id = $1 AND p.permission_key = $2
          AND ar.granted_at <= clock_timestamp() AND rp.granted_at <= clock_timestamp()
          FOR SHARE OF ar,r,rp,p`,
            [session["actor_id"], command.permission],
          );
          if (permissions.length === 0) return failure("FORBIDDEN");
          if (command.locales.length > 0) {
            const grants = await draftRows(
              client,
              `SELECT locale FROM public.admin_content_locale_grants
            WHERE admin_identity_id = $1 AND locale = ANY($2::text[]) AND revoked_at IS NULL AND granted_at <= clock_timestamp() FOR SHARE`,
              [session["actor_id"], command.locales],
            );
            if (
              command.locales.some(
                (locale) => !grants.some((grant) => grant["locale"] === locale),
              )
            )
              return failure("FORBIDDEN");
          }
          const response = adminAuthorizationResponseSchema.safeParse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            principal: {
              schemaVersion: 1,
              actorId: session["actor_id"],
              sessionId: session["session_id"],
              expiresAt: contentTimestampSchema.parse(session["expires_at"]),
              authorizedAt: contentTimestampSchema.parse(session["now"]),
            },
          });
          return response.success
            ? response.data
            : failure("CONTENT_UNAVAILABLE");
        } catch (error) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      }),
  };
}
