import { randomUUID } from "node:crypto";
import {
  idempotencyKeySchema,
  adminExceptionsResponseSchema,
  type AdminExceptionsStoreRequest,
  type AdminExceptionsResponse,
  type AdminExceptionsFailure,
} from "@fan-support/contracts";
import type {
  AdminFinanceRepository,
  AdminOrderResendRepository,
} from "@fan-support/persistence-port";
import { authorizeExceptions } from "./admin-exceptions-authorization.js";
import { confirmAdminOrdersAuthority } from "./admin-orders-authorization.js";
import { lockAdminOrder } from "./admin-orders-data.js";
import { lockNotificationOrder } from "./notification-data.js";
import {
  exceptionSource,
  exceptionItem,
  listExceptions,
  exceptionOperations,
} from "./admin-exceptions-read.js";
import {
  draftRows,
  exceptionFailure,
  exceptionTargetKey,
  adminOrdersTimestamp,
  type TransactionClient,
} from "./admin-exceptions-data.js";
export async function executeExceptions(
  client: TransactionClient,
  request: AdminExceptionsStoreRequest,
  finance: AdminFinanceRepository,
  resends: AdminOrderResendRepository,
): Promise<AdminExceptionsResponse> {
  const auth = await authorizeExceptions(client, request.access);
  if (auth.outcome === "FAILURE") return auth;
  const c = request.command;
  if (c.action === "CONTEXT")
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "CONTEXT",
      actorId: auth.principal.actorId,
      permissions: auth.permissions,
    };
  const finish = async (result: unknown) =>
    (await confirmAdminOrdersAuthority(client, auth.principal))
      ? exceptionFailure("UNAUTHENTICATED")
      : adminExceptionsResponseSchema.parse(result);
  if (c.action === "LIST") return finish(await listExceptions(client, c, auth));
  if (c.action === "DETAIL") {
    const row = await exceptionSource(client, c.target);
    if (!row) return exceptionFailure("NOT_FOUND");
    return finish({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "DETAIL",
      item: await exceptionItem(client, row, auth),
      operations: await exceptionOperations(client, c.target),
    });
  }
  const permission = {
    REPLAY_WEBHOOK: auth.permissions.canReplayWebhook,
    RETRY_DEAD_LETTER: auth.permissions.canRetryDeadLetter,
    RECONCILE_PAYMENT: auth.permissions.canReconcilePayment,
    RETRY_NOTIFICATION: auth.permissions.canRetryNotification,
  }[c.action];
  if (!permission) return exceptionFailure("FORBIDDEN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `exception-command:${auth.principal.actorId}:${c.action}:${c.idempotencyKey}`,
  ]);
  const [prior] = await draftRows(
    client,
    `SELECT *,coalesce(operation_id,finance_operation_id,notification_resend_id) result_id FROM admin_exception_receipts WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3`,
    [auth.principal.actorId, c.action, c.idempotencyKey],
  );
  if (prior) {
    if (
      prior["request_hash"] !== request.requestHash ||
      prior["target_kind"] !== c.target.kind ||
      prior["target_id"] !== c.target.id ||
      prior["consumer_key"] !== c.target.consumerKey
    )
      return exceptionFailure("IDEMPOTENCY_CONFLICT");
    return finish({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action: c.action,
      target: c.target,
      operationId: prior["result_id"],
      replayed: true,
    });
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    exceptionTargetKey(c.target),
  ]);
  let row = await exceptionSource(client, c.target);
  if (!row) return exceptionFailure("NOT_FOUND");
  if (c.target.kind === "PAYMENT") {
    // Payment source versions track business attempt/order state. Current UNKNOWN
    // and finance-busy checks are separate from completed reconciliation history;
    // the existing finance repository owns permanent delegated request identity.
    await draftRows(
      client,
      `SELECT x.id FROM payment_runtime_operations x JOIN payment_attempts a ON a.id=x.attempt_id WHERE a.order_id=$1 ORDER BY x.id FOR UPDATE OF x`,
      [row["canonical_order_id"]],
    );
    await draftRows(
      client,
      `SELECT id FROM admin_finance_operations WHERE order_id=$1 ORDER BY id FOR UPDATE`,
      [row["canonical_order_id"]],
    );
    await lockAdminOrder(client, String(row["canonical_order_id"]));
    await draftRows(
      client,
      `SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE`,
      [c.target.id],
    );
  } else if (c.target.kind === "NOTIFICATION") {
    const [owner] = await draftRows(
      client,
      "SELECT id order_id,cart_id FROM orders WHERE id=$1",
      [row["canonical_order_id"]],
    );
    if (!owner) return exceptionFailure("NOT_FOUND");
    await lockNotificationOrder(client, owner);
  }
  row = await exceptionSource(client, c.target);
  if (!row) return exceptionFailure("NOT_FOUND");
  if (await confirmAdminOrdersAuthority(client, auth.principal))
    return exceptionFailure("UNAUTHENTICATED");
  if (row["source_version"] !== c.expectedVersion)
    return exceptionFailure("STALE_VERSION");
  const item = await exceptionItem(client, row, auth);
  if (item.allowedAction !== c.action) {
    const codes: Partial<
      Record<typeof item.blockedReason, AdminExceptionsFailure["code"]>
    > = {
      READ_ONLY: "FORBIDDEN",
      IN_PROGRESS: "SOURCE_IN_PROGRESS",
      UNSUPPORTED_CONSUMER: "UNSUPPORTED_CONSUMER",
      NOTIFICATION_UNCERTAIN: "RECONCILIATION_REQUIRED",
      NOTIFICATION_SUPERSEDED: "NOTIFICATION_NOT_READY",
    };
    return exceptionFailure(
      codes[item.blockedReason] ?? "TRANSITION_NOT_ALLOWED",
    );
  }
  const receiptId = randomUUID(),
    auditId = randomUUID();
  let operationId: string | null = null,
    financeId: string | null = null,
    resendId: string | null = null;
  if (c.action === "RECONCILE_PAYMENT") {
    const r = await finance.execute({
      schemaVersion: 1,
      access: request.access,
      requestHash: request.requestHash,
      command: {
        schemaVersion: 1,
        action: "RECONCILE",
        orderId: String(row["canonical_order_id"]),
        expectedOrderVersion: Number(row["order_version"]),
        idempotencyKey: idempotencyKeySchema.parse(`exception:${receiptId}`),
        reasonCode: c.reasonCode,
        confirmed: true,
        target: { kind: "PAYMENT", attemptId: c.target.id },
      },
    });
    if (r.outcome === "FAILURE")
      return exceptionFailure(
        r.code === "UNAUTHENTICATED"
          ? "UNAUTHENTICATED"
          : r.code === "FORBIDDEN"
            ? "FORBIDDEN"
            : r.code === "STALE_VERSION"
              ? "STALE_VERSION"
              : "CONFLICT",
      );
    if (r.kind !== "MUTATION")
      throw new Error("Invalid financial recovery receipt");
    financeId = r.operationId;
  } else if (c.action === "RETRY_NOTIFICATION") {
    const r = await resends.request({
      schemaVersion: 1,
      access: request.access,
      requestHash: request.requestHash,
      command: {
        schemaVersion: 1,
        action: "RESEND_NOTIFICATION",
        orderId: String(row["canonical_order_id"]),
        expectedOrderVersion: Number(row["order_version"]),
        expectedLatestNotificationId: c.target.id,
        idempotencyKey: idempotencyKeySchema.parse(`exception:${receiptId}`),
        reasonCode: c.reasonCode,
      },
    });
    if (r.outcome === "FAILURE")
      return exceptionFailure(
        r.code === "UNAUTHENTICATED"
          ? "UNAUTHENTICATED"
          : r.code === "FORBIDDEN"
            ? "FORBIDDEN"
            : r.code === "STALE_VERSION"
              ? "STALE_VERSION"
              : r.code === "NOTIFICATION_IN_PROGRESS"
                ? "NOTIFICATION_IN_PROGRESS"
                : "NOTIFICATION_NOT_READY",
      );
    if (r.kind !== "MUTATION")
      throw new Error("Invalid notification recovery receipt");
    resendId = r.resultId;
  } else {
    operationId = randomUUID();
    await client.query(
      `INSERT INTO admin_exception_operations(id,action,webhook_inbox_id,outbox_event_id,consumer_key,status,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,'REQUESTED',$6,$7)`,
      [
        operationId,
        c.action,
        c.target.kind === "WEBHOOK" ? c.target.id : null,
        c.target.kind === "DEAD_LETTER" ? c.target.id : null,
        c.target.consumerKey,
        request.access.requestId,
        request.access.correlationId,
      ],
    );
  }
  const [instant] = await draftRows(
      client,
      `SELECT ${adminOrdersTimestamp("clock_timestamp()")} now`,
    ),
    now = instant?.["now"];
  await client.query(
    `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,$3,'EXCEPTION_SOURCE',$4,$5,$6,$7,'SUCCEEDED',$8::timestamptz)`,
    [
      auditId,
      auth.principal.actorId,
      `EXCEPTION_${c.action}`,
      c.target.id,
      c.reasonCode,
      request.access.requestId,
      request.access.correlationId,
      now,
    ],
  );
  await client.query(
    `INSERT INTO admin_exception_receipts(id,actor_id,session_id,action,target_kind,target_id,consumer_key,operation_id,finance_operation_id,notification_resend_id,idempotency_key,request_hash,expected_version,confirmed,reason_code,audit_log_id,request_id,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16,$17,$18::timestamptz)`,
    [
      receiptId,
      auth.principal.actorId,
      auth.principal.sessionId,
      c.action,
      c.target.kind,
      c.target.id,
      c.target.consumerKey,
      operationId,
      financeId,
      resendId,
      c.idempotencyKey,
      request.requestHash,
      c.expectedVersion,
      c.reasonCode,
      auditId,
      request.access.requestId,
      request.access.correlationId,
      now,
    ],
  );
  return finish({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    action: c.action,
    target: c.target,
    operationId: operationId ?? financeId ?? resendId,
    replayed: false,
  });
}
