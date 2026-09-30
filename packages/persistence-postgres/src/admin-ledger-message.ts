import { randomUUID } from "node:crypto";
import {
  adminOrdersPrivateConfirmationSchema,
  adminOrdersPrivateSnapshotSchema,
  type AdminLedgerFailure,
  type AdminLedgerStoreRequest,
  type AdminOrdersConfirmPrivate,
  type AdminOrdersPrivateConfirmation,
  type AdminOrdersPrivateSnapshot,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { confirmAdminOrdersAuthority } from "./admin-orders-authorization.js";
import {
  adminOrdersEncrypted,
  adminOrdersTimestamp,
  lockAdminOrder,
} from "./admin-orders-data.js";
import {
  ledgerFailure,
  ledgerFailureFromOrders,
  readLedgerPrincipal,
  type LedgerPrincipal,
} from "./admin-ledger-authorization.js";
import type { TransactionClient } from "./transaction-runner.js";

// ADR-022 / L3-12: revealing a fan message from the ledger. The audit and access receipt commit before the
// caller decrypts, exactly as on the orders page; 0059's receipt check repeats the broker rule below.

const WITHHELD = new Set(["REJECTED", "REDACTED"]);
const MATERIAL_HASH =
  "public.cart_private_material_hash(s.fan_message_ciphertext,s.display_mode,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,s.fan_message_locale)";

/**
 * A broker reads its own artists' messages unless the studio rejected or redacted them. Anyone else follows
 * the orders page: a grant for the review language, and triage when the message is in another language.
 */
function authority(
  p: LedgerPrincipal,
  line: DraftRow,
  reviewLocale: string,
): "BROKER" | "ORDERS" | AdminLedgerFailure {
  const own = p.brokerMessages && line["own_artist"] === true;
  if (own && !WITHHELD.has(String(line["moderation_status"]))) return "BROKER";
  if (!p.orderMessages)
    return ledgerFailure(
      own
        ? "PRIVATE_CONTENT_UNAVAILABLE"
        : p.scope === "ASSIGNED"
          ? "NOT_FOUND"
          : "FORBIDDEN",
    );
  if (
    !p.orders.reviewLocales.includes(
      reviewLocale as (typeof p.orders.reviewLocales)[number],
    )
  )
    return ledgerFailure("LANGUAGE_REVIEW_REQUIRED");
  if (
    line["fan_message_locale"] !== reviewLocale &&
    !p.orders.permissions.includes("orders.message.triage")
  )
    return ledgerFailure("LANGUAGE_REVIEW_REQUIRED");
  return "ORDERS";
}

export async function prepareLedgerMessage(
  client: TransactionClient,
  request: AdminLedgerStoreRequest,
): Promise<AdminOrdersPrivateSnapshot | AdminLedgerFailure> {
  const c = request.command;
  if (c.action !== "READ_MESSAGE") return ledgerFailure("INVALID_COMMAND");
  const auth = await readLedgerPrincipal(client, request.access);
  if (auth.outcome === "FAILURE") return auth;
  const p = auth.principal;
  if (!p.brokerMessages && !p.orderMessages) return ledgerFailure("FORBIDDEN");
  // Same lock order as the orders page, so a concurrent refund or review cannot interleave.
  if (!(await lockAdminOrder(client, c.orderId)))
    return ledgerFailure("NOT_FOUND");
  const expired = await confirmAdminOrdersAuthority(client, p.orders);
  if (expired) return ledgerFailureFromOrders(expired);
  const [line] = await draftRows(
    client,
    `SELECT i.support_intent_id,s.version intent_version,s.moderation_status,s.privacy_state,s.fan_message_locale,s.display_mode,
    s.fan_message_ciphertext,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,
    coalesce(public.idol_current_broker(i.idol_id)=$3::uuid,false) own_artist,
    EXISTS(SELECT 1 FROM public.payment_attempts pa WHERE pa.order_id=i.order_id AND pa.status='SUCCEEDED') paid
    FROM public.order_items i JOIN public.support_intents s ON s.id=i.support_intent_id WHERE i.id=$1 AND i.order_id=$2 FOR UPDATE OF s`,
    [c.itemId, c.orderId, p.orders.actorId],
  );
  if (!line || line["paid"] !== true) return ledgerFailure("NOT_FOUND");
  const granted = authority(p, line, c.reviewLocale);
  if (typeof granted !== "string") return granted;
  if (Number(line["intent_version"]) !== c.expectedIntentVersion)
    return ledgerFailure("STALE_VERSION");
  if (line["privacy_state"] !== "ACTIVE")
    return ledgerFailure("PRIVATE_CONTENT_UNAVAILABLE");
  const auditId = randomUUID(),
    accessId = randomUUID();
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category)
    VALUES($1,'ADMIN',$2,'ORDER_PRIVATE_READ','ORDER',$3,NULL,$4,$5,'SUCCEEDED','ORDER_PRIVATE')`,
    [
      auditId,
      p.orders.actorId,
      c.orderId,
      request.access.requestId,
      request.access.correlationId,
    ],
  );
  const [receipt] = await draftRows(
    client,
    `INSERT INTO public.admin_order_private_accesses(id,actor_id,session_id,order_id,kind,item_id,support_intent_id,intent_version,review_locale,material_hash,audit_log_id,request_id,correlation_id,expires_at)
    SELECT $1,$2,$3,$4,'MESSAGE',$5,s.id,s.version,$6,${MATERIAL_HASH},$7,$8,$9,LEAST($10::timestamptz,transaction_timestamp()+interval '300 seconds')
    FROM public.support_intents s WHERE s.id=$11 RETURNING ${adminOrdersTimestamp("expires_at")} expires_at`,
    [
      accessId,
      p.orders.actorId,
      p.orders.sessionId,
      c.orderId,
      c.itemId,
      c.reviewLocale,
      auditId,
      request.access.requestId,
      request.access.correlationId,
      p.orders.sessionExpiresAt,
      line["support_intent_id"],
    ],
  );
  return adminOrdersPrivateSnapshotSchema.parse({
    schemaVersion: 1,
    kind: "MESSAGE",
    accessId,
    orderId: c.orderId,
    itemId: c.itemId,
    supportIntentId: line["support_intent_id"],
    intentVersion: Number(line["intent_version"]),
    expiresAt: receipt?.["expires_at"],
    reviewLocale: c.reviewLocale,
    displayMode: line["display_mode"],
    fanMessageLocale: line["fan_message_locale"],
    fanMessageCiphertext:
      line["fan_message_ciphertext"] === null
        ? null
        : adminOrdersEncrypted(line["fan_message_ciphertext"]),
    displayNameCiphertext:
      line["display_name_ciphertext"] === null
        ? null
        : adminOrdersEncrypted(line["display_name_ciphertext"]),
    encryptedDataKey: adminOrdersEncrypted(line["encrypted_data_key"]),
    keyVersion: line["encryption_key_version"],
  });
}

/** After decryption: the same session, a live receipt, unchanged content and the same authority as before. */
export async function confirmLedgerMessage(
  client: TransactionClient,
  c: AdminOrdersConfirmPrivate,
): Promise<AdminOrdersPrivateConfirmation | AdminLedgerFailure> {
  const auth = await readLedgerPrincipal(client, c.access);
  if (auth.outcome === "FAILURE") return auth;
  const p = auth.principal;
  const [access] = await draftRows(
    client,
    `SELECT a.*,a.expires_at>clock_timestamp() live FROM public.admin_order_private_accesses a
    WHERE a.id=$1 AND a.actor_id=$2 AND a.session_id=$3 AND a.kind='MESSAGE' FOR SHARE`,
    [c.accessId, p.orders.actorId, p.orders.sessionId],
  );
  if (!access || access["live"] !== true)
    return ledgerFailure("PRIVATE_ACCESS_EXPIRED");
  const [line] = await draftRows(
    client,
    `SELECT s.version intent_version,s.privacy_state,s.moderation_status,s.fan_message_locale,${MATERIAL_HASH} material_hash,
    coalesce(public.idol_current_broker(i.idol_id)=$4::uuid,false) own_artist
    FROM public.support_intents s JOIN public.order_items i ON i.support_intent_id=s.id WHERE s.id=$1 AND i.id=$2 AND i.order_id=$3 FOR SHARE OF s`,
    [
      access["support_intent_id"],
      access["item_id"],
      access["order_id"],
      p.orders.actorId,
    ],
  );
  if (!line || line["privacy_state"] !== "ACTIVE")
    return ledgerFailure("PRIVATE_CONTENT_UNAVAILABLE");
  if (
    Number(line["intent_version"]) !== Number(access["intent_version"]) ||
    line["material_hash"] !== access["material_hash"]
  )
    return ledgerFailure("STALE_VERSION");
  const granted = authority(p, line, String(access["review_locale"]));
  if (typeof granted !== "string") return granted;
  const expired = await confirmAdminOrdersAuthority(client, p.orders);
  if (expired) return ledgerFailureFromOrders(expired);
  await client.query(
    "INSERT INTO public.admin_order_private_confirmations(access_id) VALUES($1) ON CONFLICT DO NOTHING",
    [c.accessId],
  );
  return adminOrdersPrivateConfirmationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PRIVATE_CONFIRMED",
    accessId: c.accessId,
  });
}
