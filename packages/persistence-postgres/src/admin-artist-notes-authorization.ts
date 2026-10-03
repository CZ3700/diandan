import {
  adminArtistNoteFailureSchema,
  type AdminArtistNoteFailure,
  type AdminArtistNoteGate,
  type AdminOrdersAccess,
  type AdminOrdersFailure,
  type AdminOrdersPrincipal,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { readAdminOrdersCapabilities } from "./admin-orders-authorization.js";
import type { TransactionClient } from "./transaction-runner.js";

// ADR-022 / L3-13: who may read and save private artist notes. Sessions, CSRF and liveness are the orders
// checks; idols.private and the second-factor gate are read beside them. 0062 repeats both rules.

export type ArtistNotePrincipal = Readonly<{
  orders: AdminOrdersPrincipal;
  gate: AdminArtistNoteGate;
}>;

export const artistNoteFailure = (
  code: AdminArtistNoteFailure["code"],
): AdminArtistNoteFailure =>
  adminArtistNoteFailureSchema.parse({
    schemaVersion: 1,
    outcome: "FAILURE",
    code,
  });

const carried = new Set<string>(
  adminArtistNoteFailureSchema.shape.code.options,
);
export function artistNoteFailureFromOrders(
  failure: AdminOrdersFailure,
): AdminArtistNoteFailure {
  return artistNoteFailure(
    carried.has(failure.code)
      ? (failure.code as AdminArtistNoteFailure["code"])
      : "TEMPORARY_UNAVAILABLE",
  );
}

/**
 * Built-in sessions always say authenticated_with_mfa, so the gate reads the sign-in that issued this
 * session, and the account must still have TOTP: turning it off keeps the current session alive.
 */
export async function readArtistNotePrincipal(
  client: TransactionClient,
  access: AdminOrdersAccess,
): Promise<
  | { outcome: "SUCCESS"; principal: ArtistNotePrincipal }
  | AdminArtistNoteFailure
> {
  const result = await readAdminOrdersCapabilities(client, access);
  if (result.outcome === "FAILURE") return artistNoteFailureFromOrders(result);
  const orders = result.principal;
  const [row] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id
      WHERE ar.admin_identity_id=$1 AND p.permission_key='idols.private' AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()) holds,
    EXISTS(SELECT 1 FROM public.admin_local_accounts a WHERE a.admin_identity_id=$1 AND a.totp_ciphertext IS NOT NULL) totp,
    EXISTS(SELECT 1 FROM public.admin_local_logins l JOIN public.admin_local_accounts a ON a.id=l.account_id
      WHERE l.session_id=$2 AND a.admin_identity_id=$1 AND l.state='CONSUMED' AND l.second_factor IN('TOTP','RECOVERY_CODE')) coded`,
    [orders.actorId, orders.sessionId],
  );
  if (row?.["holds"] !== true) return artistNoteFailure("FORBIDDEN");
  const gate: AdminArtistNoteGate =
    row["totp"] !== true
      ? "TOTP_NOT_ENABLED"
      : row["coded"] === true
        ? "READY"
        : "SIGN_IN_WITHOUT_CODE";
  return { outcome: "SUCCESS", principal: { orders, gate } };
}
