import {
  adminOrdersProofRenditionLocationSchema,
  adminOrdersProofSchema,
  type AdminOrdersPrincipal,
  type AdminOrdersProof,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  adminOrdersFailure,
  adminOrdersTimestamp,
  rejectAdminOrdersIntegrity,
} from "./admin-orders-data.js";
import type { TransactionClient } from "./transaction-runner.js";

const activeProof = `NOT EXISTS(SELECT 1 FROM public.fulfillment_proof_withdrawals w WHERE w.proof_id=p.id)`;

/** Active (not withdrawn) photos per fulfillment line, in attachment order. */
export async function readActiveLineProofs(
  client: TransactionClient,
  orderId: string,
): Promise<Map<string, AdminOrdersProof[]>> {
  const rows = await draftRows(
    client,
    `SELECT p.fulfillment_id,p.id proof_id,p.sequence,${adminOrdersTimestamp("p.created_at")} created_at,u.display_width,u.display_height,u.thumbnail_width,u.thumbnail_height
     FROM public.fulfillment_proofs p JOIN public.fulfillment_proof_uploads u ON u.id=p.upload_id AND u.fulfillment_id=p.fulfillment_id
     WHERE p.order_id=$1::uuid AND u.status='READY' AND ${activeProof} ORDER BY p.fulfillment_id,p.sequence`,
    [orderId],
  );
  const proofs = new Map<string, AdminOrdersProof[]>();
  for (const row of rows) {
    const fulfillmentId = String(row["fulfillment_id"]);
    proofs.set(fulfillmentId, [
      ...(proofs.get(fulfillmentId) ?? []),
      adminOrdersProofSchema.parse({
        proofId: row["proof_id"],
        sequence: Number(row["sequence"]),
        createdAt: row["created_at"],
        width: row["display_width"],
        height: row["display_height"],
        thumbnailWidth: row["thumbnail_width"],
        thumbnailHeight: row["thumbnail_height"],
      }),
    ]);
  }
  return proofs;
}

/** Counted under the caller's fulfillment row lock; sequences keep growing past withdrawals. */
export async function readProofSlots(
  client: TransactionClient,
  fulfillmentId: string,
): Promise<{ active: number; lastSequence: number }> {
  const [row] = await draftRows(
    client,
    `SELECT count(*) FILTER (WHERE ${activeProof})::integer active,coalesce(max(p.sequence),0)::integer last_sequence FROM public.fulfillment_proofs p WHERE p.fulfillment_id=$1::uuid`,
    [fulfillmentId],
  );
  if (
    typeof row?.["active"] !== "number" ||
    typeof row["last_sequence"] !== "number"
  )
    return rejectAdminOrdersIntegrity();
  return { active: row["active"], lastSequence: row["last_sequence"] };
}

/** Viewing is limited to people who handle deliveries: a photo can show the fan's card. */
export async function readAdminProofRendition(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
) {
  const c = request.command;
  if (c.action !== "VIEW_PROOF") return rejectAdminOrdersIntegrity();
  if (
    !principal.permissions.some(
      (permission) =>
        permission === "orders.fulfillment" || permission === "orders.manage",
    )
  )
    return adminOrdersFailure("FORBIDDEN");
  const prefix = c.rendition === "display" ? "display" : "thumbnail";
  const [row] = await draftRows(
    client,
    `SELECT u.${prefix}_object_key object_key,u.${prefix}_checksum_sha256 checksum_sha256,u.${prefix}_byte_size byte_size,u.${prefix}_width width,u.${prefix}_height height
     FROM public.fulfillment_proofs p JOIN public.fulfillment_proof_uploads u ON u.id=p.upload_id AND u.fulfillment_id=p.fulfillment_id
     WHERE p.id=$1::uuid AND p.order_id=$2::uuid AND u.status='READY' AND ${activeProof}`,
    [c.proofId, c.orderId],
  );
  if (!row) return adminOrdersFailure("NOT_FOUND");
  return adminOrdersProofRenditionLocationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PROOF_RENDITION",
    orderId: c.orderId,
    proofId: c.proofId,
    rendition: c.rendition,
    identity: {
      objectKey: row["object_key"],
      checksumSha256: row["checksum_sha256"],
      byteSize: row["byte_size"],
      width: row["width"],
      height: row["height"],
      mimeType: "image/webp",
    },
    authorizedAt: principal.authorizedAt,
    sessionExpiresAt: principal.sessionExpiresAt,
  });
}
