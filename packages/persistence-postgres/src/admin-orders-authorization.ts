import { timingSafeEqual } from "node:crypto";
import {
  adminOrdersAccessSchema,
  adminOrdersPermissionSchema,
  adminOrdersPrincipalSchema,
  SUPPORTED_LOCALES,
  type AdminOrdersAccess,
  type AdminOrdersFailure,
  type AdminOrdersPermission,
  type AdminOrdersPrincipal,
  type SupportedLocale,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  adminOrdersFailure,
  adminOrdersTimestamp,
} from "./admin-orders-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export async function confirmAdminOrdersAuthority(
  client: TransactionClient,
  principal: AdminOrdersPrincipal,
): Promise<AdminOrdersFailure | null> {
  const [row] = await draftRows(
    client,
    `SELECT s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.created_at<=clock_timestamp() AND s.authenticated_with_mfa AND i.status='ACTIVE' live FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id WHERE s.id=$1 AND i.id=$2`,
    [principal.sessionId, principal.actorId],
  );
  return row?.["live"] === true ? null : adminOrdersFailure("UNAUTHENTICATED");
}
export async function readAdminOrdersCapabilities(
  client: TransactionClient,
  access: AdminOrdersAccess,
) {
  if (!adminOrdersAccessSchema.safeParse(access).success)
    return adminOrdersFailure("INVALID_COMMAND");
  const token = Buffer.from(access.sessionTokenDigest, "hex");
  const [owner] = await draftRows(
    client,
    "SELECT id,admin_identity_id FROM public.admin_sessions WHERE session_token_digest=$1",
    [token],
  );
  if (!owner) return adminOrdersFailure("UNAUTHENTICATED");
  // Match login/logout: identity first, session second. A joined locking read
  // lets the planner lock the session first and deadlock against revocation.
  const [identity] = await draftRows(
    client,
    "SELECT id FROM public.admin_identities WHERE id=$1 FOR SHARE",
    [owner["admin_identity_id"]],
  );
  if (!identity) return adminOrdersFailure("UNAUTHENTICATED");
  const [session] = await draftRows(
    client,
    `SELECT s.admin_identity_id actor_id,s.id session_id,s.csrf_token_digest,${adminOrdersTimestamp("s.expires_at")} expires_at FROM public.admin_sessions s WHERE s.session_token_digest=$1 AND s.admin_identity_id=$2 AND s.id=$3 FOR SHARE`,
    [token, identity["id"], owner["id"]],
  );
  if (!session) return adminOrdersFailure("UNAUTHENTICATED");
  const csrf = session["csrf_token_digest"];
  if (
    !Buffer.isBuffer(csrf) ||
    csrf.length !== 32 ||
    !timingSafeEqual(csrf, Buffer.from(access.csrfTokenDigest, "hex"))
  )
    return adminOrdersFailure("CSRF_INVALID");
  const permissions = await draftRows(
    client,
    `SELECT p.permission_key FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=$1 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() ORDER BY ar.role_id,p.permission_key FOR SHARE OF ar,r,rp,p`,
    [session["actor_id"]],
  );
  const locales = await draftRows(
    client,
    `SELECT id,locale FROM public.admin_order_message_locale_grants WHERE admin_identity_id=$1 AND revoked_at IS NULL AND granted_at<=clock_timestamp() ORDER BY locale FOR SHARE`,
    [session["actor_id"]],
  );
  const [instant] = await draftRows(
    client,
    `SELECT ${adminOrdersTimestamp("clock_timestamp()")} now`,
  );
  const principal = adminOrdersPrincipalSchema.parse({
    actorId: session["actor_id"],
    sessionId: session["session_id"],
    sessionExpiresAt: session["expires_at"],
    authorizedAt: instant?.["now"],
    permissions: adminOrdersPermissionSchema.options.filter((p) =>
      permissions.some((r) => r["permission_key"] === p),
    ),
    reviewLocales: SUPPORTED_LOCALES.filter((l) =>
      locales.some((r) => r["locale"] === l),
    ),
  });
  const failure = await confirmAdminOrdersAuthority(client, principal);
  return failure ?? { outcome: "SUCCESS" as const, principal };
}
export async function authorizeAdminOrders(
  client: TransactionClient,
  access: AdminOrdersAccess,
  requirement: {
    permission: AdminOrdersPermission;
    reviewLocale?: SupportedLocale;
  },
) {
  const result = await readAdminOrdersCapabilities(client, access);
  if (result.outcome === "FAILURE") return result;
  if (!result.principal.permissions.includes(requirement.permission))
    return adminOrdersFailure("FORBIDDEN");
  if (
    requirement.reviewLocale &&
    !result.principal.reviewLocales.includes(requirement.reviewLocale)
  )
    return adminOrdersFailure("LANGUAGE_REVIEW_REQUIRED");
  return result;
}
