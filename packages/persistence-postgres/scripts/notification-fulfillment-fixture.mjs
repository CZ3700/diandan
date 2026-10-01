import { randomBytes, randomUUID } from "node:crypto";
import {
  createAdminOrdersUseCases,
  digestAdminContentToken,
} from "@fan-support/application";

/** Local TEST identity; fulfillment facts still pass normal application authorization and receipts. */
export async function createNotificationFulfillmentFixture(context) {
  const { client, persistence, check } = context;
  const actorId = randomUUID(),
    roleId = randomUUID(),
    sessionId = randomUUID(),
    tokenPepper = randomBytes(32).toString("hex"),
    sessionToken = randomBytes(32).toString("base64url"),
    csrfToken = randomBytes(32).toString("base64url");
  const digest = (purpose, token) =>
    digestAdminContentToken({ tokenPepper, purpose, token });
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://notification-fulfillment.example.test',decode($2,'hex'),'ACTIVE')",
      [actorId, randomBytes(32).toString("hex")],
    );
    await client.query(
      "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'TEST notification fulfillment only')",
      [roleId, `notification-fulfillment-test:${actorId}`],
    );
    for (const permission of [
      "orders.read",
      "orders.fulfillment",
      "orders.manage",
    ]) {
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'TEST notification fulfillment capability') ON CONFLICT(permission_key) DO NOTHING",
        [randomUUID(), permission],
      );
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key=$2",
        [roleId, permission],
      );
    }
    await client.query(
      "INSERT INTO admin_identity_roles(admin_identity_id,role_id) VALUES($1,$2)",
      [actorId, roleId],
    );
    await client.query(
      "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1 hour')",
      [
        sessionId,
        actorId,
        digest("admin-session", sessionToken),
        digest("admin-csrf", csrfToken),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const orders = createAdminOrdersUseCases({
    transactions: persistence.adminOrdersTransactionManager,
    keys: context.kms.adapter,
    tokenPepper,
  });
  const execute = (command) =>
    orders.execute({
      schemaVersion: 1,
      requestId: randomUUID(),
      sessionToken,
      csrfToken,
      command,
    });

  return async function advance(value, status, giftKind) {
    const orderId = value.state.order_id;
    const detail = await execute({
      schemaVersion: 1,
      action: "DETAIL",
      orderId,
    });
    check(
      detail.outcome === "SUCCESS" && detail.kind === "DETAIL",
      "notification fulfillment fixture reads through authorized admin use case",
    );
    const lines = giftKind
      ? detail.items.filter((line) => line.giftKind === giftKind)
      : detail.items;
    check(
      lines.length === 1,
      "notification fulfillment fixture targets one actual order line",
    );
    const line = lines[0];
    let action;
    if (status === "ON_HOLD") action = "HOLD";
    else if (status === "DELIVERED") action = "DELIVER";
    else if (status === "PREPARING")
      action = line.allowedActions.includes("RESUME") ? "RESUME" : "PREPARE";
    check(
      line.allowedActions.includes(action),
      "notification fulfillment fixture uses a currently allowed admin transition",
    );
    const result = await execute({
      schemaVersion: 1,
      action,
      orderId,
      expectedOrderVersion: detail.version,
      fulfillmentId: line.fulfillmentId,
      expectedFulfillmentVersion: line.fulfillmentVersion,
      idempotencyKey: randomUUID(),
      reasonCode: "LOCAL_NOTIFICATION_FIXTURE",
      ...(action === "HOLD" || action === "RESUME" ? { confirmed: true } : {}),
    });
    check(
      result.outcome === "SUCCESS" && result.kind === "MUTATION",
      "notification fulfillment fixture commits through authorized admin use case",
    );
    const source = (
      await client.query(
        `SELECT o.id FROM admin_order_fulfillment_receipts r
         JOIN admin_order_operation_receipts c ON c.result_id=r.id AND c.actor_id=r.actor_id AND c.audit_log_id=r.audit_log_id
         JOIN fulfillment_events e ON e.id=r.fulfillment_event_id AND e.audit_log_id=r.audit_log_id AND e.admin_identity_id=r.actor_id
         JOIN audit_logs a ON a.id=r.audit_log_id AND a.actor_id=r.actor_id
         JOIN outbox_events o ON o.id=r.outbox_event_id AND o.request_id=c.request_id
         WHERE r.id=$1 AND r.actor_id=$2 AND r.session_id=$3 AND r.action=$4
           AND e.authority_kind='ADMIN' AND e.to_status=$5
           AND a.action='FULFILLMENT_STATUS_CHANGED' AND a.outcome='SUCCEEDED'
           AND o.event_type='FULFILLMENT_STATUS_CHANGED' AND o.payload_status=$5`,
        [result.resultId, actorId, sessionId, action, status],
      )
    ).rows;
    check(
      source.length === 1,
      "notification source has matching admin authority, audit, fulfillment and operation receipts",
    );
    return source[0].id;
  };
}
