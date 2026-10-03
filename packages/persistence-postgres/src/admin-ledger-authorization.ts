import {
  adminLedgerFailureSchema,
  type AdminLedgerFailure,
  type AdminOrdersAccess,
  type AdminOrdersFailure,
  type AdminOrdersPrincipal,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { readAdminOrdersCapabilities } from "./admin-orders-authorization.js";
import type { TransactionClient } from "./transaction-runner.js";

// ADR-022 / L3-12: who may read which part of the artist ledger. Sessions, CSRF and liveness are the
// orders checks; the ledger keys are read beside them because the orders principal only knows orders keys.

export type LedgerPrincipal = Readonly<{
  orders: AdminOrdersPrincipal;
  /** ledger.read: every artist. Without it, ledger.assigned limits the reader to its own artists. */
  scope: "ALL" | "ASSIGNED";
  /** ledger.messages: reveal messages on the reader's own artists' lines. */
  brokerMessages: boolean;
  /** orders.read + orders.message.read: the orders page's own message rules apply. */
  orderMessages: boolean;
}>;

export const ledgerFailure = (
  code: AdminLedgerFailure["code"],
): AdminLedgerFailure =>
  adminLedgerFailureSchema.parse({
    schemaVersion: 1,
    outcome: "FAILURE",
    code,
  });

const carried = new Set<string>(adminLedgerFailureSchema.shape.code.options);
export function ledgerFailureFromOrders(
  failure: AdminOrdersFailure,
): AdminLedgerFailure {
  return ledgerFailure(
    carried.has(failure.code)
      ? (failure.code as AdminLedgerFailure["code"])
      : "TEMPORARY_UNAVAILABLE",
  );
}

export async function readLedgerPrincipal(
  client: TransactionClient,
  access: AdminOrdersAccess,
): Promise<
  { outcome: "SUCCESS"; principal: LedgerPrincipal } | AdminLedgerFailure
> {
  const result = await readAdminOrdersCapabilities(client, access);
  if (result.outcome === "FAILURE") return ledgerFailureFromOrders(result);
  const orders = result.principal;
  const rows = await draftRows(
    client,
    `SELECT DISTINCT p.permission_key FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ar.admin_identity_id=$1 AND p.permission_key IN('ledger.read','ledger.assigned','ledger.messages') AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()`,
    [orders.actorId],
  );
  const held = new Set(rows.map((row) => row["permission_key"]));
  const scope = held.has("ledger.read")
    ? "ALL"
    : held.has("ledger.assigned")
      ? "ASSIGNED"
      : null;
  if (scope === null) return ledgerFailure("FORBIDDEN");
  return {
    outcome: "SUCCESS",
    principal: {
      orders,
      scope,
      brokerMessages: held.has("ledger.messages"),
      orderMessages:
        orders.permissions.includes("orders.read") &&
        orders.permissions.includes("orders.message.read"),
    },
  };
}
