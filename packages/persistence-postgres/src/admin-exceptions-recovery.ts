import { createHash } from "node:crypto";
import {
  adminExceptionsClaimSchema,
  adminExceptionsSettleResultSchema,
  type AdminExceptionsClaimRequest,
  type AdminExceptionsSettleCommand,
} from "@fan-support/contracts";
import {
  draftRows,
  adminOrdersTimestamp,
  type TransactionClient,
} from "./admin-exceptions-data.js";
export async function claimException(
  client: TransactionClient,
  c: AdminExceptionsClaimRequest,
) {
  const [row] = await draftRows(
    client,
    `SELECT * FROM admin_exception_operations WHERE ($1::uuid IS NULL OR id=$1) AND(status='REQUESTED' OR(status='PROCESSING' AND lease_expires_at<=clock_timestamp())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [c.operationId],
  );
  if (!row) return null;
  const [claim] = await draftRows(
    client,
    `UPDATE admin_exception_operations SET status='PROCESSING',generation=generation+1,version=version+1,lease_token_digest=decode($2,'hex'),lease_expires_at=clock_timestamp()+$3::bigint*interval '1 millisecond',updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1 RETURNING generation,${adminOrdersTimestamp("lease_expires_at")} lease_until`,
    [row["id"], c.leaseTokenDigest, c.leaseDurationMs],
  );
  const trace = createHash("sha256")
    .update(c.requestId)
    .update(String(row["id"]))
    .digest("hex");
  const shared = {
    schemaVersion: 1,
    correlationId: c.correlationId,
    propagation: {
      schemaVersion: 1,
      requestId: c.requestId,
      traceparent: `00-${trace.slice(0, 32)}-${trace.slice(32, 48)}-01`,
    },
  };
  const webhook = row["action"] === "REPLAY_WEBHOOK";
  return adminExceptionsClaimSchema.parse({
    schemaVersion: 1,
    operationId: row["id"],
    action: row["action"],
    target: {
      kind: webhook ? "WEBHOOK" : "DEAD_LETTER",
      id: row[webhook ? "webhook_inbox_id" : "outbox_event_id"],
      consumerKey: row["consumer_key"],
    },
    generation: Number(claim?.["generation"]),
    leaseTokenDigest: c.leaseTokenDigest,
    leaseExpiresAt: claim?.["lease_until"],
    job: webhook
      ? {
          ...shared,
          jobType: "PROCESS_WEBHOOK_INBOX",
          webhookInboxId: row["webhook_inbox_id"],
        }
      : {
          ...shared,
          jobType: "DISPATCH_OUTBOX_EVENT",
          outboxEventId: row["outbox_event_id"],
          consumerKey: row["consumer_key"],
        },
  });
}
export async function settleException(
  client: TransactionClient,
  c: AdminExceptionsSettleCommand,
) {
  const [row] = await draftRows(
    client,
    `SELECT *,encode(lease_token_digest,'hex') digest,lease_expires_at>clock_timestamp() live,lease_expires_at=$2::timestamptz same_expiry FROM admin_exception_operations WHERE id=$1 FOR UPDATE`,
    [c.claim.operationId, c.claim.leaseExpiresAt],
  );
  const result = (decision: "STALE" | "RECORDED") =>
    adminExceptionsSettleResultSchema.parse({
      schemaVersion: 1,
      operationId: c.claim.operationId,
      decision,
    });
  if (
    !row ||
    row["status"] !== "PROCESSING" ||
    row["digest"] !== c.claim.leaseTokenDigest ||
    Number(row["generation"]) !== c.claim.generation ||
    row["live"] !== true ||
    row["same_expiry"] !== true ||
    row["action"] !== c.claim.action ||
    row["consumer_key"] !== c.claim.target.consumerKey ||
    (row["webhook_inbox_id"] ?? row["outbox_event_id"]) !== c.claim.target.id
  )
    return result("STALE");
  if (c.outcome === "SUCCEEDED") {
    const [proof] = await draftRows(
      client,
      `SELECT CASE WHEN $2='WEBHOOK' THEN EXISTS(SELECT 1 FROM webhook_processing_attempts WHERE webhook_inbox_id=$1 AND outcome='SUCCEEDED') ELSE EXISTS(SELECT 1 FROM outbox_dispatch_attempts WHERE outbox_event_id=$1 AND consumer_key=$3 AND outcome='SUCCEEDED') END done`,
      [c.claim.target.id, c.claim.target.kind, c.claim.target.consumerKey],
    );
    if (proof?.["done"] !== true) return result("STALE");
  }
  const rows = await draftRows(
    client,
    `UPDATE admin_exception_operations SET status=$2,reason_code=$3,lease_token_digest=NULL,lease_expires_at=NULL,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING id`,
    [row["id"], c.outcome, c.reasonCode],
  );
  return result(rows.length === 1 ? "RECORDED" : "STALE");
}
