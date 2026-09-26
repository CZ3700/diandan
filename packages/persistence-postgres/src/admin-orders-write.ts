import { randomUUID } from "node:crypto";
import {
  fulfillmentStatusSchema,
  type AdminOrdersStoreRequest,
  type AdminOrdersPrincipal,
} from "@fan-support/contracts";
import { decideFulfillmentTransitionCommand } from "@fan-support/domain";
import {
  deliverDigitalFulfillments,
  isDigitalFulfillmentLine,
} from "./digital-fulfillment.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  adminOrdersAudit,
  adminOrdersBytes,
  adminOrdersFailure,
  recordAdminOrderReceipt,
  readAdminOrderLines,
  rejectAdminOrdersIntegrity,
} from "./admin-orders-data.js";
import { validateAdminOrderPrivateAccess } from "./admin-orders-private.js";
import { confirmAdminOrdersAuthority } from "./admin-orders-authorization.js";
import {
  deriveAdminOrderFulfillment,
  fulfillmentActions,
  orderIsFulfillable,
  privateContentSafe,
} from "./admin-orders-rules.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function addAdminOrderNote(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  p: AdminOrdersPrincipal,
) {
  const c = request.command;
  if (c.action !== "ADD_NOTE") return rejectAdminOrdersIntegrity();
  const expired = await confirmAdminOrdersAuthority(client, p);
  if (expired) return expired;
  const audit = await adminOrdersAudit(
    client,
    request,
    p,
    "ORDER_NOTE_ADDED",
    "ORDER",
    c.orderId,
    "ORDER_PRIVATE",
  );
  await client.query(
    `INSERT INTO public.admin_order_notes(id,order_id,actor_id,session_id,ciphertext,encrypted_data_key,key_version,audit_log_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      c.envelope.noteId,
      c.orderId,
      p.actorId,
      p.sessionId,
      adminOrdersBytes(c.envelope.ciphertext),
      adminOrdersBytes(c.envelope.encryptedDataKey),
      c.envelope.keyVersion,
      audit,
    ],
  );
  return recordAdminOrderReceipt(client, request, p, c.envelope.noteId, audit);
}
export async function reviewAdminOrderMessage(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  p: AdminOrdersPrincipal,
) {
  const c = request.command;
  if (c.action !== "REVIEW_MESSAGE") return rejectAdminOrdersIntegrity();
  const lines = await readAdminOrderLines(client, c.orderId, true),
    line = lines.find((l) => l["item_id"] === c.itemId);
  if (!line) return adminOrdersFailure("NOT_FOUND");
  if (Number(line["intent_version"]) !== c.expectedIntentVersion)
    return adminOrdersFailure("STALE_VERSION");
  // ADR-019: a delivered digital support record still has its message reviewed.
  if (
    !["PENDING", "ON_HOLD"].includes(String(line["status"])) &&
    !(
      line["status"] === "DELIVERED" &&
      isDigitalFulfillmentLine({ giftKind: String(line["gift_kind"]) })
    )
  )
    return adminOrdersFailure("TRANSITION_NOT_ALLOWED");
  const valid = await validateAdminOrderPrivateAccess(client, c.accessId, p);
  if (valid.outcome === "FAILURE") return valid;
  const a = valid.access;
  if (
    a["kind"] !== "MESSAGE" ||
    a["order_id"] !== c.orderId ||
    a["item_id"] !== c.itemId ||
    Number(a["intent_version"]) !== c.expectedIntentVersion ||
    a["review_locale"] !== c.reviewLocale
  )
    return adminOrdersFailure("CONFLICT");
  const [confirmation] = await draftRows(
    client,
    "SELECT access_id FROM public.admin_order_private_confirmations WHERE access_id=$1",
    [c.accessId],
  );
  if (!confirmation) return adminOrdersFailure("PRIVATE_ACCESS_EXPIRED");
  const [time] = await draftRows(
    client,
    "SELECT updated_at<=transaction_timestamp() valid FROM public.support_intents WHERE id=$1",
    [line["support_intent_id"]],
  );
  if (time?.["valid"] !== true) return adminOrdersFailure("CONFLICT");
  const id = randomUUID(),
    audit = await adminOrdersAudit(
      client,
      request,
      p,
      "ORDER_MESSAGE_REVIEWED",
      "SUPPORT_INTENT",
      line["support_intent_id"],
      "SUPPORT_INTENT_PRIVATE",
    );
  await client.query(
    `UPDATE public.support_intents SET moderation_status=$2,moderation_reason_code=$3,moderation_decision_kind='HUMAN',moderation_reviewer_id=$4,moderation_rule_version=NULL,moderation_evidence_id=NULL,reviewed_at=transaction_timestamp(),version=version+1,updated_at=transaction_timestamp() WHERE id=$1`,
    [
      line["support_intent_id"],
      c.decision,
      c.decision === "APPROVED" ? null : c.reasonCode,
      p.actorId,
    ],
  );
  await client.query(
    `INSERT INTO public.admin_order_message_reviews(id,order_id,item_id,support_intent_id,actor_id,session_id,access_id,expected_intent_version,result_intent_version,review_locale,language_confirmed,decision,reason_code,audit_log_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::bigint,$8::bigint+1,$9,true,$10,$11,$12)`,
    [
      id,
      c.orderId,
      c.itemId,
      line["support_intent_id"],
      p.actorId,
      p.sessionId,
      c.accessId,
      c.expectedIntentVersion,
      c.reviewLocale,
      c.decision,
      c.reasonCode,
      audit,
    ],
  );
  return recordAdminOrderReceipt(client, request, p, id, audit);
}
export async function mutateAdminOrderFulfillment(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
  p: AdminOrdersPrincipal,
  order: DraftRow,
) {
  const c = request.command;
  if (
    c.action !== "PREPARE" &&
    c.action !== "DELIVER" &&
    c.action !== "HOLD" &&
    c.action !== "RESUME"
  )
    return rejectAdminOrdersIntegrity();
  const lines = await readAdminOrderLines(client, c.orderId, true),
    line = lines.find((l) => l["fulfillment_id"] === c.fulfillmentId);
  if (!line) return adminOrdersFailure("NOT_FOUND");
  if (Number(line["fulfillment_version"]) !== c.expectedFulfillmentVersion)
    return adminOrdersFailure("STALE_VERSION");
  if (!orderIsFulfillable(order))
    return adminOrdersFailure("PAYMENT_NOT_CONFIRMED");
  if (c.action !== "HOLD" && !privateContentSafe(line))
    return adminOrdersFailure("MODERATION_REQUIRED");
  if (!fulfillmentActions(order, line, p.permissions).includes(c.action))
    return adminOrdersFailure("TRANSITION_NOT_ALLOWED");
  const target = fulfillmentStatusSchema.parse(
    c.action === "PREPARE"
      ? "PREPARING"
      : c.action === "DELIVER"
        ? "DELIVERED"
        : c.action === "HOLD"
          ? "ON_HOLD"
          : line["resume_status"],
  );
  const decision = decideFulfillmentTransitionCommand({
    schemaVersion: 1,
    subject: {
      schemaVersion: 1,
      id: c.fulfillmentId,
      orderId: c.orderId,
      orderItemId: line["item_id"],
      version: Number(line["fulfillment_version"]),
      status: line["status"],
    },
    order: {
      schemaVersion: 1,
      id: c.orderId,
      version: Number(order["version"]),
      orderStatus: order["order_status"],
      paymentStatus: order["payment_status"],
      currentPaymentAttemptId: order["current_payment_attempt_id"],
    },
    expectedVersion: c.expectedFulfillmentVersion,
    target,
    authority: { kind: "OPERATOR_COMMAND", reasonCode: c.reasonCode },
  });
  if (decision.decision !== "APPLIED")
    return adminOrdersFailure("TRANSITION_NOT_ALLOWED");
  const [time] = await draftRows(
    client,
    "SELECT updated_at<=transaction_timestamp() valid FROM public.fulfillments WHERE id=$1",
    [c.fulfillmentId],
  );
  if (time?.["valid"] !== true) return adminOrdersFailure("CONFLICT");
  const expired = await confirmAdminOrdersAuthority(client, p);
  if (expired) return expired;
  const id = randomUUID(),
    eventId = randomUUID(),
    outboxId = randomUUID(),
    audit = await adminOrdersAudit(
      client,
      request,
      p,
      "FULFILLMENT_STATUS_CHANGED",
      "FULFILLMENT",
      c.fulfillmentId,
    );
  await client.query(
    `UPDATE public.fulfillments SET status=$2,hold_reason_code=CASE WHEN $2::text='ON_HOLD' THEN $3 ELSE NULL END,prepared_at=CASE WHEN $2::text='PREPARING' THEN coalesce(prepared_at,transaction_timestamp()) ELSE prepared_at END,delivered_at=CASE WHEN $2::text='DELIVERED' THEN transaction_timestamp() ELSE NULL END,version=version+1,updated_at=transaction_timestamp() WHERE id=$1`,
    [c.fulfillmentId, target, c.reasonCode],
  );
  await client.query(
    `INSERT INTO public.fulfillment_events(id,fulfillment_id,order_id,sequence,from_status,to_status,authority_kind,reason_code,admin_identity_id,audit_log_id,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,'ADMIN',$7,$8,$9,$10,$11)`,
    [
      eventId,
      c.fulfillmentId,
      c.orderId,
      c.expectedFulfillmentVersion + 1,
      line["status"],
      target,
      c.reasonCode,
      p.actorId,
      audit,
      request.access.requestId,
      request.access.correlationId,
    ],
  );
  // ADR-019: resuming a held digital support line delivers it in the same transaction.
  let finalStatus: string = target;
  if (
    target === "PENDING" &&
    isDigitalFulfillmentLine({ giftKind: String(line["gift_kind"]) })
  ) {
    const [clock] = await draftRows(
      client,
      `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
    );
    const delivered = await deliverDigitalFulfillments(client, {
      orderId: c.orderId,
      lines: [
        {
          fulfillmentId: c.fulfillmentId,
          orderItemId: String(line["item_id"]),
          status: "PENDING",
          version: c.expectedFulfillmentVersion + 1,
          giftKind: "VIRTUAL",
        },
      ],
      at: String(clock?.["at"]),
      taskName: "admin-orders:digital-delivery",
      requestId: request.access.requestId,
      correlationId: request.access.correlationId,
      appendOutbox: async (event) => {
        await client.query(
          `INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,locale,market,currency,idempotency_key,correlation_id,request_id,occurred_at,available_at,payload_status) VALUES($1,'FULFILLMENT_STATUS_CHANGED','FULFILLMENT',$2,$3,$2,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$11::timestamptz,'DELIVERED')`,
          [
            randomUUID(),
            event.fulfillmentId,
            event.version,
            event.orderId,
            order["presentation_locale"],
            order["market"],
            order["currency"],
            `digital-fulfillment:${event.eventId}`,
            request.access.correlationId,
            request.access.requestId,
            event.at,
          ],
        );
      },
    });
    if (delivered.length === 1) finalStatus = "DELIVERED";
  }
  const aggregate = deriveAdminOrderFulfillment(
    lines.map((l) => (l === line ? { ...l, status: finalStatus } : l)),
  );
  if (aggregate !== order["fulfillment_status"]) {
    await client.query(
      "UPDATE public.orders SET fulfillment_status=$2,version=version+1,updated_at=transaction_timestamp() WHERE id=$1",
      [c.orderId, aggregate],
    );
    await client.query(
      `INSERT INTO public.order_events(id,order_id,sequence,event_type,from_order_status,to_order_status,from_payment_status,to_payment_status,from_dispute_status,to_dispute_status,from_fulfillment_status,to_fulfillment_status,from_payment_attempt_id,to_payment_attempt_id,authority_kind,reason_code,request_id,correlation_id)
 VALUES($1,$2,$3,'FULFILLMENT_AGGREGATE_CHANGED',$4,$4,$5,$5,$6,$6,$7,$8,$9,$9,'FULFILLMENT',$10,$11,$12)`,
      [
        randomUUID(),
        c.orderId,
        Number(order["version"]) + 1,
        order["order_status"],
        order["payment_status"],
        order["dispute_status"],
        order["fulfillment_status"],
        aggregate,
        order["current_payment_attempt_id"],
        c.reasonCode,
        request.access.requestId,
        request.access.correlationId,
      ],
    );
  }
  await client.query(
    `INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,locale,market,currency,idempotency_key,correlation_id,request_id,occurred_at,available_at,payload_status) VALUES($1,'FULFILLMENT_STATUS_CHANGED','FULFILLMENT',$2,$3,$2,$4,$5,$6,$7,$8,$9,$10,transaction_timestamp(),transaction_timestamp(),$11)`,
    [
      outboxId,
      c.fulfillmentId,
      c.expectedFulfillmentVersion + 1,
      c.orderId,
      order["presentation_locale"],
      order["market"],
      order["currency"],
      `admin-fulfillment:${eventId}`,
      request.access.correlationId,
      request.access.requestId,
      target,
    ],
  );
  await client.query(
    `INSERT INTO public.admin_order_fulfillment_receipts(id,order_id,fulfillment_id,fulfillment_event_id,outbox_event_id,actor_id,session_id,action,expected_order_version,expected_fulfillment_version,reason_code,confirmed,audit_log_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      c.orderId,
      c.fulfillmentId,
      eventId,
      outboxId,
      p.actorId,
      p.sessionId,
      c.action,
      c.expectedOrderVersion,
      c.expectedFulfillmentVersion,
      c.reasonCode,
      "confirmed" in c && c.confirmed,
      audit,
    ],
  );
  return recordAdminOrderReceipt(client, request, p, id, audit);
}
