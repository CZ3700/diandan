import { randomUUID } from "node:crypto";
import {
  DELIVERY_PROOF_PROFILE,
  type AdminOrdersPrincipal,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  adminOrdersAudit,
  adminOrdersFailure,
  readAdminOrderLines,
  recordAdminOrderReceipt,
  rejectAdminOrdersIntegrity,
} from "./admin-orders-data.js";
import { confirmAdminOrdersAuthority } from "./admin-orders-authorization.js";
import { proofActions } from "./admin-orders-rules.js";
import { readProofSlots } from "./admin-order-proofs-read.js";
import type { TransactionClient } from "./transaction-runner.js";

async function lockedLine(
  client: TransactionClient,
  orderId: string,
  fulfillmentId: string,
) {
  // The fulfillment row lock serializes every proof change of this line.
  const lines = await readAdminOrderLines(client, orderId, true);
  return lines.find((line) => line["fulfillment_id"] === fulfillmentId);
}

/** Binds 1–3 of the operator's own READY uploads to a physical line in one audited operation. */
export async function attachDeliveryProofs(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
) {
  const c = request.command;
  if (c.action !== "ATTACH_PROOFS") return rejectAdminOrdersIntegrity();
  const line = await lockedLine(client, c.orderId, c.fulfillmentId);
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
  if (
    slots.active + c.uploadIds.length >
    DELIVERY_PROOF_PROFILE.maxActiveProofsPerLine
  )
    return adminOrdersFailure("PROOF_LIMIT_REACHED");
  const uploads = await draftRows(
    client,
    `SELECT u.id,u.fulfillment_id,u.actor_id,u.status,EXISTS(SELECT 1 FROM public.fulfillment_proofs p WHERE p.upload_id=u.id) attached
     FROM public.fulfillment_proof_uploads u WHERE u.id=ANY($1::uuid[]) AND u.order_id=$2::uuid FOR SHARE OF u`,
    [c.uploadIds, c.orderId],
  );
  if (
    uploads.length !== c.uploadIds.length ||
    uploads.some(
      (upload) =>
        upload["fulfillment_id"] !== c.fulfillmentId ||
        upload["actor_id"] !== principal.actorId,
    )
  )
    return adminOrdersFailure("NOT_FOUND");
  if (
    uploads.some(
      (upload) => upload["status"] !== "READY" || upload["attached"] !== false,
    )
  )
    return adminOrdersFailure("CONFLICT");
  const expired = await confirmAdminOrdersAuthority(client, principal);
  if (expired) return expired;
  const audit = await adminOrdersAudit(
      client,
      request,
      principal,
      "DELIVERY_PROOF_ATTACHED",
      "FULFILLMENT",
      c.fulfillmentId,
    ),
    attachmentId = randomUUID();
  for (const [index, uploadId] of c.uploadIds.entries())
    await client.query(
      `INSERT INTO public.fulfillment_proofs(id,order_id,fulfillment_id,upload_id,attachment_id,sequence,actor_id,session_id,audit_log_id,privacy_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [
        randomUUID(),
        c.orderId,
        c.fulfillmentId,
        uploadId,
        attachmentId,
        slots.lastSequence + index + 1,
        principal.actorId,
        principal.sessionId,
        audit,
      ],
    );
  return recordAdminOrderReceipt(
    client,
    request,
    principal,
    attachmentId,
    audit,
  );
}

/** Manager-only takedown of one active photo; the private object is retained as evidence. */
export async function withdrawDeliveryProof(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  principal: AdminOrdersPrincipal,
) {
  const c = request.command;
  if (c.action !== "WITHDRAW_PROOF") return rejectAdminOrdersIntegrity();
  const line = await lockedLine(client, c.orderId, c.fulfillmentId);
  if (!line) return adminOrdersFailure("NOT_FOUND");
  if (Number(line["fulfillment_version"]) !== c.expectedFulfillmentVersion)
    return adminOrdersFailure("STALE_VERSION");
  const [proof] = await draftRows(
    client,
    `SELECT p.id FROM public.fulfillment_proofs p WHERE p.id=$1::uuid AND p.fulfillment_id=$2::uuid AND p.order_id=$3::uuid
     AND NOT EXISTS(SELECT 1 FROM public.fulfillment_proof_withdrawals w WHERE w.proof_id=p.id)`,
    [c.proofId, c.fulfillmentId, c.orderId],
  );
  if (!proof) return adminOrdersFailure("NOT_FOUND");
  const expired = await confirmAdminOrdersAuthority(client, principal);
  if (expired) return expired;
  const audit = await adminOrdersAudit(
      client,
      request,
      principal,
      "DELIVERY_PROOF_WITHDRAWN",
      "FULFILLMENT_PROOF",
      c.proofId,
    ),
    id = randomUUID();
  await client.query(
    `INSERT INTO public.fulfillment_proof_withdrawals(id,proof_id,order_id,actor_id,session_id,audit_log_id,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      c.proofId,
      c.orderId,
      principal.actorId,
      principal.sessionId,
      audit,
      c.reasonCode,
    ],
  );
  return recordAdminOrderReceipt(client, request, principal, id, audit);
}
