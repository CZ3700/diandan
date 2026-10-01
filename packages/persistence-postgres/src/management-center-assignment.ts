import { randomUUID } from "node:crypto";
import {
  managementCenterBrokerSchema,
  managementCenterResponseSchema,
  type AdminPrincipal,
  type ManagementCenterBroker,
  type ManagementCenterClaim,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import { managementFailure } from "./management-center-operation-data.js";
import { managementGrants } from "./management-center-scope.js";
import type { TransactionClient } from "./transaction-runner.js";

// ADR-022 / L3-11: who each artist belongs to. History is append-only in `idol_assignments`;
// the database guard repeats every rule checked here.

const HOLDS_ASSIGNED = `EXISTS(SELECT 1 FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id
  WHERE ar.admin_identity_id=i.id AND p.permission_key='management.assigned' AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp())`;
/** An identity without a built-in account has no name of its own; it shows by its short id. */
const BROKER_VIEW = `SELECT i.id AS broker_id,coalesce(a.display_name,left(i.id::text,8)) AS display_name,(i.status='ACTIVE' AND ${HOLDS_ASSIGNED}) AS active
  FROM public.admin_identities i LEFT JOIN public.admin_local_accounts a ON a.admin_identity_id=i.id`;
const broker = (row: DraftRow): ManagementCenterBroker =>
  managementCenterBrokerSchema.parse({
    brokerId: row["broker_id"],
    displayName: row["display_name"],
    active: row["active"] === true,
  });

/** Active brokers, and anyone who still has artists after being suspended or changing role. */
export async function readBrokerDirectory(
  client: TransactionClient,
): Promise<ManagementCenterBroker[]> {
  const rows = await draftRows(
    client,
    `${BROKER_VIEW} WHERE (i.status='ACTIVE' AND ${HOLDS_ASSIGNED}) OR EXISTS(SELECT 1 FROM public.idols o WHERE o.status<>'archived' AND public.idol_current_broker(o.id)=i.id)
    ORDER BY display_name,i.id LIMIT 500`,
  );
  return rows.map(broker);
}
export async function readBrokers(
  client: TransactionClient,
  brokerIds: readonly string[],
): Promise<Map<string, ManagementCenterBroker>> {
  if (brokerIds.length === 0) return new Map();
  const rows = await draftRows(
    client,
    `${BROKER_VIEW} WHERE i.id=ANY($1::uuid[])`,
    [brokerIds],
  );
  return new Map(rows.map((row) => [String(row["broker_id"]), broker(row)]));
}

async function writeAssignment(
  client: TransactionClient,
  entry: Readonly<{
    artistId: string;
    sequence: number;
    brokerId: string | null;
    previousBrokerId: string | null;
    operationId: string | null;
    actorId: string;
    sessionId: string;
    requestId: string;
    /** The previous assignment's time, so history never runs backwards after a clock correction. */
    after: string | null;
    /** Why an unassignment happened, when it is not an administrator's own choice. */
    reasonCode?: "BROKER_DELETED";
  }>,
): Promise<void> {
  const [instant] = await draftRows(
    client,
    `SELECT ${utcTimestampSql("GREATEST(clock_timestamp(),$1::timestamptz)")} AS now`,
    [entry.after],
  );
  if (typeof instant?.["now"] !== "string") throw new Error("missing clock");
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
    VALUES($1,'ADMIN',$2,'IDOL_ASSIGNMENT','IDOL',$3,$4,$5,$6,'SUCCEEDED','IDOL_ASSIGNMENT',$7)`,
    [
      auditId,
      entry.actorId,
      entry.artistId,
      entry.reasonCode ??
        (entry.operationId
          ? "BROKER_CREATED"
          : entry.brokerId === null
            ? "UNASSIGNED"
            : "ASSIGNED"),
      entry.requestId,
      entry.sessionId,
      instant["now"],
    ],
  );
  await client.query(
    `INSERT INTO public.idol_assignments(id,idol_id,sequence,broker_identity_id,previous_broker_identity_id,reason,operation_id,actor_id,session_id,audit_log_id,request_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      entry.artistId,
      entry.sequence,
      entry.brokerId,
      entry.previousBrokerId,
      entry.operationId ? "BROKER_CREATED" : "ASSIGNED",
      entry.operationId,
      entry.actorId,
      entry.sessionId,
      auditId,
      entry.requestId,
      instant["now"],
    ],
  );
}

/**
 * Inside the publication that creates an artist: a broker's new artist belongs to that broker.
 * Accounts that manage every artist create it unassigned.
 */
export async function assignCreatedArtistToBroker(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  artistId: string,
): Promise<void> {
  const grants = await managementGrants(client, claim.actorId);
  if (grants.direct || !grants.assigned) return;
  await writeAssignment(client, {
    artistId,
    sequence: 1,
    brokerId: claim.actorId,
    previousBrokerId: null,
    operationId: claim.operation.operationId,
    actorId: claim.actorId,
    sessionId: claim.sessionId,
    requestId: claim.requestId,
    after: null,
  });
}

const same = (left: string | null, right: string | null) =>
  (left?.toLowerCase() ?? null) === (right?.toLowerCase() ?? null);

/** Sets or changes the broker of an artist; repeating the same assignment changes nothing. */
export async function assignArtist(
  client: TransactionClient,
  input: Readonly<{
    principal: AdminPrincipal;
    requestId: string;
    artistId: string;
    brokerId: string | null;
    expectedBrokerId: string | null;
  }>,
) {
  if (!(await managementGrants(client, input.principal.actorId)).assign)
    return managementFailure("FORBIDDEN");
  const [artist] = await draftRows(
    client,
    "SELECT id,status FROM public.idols WHERE id=$1 FOR SHARE",
    [input.artistId],
  );
  if (!artist || artist["status"] === "archived")
    return managementFailure("NOT_FOUND");
  const artistId = String(artist["id"]);
  // The same lock as the database guard, taken before the current assignment is read.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:idol-assignment:'||$1::uuid::text,0))",
    [artistId],
  );
  const [latest] = await draftRows(
    client,
    `SELECT sequence,broker_identity_id,${utcTimestampSql("created_at")} AS created_at FROM public.idol_assignments WHERE idol_id=$1 ORDER BY sequence DESC LIMIT 1`,
    [artistId],
  );
  const current =
    typeof latest?.["broker_identity_id"] === "string"
      ? latest["broker_identity_id"]
      : null;
  const assigned = async (brokerId: string | null) =>
    managementCenterResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "ARTIST_ASSIGNED",
      artistId,
      assignment:
        brokerId === null
          ? null
          : ((await readBrokers(client, [brokerId])).get(
              brokerId.toLowerCase(),
            ) ?? null),
    });
  if (same(current, input.brokerId)) return assigned(current);
  if (!same(current, input.expectedBrokerId))
    return managementFailure("TARGET_CONFLICT");
  if (
    input.brokerId !== null &&
    (await readBrokers(client, [input.brokerId])).get(
      input.brokerId.toLowerCase(),
    )?.active !== true
  )
    return managementFailure("NOT_FOUND");
  await writeAssignment(client, {
    artistId,
    sequence: Number(latest?.["sequence"] ?? 0) + 1,
    brokerId: input.brokerId,
    previousBrokerId: current,
    operationId: null,
    actorId: input.principal.actorId,
    sessionId: input.principal.sessionId,
    requestId: input.requestId,
    after:
      typeof latest?.["created_at"] === "string" ? latest["created_at"] : null,
  });
  return assigned(input.brokerId);
}

/**
 * L3-14: when a broker's account is deleted, every artist it still holds goes back to the studio, archived
 * ones included, each with its own assignment record. Runs inside the deletion, under the deleting
 * administrator's session; 0063 lets the database guard accept the archived ones. Counts only current
 * artists, the same number the staff list showed before the deletion.
 */
export async function returnBrokerArtistsToStudio(
  client: TransactionClient,
  input: Readonly<{
    brokerId: string;
    actorId: string;
    sessionId: string;
    requestId: string;
  }>,
): Promise<number> {
  const artists = await draftRows(
    client,
    "SELECT id,status<>'archived' AS current FROM public.idols WHERE public.idol_current_broker(id)=$1::uuid ORDER BY id",
    [input.brokerId],
  );
  let returned = 0;
  for (const row of artists) {
    const artistId = String(row["id"]);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:idol-assignment:'||$1::uuid::text,0))",
      [artistId],
    );
    const [latest] = await draftRows(
      client,
      `SELECT sequence,broker_identity_id,${utcTimestampSql("created_at")} AS created_at FROM public.idol_assignments WHERE idol_id=$1 ORDER BY sequence DESC LIMIT 1`,
      [artistId],
    );
    const current =
      typeof latest?.["broker_identity_id"] === "string"
        ? latest["broker_identity_id"]
        : null;
    if (!latest || !same(current, input.brokerId)) continue;
    await writeAssignment(client, {
      artistId,
      sequence: Number(latest["sequence"]) + 1,
      brokerId: null,
      previousBrokerId: current,
      operationId: null,
      actorId: input.actorId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      after:
        typeof latest["created_at"] === "string" ? latest["created_at"] : null,
      reasonCode: "BROKER_DELETED",
    });
    if (row["current"] === true) returned += 1;
  }
  return returned;
}
