import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

// ADR-022 / L3-11: what a staff account may manage in the daily center. `management.direct`
// covers everything there; `management.assigned` alone covers the account's own artists.

export type ManagementGrants = Readonly<{
  direct: boolean;
  assigned: boolean;
  /** `idols.assign`: may set and change the broker an artist belongs to. */
  assign: boolean;
}>;
export async function managementGrants(
  client: TransactionClient,
  actorId: string,
): Promise<ManagementGrants> {
  const rows = await draftRows(
    client,
    `SELECT p.permission_key FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=$1 AND p.permission_key=ANY($2::text[]) AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() FOR SHARE OF ar,r,rp,p`,
    [actorId, ["management.direct", "management.assigned", "idols.assign"]],
  );
  const held = new Set(rows.map((row) => row["permission_key"]));
  return {
    direct: held.has("management.direct"),
    assigned: held.has("management.assigned"),
    assign: held.has("idols.assign"),
  };
}
/** The broker an artist currently belongs to; null is unassigned. */
export async function currentArtistBroker(
  client: TransactionClient,
  artistId: string,
): Promise<string | null> {
  const [row] = await draftRows(
    client,
    "SELECT public.idol_current_broker($1) AS broker_id",
    [artistId],
  );
  return typeof row?.["broker_id"] === "string" ? row["broker_id"] : null;
}
export type ManagementOperationTarget = Readonly<{
  kind: string;
  /** The operation creates its target: the intent carries no id. */
  creates: boolean;
  targetId: string | null;
}>;
/** A broker saves only an artist assigned to it, or one that its operation is creating. */
export async function brokerCoversOperation(
  client: TransactionClient,
  actorId: string,
  operation: ManagementOperationTarget,
): Promise<boolean> {
  if (operation.kind !== "SAVE_ARTIST" || operation.targetId === null)
    return false;
  if (
    (await currentArtistBroker(client, operation.targetId))?.toLowerCase() ===
    actorId.toLowerCase()
  )
    return true;
  if (!operation.creates) return false;
  const [existing] = await draftRows(
    client,
    "SELECT 1 FROM public.idols WHERE id=$1",
    [operation.targetId],
  );
  return existing === undefined;
}
