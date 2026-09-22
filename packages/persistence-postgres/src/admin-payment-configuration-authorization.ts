import { timingSafeEqual } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  type AdminOrdersAccess,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  configurationFailure,
  draftRows,
  type TransactionClient,
} from "./admin-payment-configuration-data.js";
export type ConfigurationAuthority = {
  actorId: string;
  sessionId: string;
  permissions: string[];
  reviewLocales: SupportedLocale[];
};
export async function confirmConfigurationAuthority(
  client: TransactionClient,
  authority: ConfigurationAuthority,
) {
  const [r] = await draftRows(
    client,
    `SELECT s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.created_at<=clock_timestamp() AND s.authenticated_with_mfa AND i.status='ACTIVE' live FROM public.admin_sessions s JOIN public.admin_identities i ON i.id=s.admin_identity_id WHERE s.id=$1 AND i.id=$2`,
    [authority.sessionId, authority.actorId],
  );
  return r?.["live"] === true ? null : configurationFailure("UNAUTHENTICATED");
}
export async function authorizeConfiguration(
  client: TransactionClient,
  access: AdminOrdersAccess,
) {
  const [owner] = await draftRows(
    client,
    "SELECT id,admin_identity_id FROM public.admin_sessions WHERE session_token_digest=$1",
    [Buffer.from(access.sessionTokenDigest, "hex")],
  );
  if (!owner) return configurationFailure("UNAUTHENTICATED");
  await draftRows(
    client,
    "SELECT id FROM public.admin_identities WHERE id=$1 FOR SHARE",
    [owner["admin_identity_id"]],
  );
  const [session] = await draftRows(
    client,
    "SELECT * FROM public.admin_sessions WHERE id=$1 AND admin_identity_id=$2 FOR SHARE",
    [owner["id"], owner["admin_identity_id"]],
  );
  const csrf = session?.["csrf_token_digest"];
  if (
    !Buffer.isBuffer(csrf) ||
    csrf.length !== 32 ||
    !timingSafeEqual(csrf, Buffer.from(access.csrfTokenDigest, "hex"))
  )
    return configurationFailure("CSRF_INVALID");
  const permissions = await draftRows(
    client,
    `SELECT p.permission_key FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=$1 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() ORDER BY ar.role_id,p.permission_key FOR SHARE OF ar,r,rp,p`,
    [owner["admin_identity_id"]],
  );
  const locales = await draftRows(
    client,
    `SELECT locale FROM public.admin_content_locale_grants WHERE admin_identity_id=$1 AND revoked_at IS NULL AND granted_at<=clock_timestamp() ORDER BY locale FOR SHARE`,
    [owner["admin_identity_id"]],
  );
  const authority: ConfigurationAuthority = {
    actorId: String(owner["admin_identity_id"]),
    sessionId: String(owner["id"]),
    permissions: permissions.map((r) => String(r["permission_key"])),
    reviewLocales: SUPPORTED_LOCALES.filter((l) =>
      locales.some((r) => r["locale"] === l),
    ),
  };
  const expired = await confirmConfigurationAuthority(client, authority);
  if (expired) return expired;
  if (
    !authority.permissions.some(
      (p) => p === "payments.read" || p === "payments.review",
    )
  )
    return configurationFailure("FORBIDDEN");
  return { outcome: "SUCCESS" as const, authority };
}
