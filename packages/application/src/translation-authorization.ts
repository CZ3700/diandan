import {
  adminAuthorizationResponseSchema,
  sourceHashSchema,
  type AdminAuthorizationCommand,
  type AdminPrincipal,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { AdminAuthorizationRepository } from "@fan-support/persistence-port";
import { digestAdminContentToken } from "./admin-content-tokens.js";
import {
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import { compareBaseContentTime } from "./base-content-time.js";
export type TranslationAuthorization = Omit<
  AdminAuthorizationCommand,
  "permission" | "locales"
>;
export function translationAuthorization(
  request: { sessionToken: string; csrfToken: string },
  tokenPepper: string,
): TranslationAuthorization {
  return {
    schemaVersion: 1,
    sessionTokenDigest: sourceHashSchema.parse(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: request.sessionToken,
      }),
    ),
    csrfTokenDigest: sourceHashSchema.parse(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-csrf",
        token: request.csrfToken,
      }),
    ),
  };
}
export async function authorizeTranslation(
  repository: AdminAuthorizationRepository,
  input: TranslationAuthorization,
  permission: AdminAuthorizationCommand["permission"],
  locales: SupportedLocale[],
  prior?: AdminPrincipal,
  allowForbidden = false,
): Promise<AdminPrincipal | null> {
  const response = adminAuthorizationResponseSchema.parse(
    await repository.authorize({ ...input, permission, locales }),
  );
  if (
    allowForbidden &&
    response.outcome === "FAILURE" &&
    response.code === "FORBIDDEN"
  )
    return null;
  const { principal } = requireAdminSuccess(response);
  if (
    prior &&
    (prior.actorId.toLowerCase() !== principal.actorId.toLowerCase() ||
      prior.sessionId.toLowerCase() !== principal.sessionId.toLowerCase() ||
      compareBaseContentTime(prior.expiresAt, principal.expiresAt) !== 0)
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (compareBaseContentTime(principal.expiresAt, principal.authorizedAt) <= 0)
    rejectAdminContent("UNAUTHENTICATED");
  return principal;
}
