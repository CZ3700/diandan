import { randomUUID } from "node:crypto";
import {
  DELIVERY_PROOF_PROFILE,
  adminOrdersProofReservationSchema,
  adminOrdersProofUploadStateSchema,
  adminOrdersResponseSchema,
  deliveryProofSourceObjectKey,
  type AdminOrdersPrincipal,
  type AdminOrdersProofCompletion,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  adminOrdersAudit,
  adminOrdersFailure,
  adminOrdersTimestamp,
  readAdminOrderLines,
  recordAdminOrderReceipt,
  rejectAdminOrdersIntegrity,
} from "./admin-orders-data.js";
import { confirmAdminOrdersAuthority } from "./admin-orders-authorization.js";
import { proofActions } from "./admin-orders-rules.js";
import { readProofSlots } from "./admin-order-proofs-read.js";
import type { TransactionClient } from "./transaction-runner.js";

const uploadColumns = `u.id,u.order_id,u.fulfillment_id,u.actor_id,u.session_id,u.status,u.source_object_key,u.source_checksum_sha256,u.source_byte_size,u.source_mime_type,
 ${adminOrdersTimestamp("u.created_at")} created_at,${adminOrdersTimestamp("u.expires_at")} expires_at,u.expires_at>transaction_timestamp() live,
 u.display_object_key,u.display_checksum_sha256,u.display_byte_size,u.display_width,u.display_height,
 u.thumbnail_object_key,u.thumbnail_checksum_sha256,u.thumbnail_byte_size,u.thumbnail_width,u.thumbnail_height`;
const source = (row: DraftRow) => ({
  objectKey: row["source_object_key"],
  checksumSha256: row["source_checksum_sha256"],
  byteSize: row["source_byte_size"],
  mimeType: row["source_mime_type"],
});
const rendition = (row: DraftRow, prefix: "display" | "thumbnail") =>
  row["status"] === "READY"
    ? {
        objectKey: row[`${prefix}_object_key`],
        checksumSha256: row[`${prefix}_checksum_sha256`],
        byteSize: row[`${prefix}_byte_size`],
        width: row[`${prefix}_width`],
        height: row[`${prefix}_height`],
        mimeType: "image/webp",
      }
    : null;
function reservation(
  row: DraftRow,
  principal: AdminOrdersPrincipal,
  replayed: boolean,
) {
  return adminOrdersProofReservationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PROOF_RESERVATION",
    orderId: row["order_id"],
    fulfillmentId: row["fulfillment_id"],
    uploadId: row["id"],
    replayed,
    source: source(row),
    createdAt: row["created_at"],
    expiresAt: row["expires_at"],
    authorizedAt: principal.authorizedAt,
    sessionExpiresAt: principal.sessionExpiresAt,
  });
}
async function readUpload(
  client: TransactionClient,
  uploadId: string,
  orderId: string,
  lock = false,
) {
  const [row] = await draftRows(
    client,
    `SELECT ${uploadColumns} FROM public.fulfillment_proof_uploads u WHERE u.id=$1::uuid AND u.order_id=$2::uuid ${lock ? "FOR UPDATE OF u" : ""}`,
    [uploadId, orderId],
  );
  return row;
}
const ownedBy = (row: DraftRow | undefined, principal: AdminOrdersPrincipal) =>
  row !== undefined &&
  row["actor_id"] === principal.actorId &&
  row["session_id"] === principal.sessionId;

/** A replayed BEGIN may only re-sign a still-open reservation of the same operator. */
export async function replayProofReservation(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
  uploadId: string,
) {
  const c = request.command;
  if (c.action !== "BEGIN_PROOF_UPLOAD") return rejectAdminOrdersIntegrity();
  const row = await readUpload(client, uploadId, c.orderId);
  if (!row || row["actor_id"] !== principal.actorId)
    return rejectAdminOrdersIntegrity();
  if (row["status"] !== "RESERVED" || row["live"] !== true)
    return adminOrdersFailure("CONFLICT");
  return reservation(row, principal, true);
}

/** Server-assigned private source key; the reservation expires with the session or after 15 minutes. */
export async function reserveAdminProofUpload(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
) {
  const c = request.command;
  if (c.action !== "BEGIN_PROOF_UPLOAD") return rejectAdminOrdersIntegrity();
  const lines = await readAdminOrderLines(client, c.orderId, true),
    line = lines.find((l) => l["fulfillment_id"] === c.fulfillmentId);
  if (!line) return adminOrdersFailure("NOT_FOUND");
  if (Number(line["fulfillment_version"]) !== c.expectedFulfillmentVersion)
    return adminOrdersFailure("STALE_VERSION");
  const slots = await readProofSlots(client, c.fulfillmentId);
  if (
    !proofActions(line, slots.active, principal.permissions).includes("ATTACH")
  )
    return adminOrdersFailure(
      slots.active >= DELIVERY_PROOF_PROFILE.maxActiveProofsPerLine
        ? "PROOF_LIMIT_REACHED"
        : "TRANSITION_NOT_ALLOWED",
    );
  const expired = await confirmAdminOrdersAuthority(client, principal);
  if (expired) return expired;
  const audit = await adminOrdersAudit(
      client,
      request,
      principal,
      "DELIVERY_PROOF_UPLOAD_RESERVED",
      "FULFILLMENT",
      c.fulfillmentId,
    ),
    id = randomUUID();
  await client.query(
    `INSERT INTO public.fulfillment_proof_uploads(id,order_id,fulfillment_id,actor_id,session_id,audit_log_id,source_object_key,source_checksum_sha256,source_byte_size,source_mime_type,status,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RESERVED',least(transaction_timestamp()+interval '900 seconds',(SELECT s.expires_at FROM public.admin_sessions s WHERE s.id=$5::uuid)))`,
    [
      id,
      c.orderId,
      c.fulfillmentId,
      principal.actorId,
      principal.sessionId,
      audit,
      deliveryProofSourceObjectKey(id),
      c.checksumSha256,
      c.byteSize,
      c.mimeType,
    ],
  );
  await recordAdminOrderReceipt(client, request, principal, id, audit);
  const row = await readUpload(client, id, c.orderId);
  if (!row) return rejectAdminOrdersIntegrity();
  return reservation(row, principal, false);
}

/** Read before storage I/O; only the reserving session may complete its own upload. */
export async function readAdminProofUpload(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
) {
  const c = request.command;
  if (c.action !== "COMPLETE_PROOF_UPLOAD") return rejectAdminOrdersIntegrity();
  const row = await readUpload(client, c.uploadId, c.orderId);
  if (!row || !ownedBy(row, principal)) return adminOrdersFailure("NOT_FOUND");
  if (row["status"] === "RESERVED" && row["live"] !== true)
    return adminOrdersFailure("CONFLICT");
  return adminOrdersProofUploadStateSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PROOF_UPLOAD_STATE",
    orderId: row["order_id"],
    fulfillmentId: row["fulfillment_id"],
    uploadId: row["id"],
    status: row["status"],
    source: source(row),
    expiresAt: row["expires_at"],
    display: rendition(row, "display"),
    thumbnail: rendition(row, "thumbnail"),
  });
}

/** Records verified renditions once; a concurrent completion returns the stored result. */
export async function completeAdminProofUpload(
  client: TransactionClient,
  command: AdminOrdersProofCompletion,
  principal: AdminOrdersPrincipal,
) {
  const row = await readUpload(client, command.uploadId, command.orderId, true);
  if (!row || !ownedBy(row, principal)) return adminOrdersFailure("NOT_FOUND");
  const done = (width: unknown, height: unknown) =>
    adminOrdersResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PROOF_UPLOAD",
      orderId: command.orderId,
      uploadId: command.uploadId,
      width,
      height,
    });
  if (row["status"] === "READY")
    return done(row["display_width"], row["display_height"]);
  const stored = source(row);
  if (
    row["live"] !== true ||
    stored.objectKey !== command.source.objectKey ||
    stored.checksumSha256 !== command.source.checksumSha256 ||
    stored.byteSize !== command.source.byteSize ||
    stored.mimeType !== command.source.mimeType
  )
    return adminOrdersFailure("CONFLICT");
  const expired = await confirmAdminOrdersAuthority(client, principal);
  if (expired) return expired;
  const audit = randomUUID();
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome) VALUES($1,'ADMIN',$2,'DELIVERY_PROOF_UPLOAD_COMPLETED','FULFILLMENT',$3,NULL,$4,$5,'SUCCEEDED')`,
    [
      audit,
      principal.actorId,
      row["fulfillment_id"],
      command.access.requestId,
      command.access.correlationId,
    ],
  );
  const { display, thumbnail } = command.result;
  await client.query(
    `UPDATE public.fulfillment_proof_uploads SET status='READY',completed_at=transaction_timestamp(),completion_audit_log_id=$2,
      display_object_key=$3,display_checksum_sha256=$4,display_byte_size=$5,display_width=$6,display_height=$7,
      thumbnail_object_key=$8,thumbnail_checksum_sha256=$9,thumbnail_byte_size=$10,thumbnail_width=$11,thumbnail_height=$12
     WHERE id=$1::uuid`,
    [
      command.uploadId,
      audit,
      display.objectKey,
      display.checksumSha256,
      display.byteSize,
      display.width,
      display.height,
      thumbnail.objectKey,
      thumbnail.checksumSha256,
      thumbnail.byteSize,
      thumbnail.width,
      thumbnail.height,
    ],
  );
  return done(display.width, display.height);
}
