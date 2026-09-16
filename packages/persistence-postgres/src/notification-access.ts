import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  canonicalRequestIdSchema,
  notificationAttachLinkResultSchema,
  notificationRecipientResultSchema,
  type NotificationAttachLinkCommand,
  type NotificationConfirmSendCommand,
  type NotificationLeaseCommand,
} from "@fan-support/contracts";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  currentNotificationLease,
  hasLaterNotification,
  lockNotification,
  notificationClock,
  notificationFailed,
  notificationSkip,
  rejectNotification,
} from "./notification-data.js";
import { stopNotification } from "./notification-lifecycle.js";
import {
  auditOrderAccess,
  insertAccessToken,
  retireAccessTokens,
} from "./order-access-write.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function attachNotificationLink(
  client: TransactionClient,
  command: NotificationAttachLinkCommand,
) {
  const row = await lockNotification(client, command.notificationId);
  if (!row || !(await currentNotificationLease(client, command)))
    return rejectNotification("LEASE_LOST");
  if (command.credential.pepperVersion !== row["link_pepper_version"])
    return rejectNotification("INVALID_COMMAND");
  if (row["link_token_id"] === null) {
    if (await hasLaterNotification(client, row))
      return rejectNotification("LINK_UNAVAILABLE");
    await retireAccessTokens(client, row["order_id"]);
    const token = await insertAccessToken(
      client,
      row["order_id"],
      command.credential,
      Number(row["link_ttl_seconds"]),
    );
    await auditOrderAccess(
      client,
      {
        requestId: canonicalRequestIdSchema.parse(row["request_id"]),
        correlationId: canonicalRequestIdSchema.parse(row["correlation_id"]),
        taskName: "order-notification",
      },
      "ISSUE",
      row["order_id"],
      token["id"],
      null,
    );
    await client.query(
      `UPDATE public.notification_runtime_state SET link_token_id=$2::uuid,updated_at=clock_timestamp() WHERE notification_delivery_id=$1::uuid`,
      [command.notificationId, token["id"]],
    );
    row["link_token_id"] = token["id"];
  }
  const [link] = await draftRows(
    client,
    `SELECT o.public_order_id,${cartTimestamp("t.expires_at")} expires_at,encode(t.token_digest,'hex') token_digest,t.token_pepper_version FROM public.order_access_tokens t JOIN public.orders o ON o.id=t.order_id WHERE t.id=$1::uuid AND t.order_id=$2::uuid AND t.purpose='LINK'`,
    [row["link_token_id"], row["order_id"]],
  );
  if (
    !link ||
    link["token_digest"] !== command.credential.tokenDigest ||
    link["token_pepper_version"] !== command.credential.pepperVersion
  )
    return rejectNotification("INTEGRITY_VIOLATION");
  return notificationAttachLinkResultSchema.parse({
    schemaVersion: 1,
    publicOrderId: link["public_order_id"],
    expiresAt: link["expires_at"],
  });
}

async function contact(client: TransactionClient, row: DraftRow) {
  const [value] = await draftRows(
    client,
    `SELECT c.id,c.retention_status,c.email_ciphertext,c.encrypted_data_key,c.encryption_key_version FROM public.customer_contacts c JOIN public.orders o ON o.customer_contact_id=c.id JOIN public.notification_runtime_state r ON r.notification_delivery_id=$3::uuid WHERE c.id=$1::uuid AND o.id=$2::uuid AND c.email_lookup_hmac=r.contact_lookup_hmac AND c.lookup_key_version=r.contact_lookup_key_version FOR SHARE OF c`,
    [row["customer_contact_id"], row["order_id"], row["id"]],
  );
  return value;
}
const encrypted = (bytes: unknown) => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    return rejectNotification("CONTACT_UNAVAILABLE");
  return `enc:v1:${Buffer.from(bytes).toString("base64url")}`;
};

export async function notificationRecipient(
  client: TransactionClient,
  command: NotificationLeaseCommand,
) {
  const row = await lockNotification(client, command.notificationId);
  if (!row || !(await currentNotificationLease(client, command)))
    return rejectNotification("LEASE_LOST");
  const value = await contact(client, row);
  if (!value || value["retention_status"] !== "ACTIVE")
    return rejectNotification("CONTACT_UNAVAILABLE");
  const now = await notificationClock(client),
    auditId = randomUUID();
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,task_name,action,subject_type,subject_id,request_id,correlation_id,outcome,field_category,created_at) VALUES($1::uuid,'WORKER','order-notification','AUTHORIZE_NOTIFICATION_CONTACT_READ','CUSTOMER_CONTACT',$2::uuid,$3::uuid,$4::uuid,'SUCCEEDED','CUSTOMER_CONTACT_EMAIL',$5::timestamptz)`,
    [auditId, value["id"], row["request_id"], row["correlation_id"], now],
  );
  await client.query(
    `INSERT INTO public.notification_contact_access_receipts(audit_log_id,notification_delivery_id,customer_contact_id,lease_token,generation,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::timestamptz)`,
    [
      auditId,
      row["id"],
      value["id"],
      command.leaseToken,
      row["generation"],
      now,
    ],
  );
  return notificationRecipientResultSchema.parse({
    schemaVersion: 1,
    customerContactId: value["id"],
    ciphertext: encrypted(value["email_ciphertext"]),
    encryptedDataKey: encrypted(value["encrypted_data_key"]),
    keyVersion: value["encryption_key_version"],
    algorithm: "AES_256_GCM",
  });
}

export async function confirmNotificationSend(
  client: TransactionClient,
  command: NotificationConfirmSendCommand,
) {
  const row = await lockNotification(client, command.notificationId);
  if (!row || !(await currentNotificationLease(client, command, false)))
    return notificationSkip;
  const now = await notificationClock(client);
  const stop = async (code: string) => {
    await stopNotification(client, row, code, now);
    return notificationFailed;
  };
  if (!(await currentNotificationLease(client, command)))
    return stop("IDEMPOTENCY_WINDOW_EXPIRED");
  if (
    row["content_hash"] !== null &&
    row["content_hash"] !== command.contentHash
  )
    return stop("TEMPLATE_CONTENT_DRIFT");
  if (await hasLaterNotification(client, row))
    return stop("SUPERSEDED_NOTIFICATION");
  const value = await contact(client, row);
  if (!value || value["retention_status"] !== "ACTIVE")
    return stop("CONTACT_UNAVAILABLE");
  const [proof] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.notification_contact_access_receipts a WHERE a.notification_delivery_id=$1::uuid AND a.lease_token=$2::uuid AND a.generation=$3::bigint AND a.customer_contact_id=$4::uuid) authorized`,
    [
      row["id"],
      command.leaseToken,
      row["generation"],
      row["customer_contact_id"],
    ],
  );
  if (proof?.["authorized"] !== true)
    return stop("CONTACT_ACCESS_NOT_AUTHORIZED");
  const [link] = await draftRows(
    client,
    `SELECT t.status,t.expires_at>clock_timestamp() unexpired,EXISTS(SELECT 1 FROM public.notification_delivery_attempts a WHERE a.notification_delivery_id=$3::uuid AND a.outcome='UNKNOWN') prior_unknown FROM public.order_access_tokens t WHERE t.id=$1::uuid AND t.order_id=$2::uuid AND t.purpose='LINK' FOR UPDATE`,
    [row["link_token_id"], row["order_id"], row["id"]],
  );
  if (!link || link["unexpired"] !== true || link["status"] === "EXPIRED")
    return stop("LINK_EXPIRED");
  if (link["status"] === "REVOKED") return stop("LINK_REVOKED");
  if (
    link["status"] !== "ACTIVE" &&
    !(
      link["status"] === "EXCHANGED" &&
      row["content_hash"] !== null &&
      link["prior_unknown"] === true
    )
  )
    return stop("LINK_UNAVAILABLE");
  await client.query(
    `UPDATE public.notification_runtime_state SET content_hash=coalesce(content_hash,$2),updated_at=clock_timestamp() WHERE notification_delivery_id=$1::uuid`,
    [row["id"], command.contentHash],
  );
  if (!(await currentNotificationLease(client, command)))
    return stop("LEASE_EXPIRED_BEFORE_DISPATCH");
  return { schemaVersion: 1 as const, decision: "READY" as const };
}
