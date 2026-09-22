import type { AdminOrdersAccess } from "@fan-support/contracts";
import {
  readAdminOrdersCapabilities,
  confirmAdminOrdersAuthority,
} from "./admin-orders-authorization.js";
import {
  draftRows,
  exceptionFailure,
  type TransactionClient,
} from "./admin-exceptions-data.js";
export async function authorizeExceptions(
  client: TransactionClient,
  access: AdminOrdersAccess,
) {
  const auth = await readAdminOrdersCapabilities(client, access);
  if (auth.outcome === "FAILURE")
    return exceptionFailure(
      auth.code === "CSRF_INVALID"
        ? "CSRF_INVALID"
        : auth.code === "UNAUTHENTICATED"
          ? "UNAUTHENTICATED"
          : "FORBIDDEN",
    );
  const rows = await draftRows(
    client,
    `SELECT p.permission_key FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=$1 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() ORDER BY ar.role_id,p.permission_key FOR SHARE OF ar,rp,p`,
    [auth.principal.actorId],
  );
  const grants = rows.map((r) => String(r["permission_key"]));
  if (!grants.includes("exceptions.read")) return exceptionFailure("FORBIDDEN");
  const invalid = await confirmAdminOrdersAuthority(client, auth.principal);
  if (invalid) return exceptionFailure("UNAUTHENTICATED");
  return {
    outcome: "SUCCESS" as const,
    principal: auth.principal,
    permissions: {
      canRead: true,
      canReplayWebhook: grants.includes("exceptions.replay"),
      canRetryDeadLetter: grants.includes("exceptions.replay"),
      canReconcilePayment:
        grants.includes("orders.read") && grants.includes("finance.manage"),
      canRetryNotification:
        grants.includes("orders.read") &&
        grants.includes("orders.notification.resend"),
    },
  };
}
export type ExceptionAuthority = Extract<
  Awaited<ReturnType<typeof authorizeExceptions>>,
  { outcome: "SUCCESS" }
>;
