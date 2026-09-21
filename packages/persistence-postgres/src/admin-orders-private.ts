import { randomUUID } from "node:crypto";
import {
  adminOrdersPrivateSnapshotSchema,
  adminOrdersPrivateConfirmationSchema,
  type AdminOrdersStoreRequest,
  type AdminOrdersConfirmPrivate,
  type AdminOrdersPrincipal,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  authorizeAdminOrders,
  confirmAdminOrdersAuthority,
} from "./admin-orders-authorization.js";
import {
  adminOrdersAudit,
  adminOrdersEncrypted,
  adminOrdersFailure,
  adminOrdersTimestamp,
  lockAdminOrder,
  readAdminOrderLines,
} from "./admin-orders-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export async function prepareAdminOrderPrivate(
  client: TransactionClient,
  request: AdminOrdersStoreRequest,
) {
  const c = request.command;
  if (c.action !== "READ_MESSAGE" && c.action !== "READ_NOTES")
    return adminOrdersFailure("INVALID_COMMAND");
  const auth = await authorizeAdminOrders(client, request.access, {
    permission:
      c.action === "READ_MESSAGE" ? "orders.message.read" : "orders.note",
    ...(c.action === "READ_MESSAGE" ? { reviewLocale: c.reviewLocale } : {}),
  });
  if (auth.outcome === "FAILURE") return auth;
  const p = auth.principal;
  if (!p.permissions.includes("orders.read"))
    return adminOrdersFailure("FORBIDDEN");
  const order = await lockAdminOrder(client, c.orderId);
  if (!order) return adminOrdersFailure("NOT_FOUND");
  const expired = await confirmAdminOrdersAuthority(client, p);
  if (expired) return expired;
  const accessId = randomUUID();
  if (c.action === "READ_MESSAGE") {
    const row = (await readAdminOrderLines(client, c.orderId, true)).find(
      (r) => r["item_id"] === c.itemId,
    );
    if (!row) return adminOrdersFailure("NOT_FOUND");
    if (Number(row["intent_version"]) !== c.expectedIntentVersion)
      return adminOrdersFailure("STALE_VERSION");
    if (row["privacy_state"] !== "ACTIVE")
      return adminOrdersFailure("PRIVATE_CONTENT_UNAVAILABLE");
    if (
      row["fan_message_locale"] !== c.reviewLocale &&
      !p.permissions.includes("orders.message.triage")
    )
      return adminOrdersFailure("LANGUAGE_REVIEW_REQUIRED");
    const audit = await adminOrdersAudit(
      client,
      request,
      p,
      "ORDER_PRIVATE_READ",
      "ORDER",
      c.orderId,
      "ORDER_PRIVATE",
    );
    const [receipt] = await draftRows(
      client,
      `INSERT INTO public.admin_order_private_accesses(id,actor_id,session_id,order_id,kind,item_id,support_intent_id,intent_version,review_locale,material_hash,audit_log_id,request_id,correlation_id,expires_at)
 SELECT $1,$2,$3,$4,'MESSAGE',$5,s.id,s.version,$6,public.cart_private_material_hash(s.fan_message_ciphertext,s.display_mode,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,s.fan_message_locale),$7,$8,$9,LEAST($10::timestamptz,transaction_timestamp()+interval '300 seconds') FROM public.support_intents s WHERE s.id=$11 RETURNING ${adminOrdersTimestamp("expires_at")} expires_at`,
      [
        accessId,
        p.actorId,
        p.sessionId,
        c.orderId,
        c.itemId,
        c.reviewLocale,
        audit,
        request.access.requestId,
        request.access.correlationId,
        p.sessionExpiresAt,
        row["support_intent_id"],
      ],
    );
    return adminOrdersPrivateSnapshotSchema.parse({
      schemaVersion: 1,
      kind: "MESSAGE",
      accessId,
      orderId: c.orderId,
      itemId: c.itemId,
      supportIntentId: row["support_intent_id"],
      intentVersion: Number(row["intent_version"]),
      expiresAt: receipt?.["expires_at"],
      reviewLocale: c.reviewLocale,
      displayMode: row["display_mode"],
      fanMessageLocale: row["fan_message_locale"],
      fanMessageCiphertext:
        row["fan_message_ciphertext"] === null
          ? null
          : adminOrdersEncrypted(row["fan_message_ciphertext"]),
      displayNameCiphertext:
        row["display_name_ciphertext"] === null
          ? null
          : adminOrdersEncrypted(row["display_name_ciphertext"]),
      encryptedDataKey: adminOrdersEncrypted(row["encrypted_data_key"]),
      keyVersion: row["encryption_key_version"],
    });
  }
  const notes = await draftRows(
    client,
    `SELECT n.*,${adminOrdersTimestamp("n.created_at")} created_at FROM public.admin_order_notes n WHERE order_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 50 FOR SHARE`,
    [c.orderId],
  );
  const audit = await adminOrdersAudit(
    client,
    request,
    p,
    "ORDER_PRIVATE_READ",
    "ORDER",
    c.orderId,
    "ORDER_PRIVATE",
  );
  const [receipt] = await draftRows(
    client,
    `INSERT INTO public.admin_order_private_accesses(id,actor_id,session_id,order_id,kind,note_ids,audit_log_id,request_id,correlation_id,expires_at) VALUES($1,$2,$3,$4,'NOTES',$5::uuid[],$6,$7,$8,LEAST($9::timestamptz,transaction_timestamp()+interval '300 seconds')) RETURNING ${adminOrdersTimestamp("expires_at")} expires_at`,
    [
      accessId,
      p.actorId,
      p.sessionId,
      c.orderId,
      notes.map((n) => n["id"]),
      audit,
      request.access.requestId,
      request.access.correlationId,
      p.sessionExpiresAt,
    ],
  );
  return adminOrdersPrivateSnapshotSchema.parse({
    schemaVersion: 1,
    kind: "NOTES",
    accessId,
    orderId: c.orderId,
    expiresAt: receipt?.["expires_at"],
    notes: notes.map((n) => ({
      noteId: n["id"],
      actorId: n["actor_id"],
      createdAt: n["created_at"],
      envelope: {
        noteId: n["id"],
        ciphertext: adminOrdersEncrypted(n["ciphertext"]),
        encryptedDataKey: adminOrdersEncrypted(n["encrypted_data_key"]),
        keyVersion: n["key_version"],
        algorithm: "AES_256_GCM",
      },
    })),
  });
}
export async function validateAdminOrderPrivateAccess(
  client: TransactionClient,
  accessId: string,
  p: AdminOrdersPrincipal,
) {
  const [access] = await draftRows(
    client,
    `SELECT a.*,expires_at>clock_timestamp() live FROM public.admin_order_private_accesses a WHERE id=$1 AND actor_id=$2 AND session_id=$3 FOR SHARE`,
    [accessId, p.actorId, p.sessionId],
  );
  if (!access || access["live"] !== true)
    return adminOrdersFailure("PRIVATE_ACCESS_EXPIRED");
  if (!p.permissions.includes("orders.read"))
    return adminOrdersFailure("FORBIDDEN");
  if (access["kind"] === "MESSAGE") {
    if (!p.permissions.includes("orders.message.read"))
      return adminOrdersFailure("FORBIDDEN");
    if (
      !p.reviewLocales.includes(
        access["review_locale"] as (typeof p.reviewLocales)[number],
      )
    )
      return adminOrdersFailure("LANGUAGE_REVIEW_REQUIRED");
    const [intent] = await draftRows(
      client,
      `SELECT s.version,s.privacy_state,s.fan_message_locale,public.cart_private_material_hash(s.fan_message_ciphertext,s.display_mode,s.display_name_ciphertext,s.encrypted_data_key,s.encryption_key_version,s.fan_message_locale) material_hash FROM public.support_intents s JOIN public.order_items i ON i.support_intent_id=s.id WHERE s.id=$1 AND i.id=$2 AND i.order_id=$3 FOR SHARE OF s`,
      [access["support_intent_id"], access["item_id"], access["order_id"]],
    );
    if (!intent || intent["privacy_state"] !== "ACTIVE")
      return adminOrdersFailure("PRIVATE_CONTENT_UNAVAILABLE");
    if (
      Number(intent["version"]) !== Number(access["intent_version"]) ||
      intent["material_hash"] !== access["material_hash"]
    )
      return adminOrdersFailure("STALE_VERSION");
    if (
      intent["fan_message_locale"] !== access["review_locale"] &&
      !p.permissions.includes("orders.message.triage")
    )
      return adminOrdersFailure("LANGUAGE_REVIEW_REQUIRED");
  } else if (!p.permissions.includes("orders.note"))
    return adminOrdersFailure("FORBIDDEN");
  const expired = await confirmAdminOrdersAuthority(client, p);
  if (expired) return expired;
  const [live] = await draftRows(
    client,
    "SELECT expires_at>clock_timestamp() live FROM public.admin_order_private_accesses WHERE id=$1",
    [accessId],
  );
  return live?.["live"] === true
    ? { outcome: "SUCCESS" as const, access }
    : adminOrdersFailure("PRIVATE_ACCESS_EXPIRED");
}
export async function confirmAdminOrderPrivate(
  client: TransactionClient,
  c: AdminOrdersConfirmPrivate,
) {
  // The access identity is read only after current-session authentication.
  const auth = await authorizeAdminOrders(client, c.access, {
    permission: "orders.read",
  });
  if (auth.outcome === "FAILURE") return auth;
  const valid = await validateAdminOrderPrivateAccess(
    client,
    c.accessId,
    auth.principal,
  );
  if (valid.outcome === "FAILURE") return valid;
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
