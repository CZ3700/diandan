import { randomUUID } from "node:crypto";
import {
  adminFinanceClaimSchema,
  adminFinanceProviderCommandSchema,
  type AdminFinanceClaimRequest,
  type AdminFinanceSettleCommand,
  type AdminFinanceSettleResult,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { lockAdminOrder } from "./admin-orders-data.js";
import {
  draftRows,
  adminOrdersTimestamp,
  financeAttempt,
  financeRefundTransition,
  financeClaimRow,
  financeClaimLive,
  financeAudit,
  financeIntegrity,
  type TransactionClient,
  type DraftRow,
} from "./admin-finance-data.js";
import { persistFinanceEvidence } from "./admin-finance-evidence.js";
export async function claimAdminFinance(
  client: TransactionClient,
  outbox: OutboxRepository,
  command: AdminFinanceClaimRequest,
) {
  const [op] = await draftRows(
    client,
    `SELECT * FROM admin_finance_operations WHERE phase<>'COMPLETE' AND ($1::uuid IS NULL OR id=$1) AND next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [command.operationId],
  );
  if (!op) return null;
  const order = await lockAdminOrder(client, String(op["order_id"]));
  if (!order) return financeIntegrity();
  const attempt = await financeAttempt(client, order, op["attempt_id"]);
  if (!attempt) return financeIntegrity();
  if (order["current_payment_attempt_id"] !== op["attempt_id"]) {
    if (
      !["FAILED", "CANCELED", "EXPIRED"].includes(String(attempt["status"])) ||
      op["refund_id"] !== null
    )
      return financeIntegrity();
    await financeAudit(client, {
      action: "FINANCE_OPERATION_SUPERSEDED",
      subjectType: "ORDER",
      subjectId: order["id"],
      reasonCode: "SUPERSEDED_PAYMENT_ATTEMPT",
      requestId: command.requestId,
      correlationId: command.correlationId,
    });
    await client.query(
      `UPDATE admin_finance_operations SET phase='COMPLETE',lease_token_digest=NULL,lease_expires_at=NULL,claim=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
      [op["id"]],
    );
    return null;
  }
  const externalReference = await resolveExternalReference(client, attempt);
  let refund;
  const trace = {
    requestId: command.requestId,
    correlationId: command.correlationId,
  };
  if (op["refund_id"]) {
    [refund] = await draftRows(
      client,
      `SELECT * FROM refunds WHERE id=$1 FOR UPDATE`,
      [op["refund_id"]],
    );
    if (!refund) return financeIntegrity();
    if (["SUCCEEDED", "FAILED"].includes(String(refund["status"]))) {
      await client.query(
        `UPDATE admin_finance_operations SET phase='COMPLETE',lease_token_digest=NULL,lease_expires_at=NULL,claim=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
        [op["id"]],
      );
      return null;
    }
  }
  const { providerCommand, auditLogId, phase, dispatch } =
    await prepareDispatch({
      client,
      outbox,
      op,
      order,
      attempt,
      refund,
      externalReference,
      trace,
    });
  if (auditLogId)
    await financeAudit(client, {
      action: "FINANCE_RECONCILE_DISPATCH_AUTHORIZED",
      subjectType: "ADMIN_FINANCE_OPERATION",
      subjectId: op["id"],
      requestId: command.requestId,
      correlationId: command.correlationId,
    });
  const [lease] = await draftRows(
    client,
    `UPDATE admin_finance_operations SET phase=$2,dispatch_count=$3,last_error_code=NULL,generation=generation+1,lease_token_digest=decode($4,'hex'),lease_expires_at=clock_timestamp()+$5::bigint*interval '1 millisecond',updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1 RETURNING generation,${adminOrdersTimestamp("lease_expires_at")} lease_until`,
    [
      op["id"],
      phase,
      dispatch,
      command.leaseTokenDigest,
      command.leaseDurationMs,
    ],
  );
  if (!lease) return financeIntegrity();
  const claim = adminFinanceClaimSchema.parse({
    schemaVersion: 1,
    ...trace,
    operationId: op["id"],
    orderId: op["order_id"],
    refundId: op["refund_id"],
    generation: Number(lease["generation"]),
    leaseTokenDigest: command.leaseTokenDigest,
    leaseExpiresAt: lease["lease_until"],
    adapterKey: op["adapter_key"],
    auditLogId,
    command: providerCommand,
  });
  await client.query(
    `UPDATE admin_finance_operations SET claim=$2::jsonb WHERE id=$1`,
    [op["id"], JSON.stringify(claim)],
  );
  return claim;
}
export async function settleAdminFinance(
  client: TransactionClient,
  outbox: OutboxRepository,
  input: AdminFinanceSettleCommand,
): Promise<AdminFinanceSettleResult> {
  const { claim, result } = input;
  const response = (
    decision: AdminFinanceSettleResult["decision"],
    providerEventId: string | null = null,
  ): AdminFinanceSettleResult => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    operationId: claim.operationId,
    decision,
    providerEventId,
  });
  const op = await financeClaimRow(client, claim);
  if (!op) return response("STALE");
  const order = await lockAdminOrder(client, claim.orderId);
  if (!order) return financeIntegrity();
  if (!(await financeClaimLive(client, claim))) return response("STALE");
  const notDispatched =
    result.kind === "UNCERTAIN" &&
    result.reasonCode === "PROVIDER_UNAVAILABLE" &&
    ["REFUND_PAYMENT", "CANCEL_PAYMENT"].includes(claim.command.operation);
  const success =
    result.kind === "PROVIDER_RESULT" && result.response.outcome === "SUCCESS";
  let providerEventId: string | null = null;
  if (
    success &&
    result.kind === "PROVIDER_RESULT" &&
    result.response.outcome === "SUCCESS" &&
    "event" in result.response.value
  )
    providerEventId = await persistFinanceEvidence(
      client,
      claim,
      result.response.value.event,
    );
  else if (claim.auditLogId)
    await financeAudit(client, {
      id: claim.auditLogId,
      action: "PAYMENT_PROVIDER_RECONCILE",
      subjectType: "PAYMENT_PROVIDER_ACCOUNT",
      subjectId: claim.command.providerAccountId,
      requestId: claim.requestId,
      correlationId: claim.correlationId,
      outcome: "FAILED",
    });
  if (!success && !notDispatched && claim.refundId) {
    const [refund] = await draftRows(
      client,
      `SELECT * FROM refunds WHERE id=$1 FOR UPDATE`,
      [claim.refundId],
    );
    if (
      refund &&
      ["SUBMITTING", "PROCESSING"].includes(String(refund["status"]))
    )
      await financeRefundTransition(
        client,
        outbox,
        refund,
        order,
        "UNKNOWN",
        claim,
      );
  }
  await client.query(
    `UPDATE admin_finance_operations SET phase=CASE WHEN $4::boolean THEN CASE WHEN refund_id IS NULL THEN 'CANCEL_READY' ELSE 'REFUND_READY' END ELSE phase END,lease_token_digest=NULL,lease_expires_at=NULL,claim=NULL,next_attempt_at=clock_timestamp()+$2::bigint*interval '1 millisecond',last_error_code=$3,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
    [
      claim.operationId,
      success &&
      ["REFUND_PAYMENT", "CANCEL_PAYMENT"].includes(claim.command.operation)
        ? 0
        : input.retryAfterMs,
      success
        ? null
        : result.kind === "UNCERTAIN"
          ? result.reasonCode
          : "PROVIDER_UNAVAILABLE",
      notDispatched,
    ],
  );
  return response(success ? "RECORDED" : "DEFERRED", providerEventId);
}

async function resolveExternalReference(
  client: TransactionClient,
  attempt: DraftRow,
) {
  let externalReference = attempt["external_reference"];
  if (externalReference === null) {
    const refs = await draftRows(
      client,
      `SELECT DISTINCT e.external_payment_reference FROM provider_events e JOIN provider_event_associations a ON a.provider_event_id=e.id AND a.association_status='MATCHED' WHERE a.payment_attempt_id=$1 AND e.provider_account_id=$2 AND e.environment=$3 AND e.currency=$4 AND (e.event_type<>'PAYMENT_STATUS' OR e.amount_minor=$5)`,
      [
        attempt["id"],
        attempt["provider_account_id"],
        attempt["environment"],
        attempt["currency"],
        attempt["amount_minor"],
      ],
    );
    if (refs.length > 1) return financeIntegrity();
    externalReference = refs[0]?.["external_payment_reference"] ?? null;
  }
  return externalReference;
}

async function prepareDispatch(input: {
  client: TransactionClient;
  outbox: OutboxRepository;
  op: DraftRow;
  order: DraftRow;
  attempt: DraftRow;
  refund: DraftRow | undefined;
  externalReference: unknown;
  trace: { requestId: string; correlationId: string };
}) {
  const { client, outbox, op, order, attempt, externalReference, trace } =
    input;
  let { refund } = input;
  const context = {
    schemaVersion: 1,
    providerAccountId: op["provider_account_id"],
    environment: op["environment"],
  };
  let provider: unknown,
    auditLogId: string | null = null,
    phase = String(op["phase"]),
    dispatch = Number(op["dispatch_count"]);
  if (refund) {
    if (
      phase === "REFUND_READY" &&
      (dispatch === 0 || op["last_error_code"] === "PROVIDER_UNAVAILABLE")
    ) {
      if (refund["status"] === "REQUESTED")
        refund = await financeRefundTransition(
          client,
          outbox,
          refund,
          order,
          "SUBMITTING",
          trace,
        );
      dispatch = 1;
      phase = "REFUND_RECONCILE";
      provider = {
        ...context,
        operation: "REFUND_PAYMENT",
        refundId: refund["id"],
        paymentAttemptId: attempt["id"],
        externalReference: externalReference,
        refundReference: refund["provider_reference"],
        amountMinor: Number(refund["requested_amount_minor"]),
        currency: refund["currency"],
        idempotencyKey: refund["id"],
      };
    } else {
      auditLogId = randomUUID();
      provider = {
        ...context,
        operation: "RECONCILE_REFUND",
        refundId: refund["id"],
        paymentAttemptId: attempt["id"],
        externalReference: externalReference,
        refundReference: refund["provider_reference"],
        amountMinor: Number(refund["requested_amount_minor"]),
        currency: refund["currency"],
        idempotencyKey: refund["id"],
        auditLogId,
      };
    }
  } else if (
    phase === "CANCEL_READY" &&
    (dispatch === 0 || op["last_error_code"] === "PROVIDER_UNAVAILABLE") &&
    typeof externalReference === "string" &&
    !["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(
      String(attempt["status"]),
    )
  ) {
    dispatch = 1;
    phase = "PAYMENT_RECONCILE";
    provider = {
      ...context,
      operation: "CANCEL_PAYMENT",
      attemptId: attempt["id"],
      externalReference: externalReference,
      idempotencyKey: op["id"],
      reasonCode: op["reason_code"],
    };
  } else {
    auditLogId = randomUUID();
    phase = "PAYMENT_RECONCILE";
    provider = {
      ...context,
      operation: "RECONCILE_PAYMENT",
      attemptId: attempt["id"],
      merchantReference: attempt["id"],
      providerIdempotencyKey: attempt["id"],
      ...(typeof externalReference === "string"
        ? { externalReference: externalReference }
        : {}),
      amountMinor: Number(attempt["amount_minor"]),
      currency: attempt["currency"],
      auditLogId,
    };
  }
  const providerCommand = adminFinanceProviderCommandSchema.parse(provider);
  return { providerCommand, auditLogId, phase, dispatch };
}
