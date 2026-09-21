import { cancelFinanceOrder } from "./admin-finance-cancel.js";
import { randomUUID } from "node:crypto";
import type {
  AdminFinanceStoreRequest,
  AdminFinanceResponse,
} from "@fan-support/contracts";
import type {
  InventoryRepository,
  OutboxRepository,
} from "@fan-support/persistence-port";
import {
  readAdminOrdersCapabilities,
  confirmAdminOrdersAuthority,
} from "./admin-orders-authorization.js";
import { lockAdminOrder } from "./admin-orders-data.js";
import {
  validateFinanceRefund,
  recordFinanceRefund,
} from "./admin-finance-refund-request.js";
import { readAdminFinance } from "./admin-finance-read.js";
import {
  draftRows,
  financeAudit,
  financeFailure,
  financeAttempt,
  insertPaymentRow,
  parseFinanceResponse,
  type TransactionClient,
} from "./admin-finance-data.js";
export async function executeAdminFinance(
  client: TransactionClient,
  outbox: OutboxRepository,
  inventory: InventoryRepository,
  request: AdminFinanceStoreRequest,
): Promise<AdminFinanceResponse> {
  const auth = await readAdminOrdersCapabilities(client, request.access);
  if (auth.outcome === "FAILURE")
    return financeFailure(
      auth.code === "CSRF_INVALID"
        ? "CSRF_INVALID"
        : auth.code === "UNAUTHENTICATED"
          ? "UNAUTHENTICATED"
          : "FORBIDDEN",
    );
  if (!auth.principal.permissions.includes("orders.read"))
    return financeFailure("FORBIDDEN");
  const grants = await draftRows(
    client,
    `SELECT p.id FROM admin_identity_roles ar JOIN roles r ON r.id=ar.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=$1 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() AND p.permission_key='finance.manage' FOR SHARE OF ar,r,rp,p`,
    [auth.principal.actorId],
  );
  const canManage = grants.length > 0,
    c = request.command;
  if (c.action === "LIST" || c.action === "DETAIL") {
    const result = await readAdminFinance(client, request, canManage);
    return (await confirmAdminOrdersAuthority(client, auth.principal))
      ? financeFailure("UNAUTHENTICATED")
      : result;
  }
  if (!canManage) return financeFailure("FORBIDDEN");
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `admin-finance:${auth.principal.actorId}:${c.action}:${c.idempotencyKey}`,
  ]);
  const [prior] = await draftRows(
    client,
    `SELECT * FROM admin_finance_receipts WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3`,
    [auth.principal.actorId, c.action, c.idempotencyKey],
  );
  if (prior && (await confirmAdminOrdersAuthority(client, auth.principal)))
    return financeFailure("UNAUTHENTICATED");
  if (prior)
    return prior["request_hash"] === request.requestHash &&
      prior["order_id"] === c.orderId
      ? parseFinanceResponse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          orderId: c.orderId,
          operationId: prior["operation_id"],
          refundId: prior["refund_id"],
          replayed: true,
        })
      : financeFailure("IDEMPOTENCY_CONFLICT");
  // A payment recovery owns its operation before locking order/attempt. Do not reverse that order for cancellation.
  if (c.action !== "REFUND")
    await draftRows(
      client,
      `SELECT x.id FROM payment_runtime_operations x JOIN payment_attempts a ON a.id=x.attempt_id WHERE a.order_id=$1 ORDER BY x.id FOR UPDATE OF x`,
      [c.orderId],
    );
  if (c.action !== "REFUND")
    await draftRows(
      client,
      `SELECT id FROM admin_finance_operations WHERE order_id=$1 ORDER BY id FOR UPDATE`,
      [c.orderId],
    );
  const order = await lockAdminOrder(client, c.orderId);
  if (!order) return financeFailure("NOT_FOUND");
  if (await confirmAdminOrdersAuthority(client, auth.principal))
    return financeFailure("UNAUTHENTICATED");
  if (Number(order["version"]) !== c.expectedOrderVersion)
    return financeFailure("STALE_VERSION");
  const attempt = await financeAttempt(client, order);
  const [runtimeOperation] = await draftRows(
    client,
    `SELECT id FROM payment_runtime_operations WHERE attempt_id=$1`,
    [attempt?.["id"] ?? null],
  );
  const localCancel =
    c.action === "CANCEL" &&
    (!attempt ||
      ["FAILED", "CANCELED", "EXPIRED"].includes(String(attempt?.["status"])) ||
      (attempt?.["status"] === "CREATED" &&
        attempt["provider_call_started"] === false &&
        !runtimeOperation));
  if (!attempt && !localCancel) return financeFailure("PAYMENT_NOT_CONFIRMED");
  const trace = {
    requestId: request.access.requestId,
    correlationId: request.access.correlationId,
  };
  let refundId: string | null = null,
    operationId: string = randomUUID(),
    existing = false;
  if (c.action === "REFUND") {
    const invalid = await validateFinanceRefund(client, c, order, attempt);
    if (invalid) return invalid;
    refundId = randomUUID();
  } else if (c.action === "CANCEL") {
    if (
      order["order_status"] !== "PENDING_PAYMENT" ||
      !["PENDING", "UNPAID"].includes(String(order["payment_status"])) ||
      attempt?.["status"] === "SUCCEEDED"
    )
      return financeFailure("TRANSITION_NOT_ALLOWED");
    const [active] = await draftRows(
      client,
      `SELECT id FROM admin_finance_operations WHERE attempt_id=$1 AND action='CANCEL' AND phase<>'COMPLETE'`,
      [attempt?.["id"]],
    );
    if (active) return financeFailure("RECONCILIATION_REQUIRED");
  } else {
    if (c.target.kind === "PAYMENT") {
      if (
        c.target.attemptId !== attempt?.["id"] ||
        ["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(
          String(attempt?.["status"]),
        )
      )
        return financeFailure("TRANSITION_NOT_ALLOWED");
    } else {
      const [refund] = await draftRows(
        client,
        `SELECT r.*,x.id operation_id FROM refunds r JOIN admin_finance_operations x ON x.refund_id=r.id WHERE r.id=$1 AND r.order_id=$2 FOR UPDATE OF r,x`,
        [c.target.refundId, c.orderId],
      );
      if (!refund) return financeFailure("NOT_FOUND");
      if (["SUCCEEDED", "FAILED"].includes(String(refund["status"])))
        return financeFailure("TRANSITION_NOT_ALLOWED");
      refundId = c.target.refundId;
      operationId = String(refund["operation_id"]);
      existing = true;
    }
  }
  if (localCancel && order["writable_at_transaction"] !== true)
    return financeFailure("CONFLICT");
  const auditId = await financeAudit(client, {
    ...trace,
    actorId: auth.principal.actorId,
    action:
      c.action === "REFUND"
        ? "REFUND_REQUESTED"
        : `FINANCE_${c.action}_REQUESTED`,
    subjectType: c.action === "REFUND" ? "REFUND" : "ORDER",
    subjectId: c.action === "REFUND" ? refundId : c.orderId,
    reasonCode: c.reasonCode,
  });
  if (c.action === "REFUND") {
    await recordFinanceRefund(client, outbox, {
      command: c,
      refundId: refundId!,
      order,
      attempt,
      auditId,
      trace,
    });
  }
  if (c.action === "CANCEL" && !localCancel)
    await client.query(
      `UPDATE payment_runtime_operations SET phase='RECONCILE',lease_token_digest=NULL,lease_expires_at=NULL,audit_log_id=NULL,next_attempt_at=clock_timestamp(),version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE attempt_id=$1 AND phase='CREATE'`,
      [attempt?.["id"]],
    );
  if (!existing)
    await insertPaymentRow(client, "admin_finance_operations", {
      id: operationId,
      order_id: c.orderId,
      attempt_id: attempt?.["id"] ?? null,
      refund_id: refundId,
      action: c.action,
      phase: localCancel
        ? "COMPLETE"
        : c.action === "REFUND"
          ? "REFUND_READY"
          : c.action === "CANCEL" &&
              typeof attempt?.["external_reference"] === "string" &&
              !["FAILED", "CANCELED", "EXPIRED"].includes(
                String(attempt?.["status"]),
              )
            ? "CANCEL_READY"
            : "PAYMENT_RECONCILE",
      provider_account_id: attempt?.["provider_account_id"] ?? null,
      environment: attempt?.["environment"] ?? null,
      adapter_key: attempt?.["adapter_key"] ?? null,
      reason_code: c.reasonCode,
    });
  else
    await client.query(
      `UPDATE admin_finance_operations SET next_attempt_at=clock_timestamp(),updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1 AND phase<>'COMPLETE'`,
      [operationId],
    );
  await insertPaymentRow(client, "admin_finance_receipts", {
    id: randomUUID(),
    actor_id: auth.principal.actorId,
    session_id: auth.principal.sessionId,
    order_id: c.orderId,
    operation_id: operationId,
    refund_id: refundId,
    action: c.action,
    idempotency_key: c.idempotencyKey,
    request_hash: request.requestHash,
    expected_order_version: c.expectedOrderVersion,
    confirmed: true,
    reason_code: c.reasonCode,
    audit_log_id: auditId,
    request_id: trace.requestId,
    correlation_id: trace.correlationId,
  });
  if (localCancel) {
    await cancelFinanceOrder({
      client,
      inventory,
      outbox,
      order,
      ...(attempt ? { attempt } : {}),
      actorId: auth.principal.actorId,
      ...trace,
    });
  }
  return parseFinanceResponse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    orderId: c.orderId,
    operationId,
    refundId,
    replayed: false,
  });
}
