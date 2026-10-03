import { randomUUID } from "node:crypto";
import type {
  PaymentRuntimeClaimRecoveryCommand,
  PaymentRuntimeRecordReconcileCommand,
  PaymentRuntimeDeferRecoveryCommand,
} from "@fan-support/contracts";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  encodedPaymentValue,
  authorizePaymentCart,
  loadPaymentAttempt,
  paymentEventTime,
  rejectPayment,
  validPaymentReservationsSql,
} from "./payment-runtime-data.js";
import { paymentCheckoutReadiness } from "./payment-runtime-context.js";
import {
  paymentClaimFromRow,
  requirePaymentClaim,
  runtimeOperationColumns,
} from "./payment-runtime-fence.js";
import {
  appendPaymentHistory,
  insertPaymentRow,
  markPaymentUnknown,
} from "./payment-runtime-history.js";
import { persistPaymentRuntimeEvidence } from "./payment-runtime-evidence.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function claimPaymentRecovery(
  client: TransactionClient,
  outbox: OutboxRepository,
  command: PaymentRuntimeClaimRecoveryCommand,
) {
  let cartId: string | null = null,
    attemptId: string | null = null,
    sessionId: string | null = null;
  if (command.target.kind === "CHECKOUT") {
    cartId = (await authorizePaymentCart(client, command.target.accesses)).id;
    attemptId = command.target.attemptId;
    sessionId = command.target.checkoutSessionId;
    if (!(await loadPaymentAttempt(client, attemptId, cartId, sessionId)))
      return rejectPayment("ATTEMPT_NOT_FOUND");
  }
  const [candidate] = await draftRows(
    client,
    `SELECT operation.id FROM public.payment_runtime_operations operation JOIN public.payment_attempts a ON a.id=operation.attempt_id JOIN public.orders o ON o.id=a.order_id WHERE operation.phase IN('CREATE','RECONCILE') AND operation.next_attempt_at<=clock_timestamp() AND (operation.lease_expires_at IS NULL OR operation.lease_expires_at<=clock_timestamp()) AND ($1::uuid IS NULL OR a.id=$1::uuid) AND ($2::uuid IS NULL OR o.cart_id=$2::uuid) AND ($3::uuid IS NULL OR o.checkout_session_id=$3::uuid) ORDER BY operation.next_attempt_at,operation.id LIMIT 1 FOR UPDATE OF operation SKIP LOCKED`,
    [attemptId, cartId, sessionId],
  );
  if (!candidate) return null;
  await client.query(
    `UPDATE public.payment_runtime_operations SET generation=generation+1,version=version+1,lease_token_digest=decode($2,'hex'),lease_expires_at=clock_timestamp()+$3::bigint*interval '1 millisecond',request_id=$4::uuid,correlation_id=$5::uuid,task_name=$6,audit_log_id=CASE WHEN phase='RECONCILE' THEN $7::uuid ELSE NULL END,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1::uuid`,
    [
      candidate["id"],
      command.leaseTokenDigest,
      command.leaseDurationMs,
      command.requestId,
      command.correlationId,
      command.taskName,
      command.auditLogId,
    ],
  );
  async function readClaim() {
    const [row] = await draftRows(
      client,
      `SELECT ${runtimeOperationColumns} FROM public.payment_runtime_operations operation JOIN public.payment_create_receipts receipt ON receipt.operation_id=operation.id WHERE operation.id=$1::uuid`,
      [candidate!["id"]],
    );
    if (!row) return rejectPayment("STALE_CLAIM");
    return paymentClaimFromRow(client, row);
  }
  let claim = await readClaim();
  if (claim.mode === "CREATE") {
    const order = await paymentCheckoutReadiness(client, claim.attempt.orderId);
    // A committed dispatch authorization may already have reached the PSP. Expired resources cannot authorize another create.
    if (
      order["resources_valid"] !== true ||
      order["order_status"] !== "PENDING_PAYMENT" ||
      order["payment_status"] !== "PENDING"
    ) {
      const at = await paymentEventTime(client, claim.attempt.orderId);
      await markPaymentUnknown(
        client,
        outbox,
        claim,
        randomUUID(),
        randomUUID(),
        at,
        "DISPATCH_RECOVERY_RESOURCES_EXPIRED",
      );
      await client.query(
        `UPDATE public.payment_runtime_operations SET phase='RECONCILE',audit_log_id=$2::uuid,last_error_code='DISPATCH_RECOVERY_RESOURCES_EXPIRED',version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1::uuid`,
        [claim.operationId, command.auditLogId],
      );
      claim = await readClaim();
    }
  }
  return claim;
}

export async function recordPaymentReconcile(
  client: TransactionClient,
  outbox: OutboxRepository,
  command: PaymentRuntimeRecordReconcileCommand,
) {
  const claim = await requirePaymentClaim(client, command.claim);
  const at = await paymentEventTime(client, claim.attempt.orderId);
  const evidence = await persistPaymentRuntimeEvidence(client, command, at);
  const [prior] = await draftRows(
    client,
    `SELECT disposition FROM public.payment_reconcile_receipts WHERE provider_event_id=$1::uuid AND attempt_id=$2::uuid`,
    [evidence.providerEventId, claim.attempt.id],
  );
  const target = command.event.status;
  // Success is durable evidence pending P4-05, never an isolated financial status update.
  const pending = target === "SUCCEEDED";
  const refreshesAction =
    claim.attempt.status === "REQUIRES_ACTION" &&
    claim.attempt.actionExpired &&
    claim.attempt.recovery === "RECONCILE_REQUIRED";
  let recoveredAction =
    target === "REQUIRES_ACTION" &&
    (claim.attempt.status === "UNKNOWN" || refreshesAction) &&
    command.action?.type !== "WAIT"
      ? command.action
      : undefined;
  const restoresNonterminal =
    (claim.attempt.status === "UNKNOWN" &&
      (recoveredAction !== undefined || target === "PROCESSING")) ||
    (refreshesAction && recoveredAction !== undefined);
  const reasonCode =
    refreshesAction && recoveredAction
      ? "PAYMENT_ACTION_REFRESHED"
      : "PAYMENT_STATUS_RECONCILED";
  let canApply =
    (!prior ||
      (recoveredAction !== undefined &&
        (prior["disposition"] === "OBSERVED" || refreshesAction))) &&
    !pending &&
    (target !== claim.attempt.status ||
      (refreshesAction && recoveredAction !== undefined)) &&
    (recoveredAction !== undefined ||
      ["FAILED", "CANCELED", "EXPIRED"].includes(target) ||
      (target === "PROCESSING" &&
        ["UNKNOWN", "REQUIRES_ACTION"].includes(claim.attempt.status)));
  if (canApply && restoresNonterminal) {
    // The claim already holds the order/attempt. Lock its intent/reservation rows without requesting the cart in reverse order.
    const order = await paymentCheckoutReadiness(client, claim.attempt.orderId);
    canApply =
      order["resources_valid"] === true &&
      order["order_status"] === "PENDING_PAYMENT" &&
      order["payment_status"] === "PENDING" &&
      order["current_payment_attempt_id"] === claim.attempt.id;
    if (recoveredAction && typeof order["action_deadline"] === "string") {
      recoveredAction = {
        ...recoveredAction,
        expiresAt: new Date(
          Math.min(
            Date.parse(recoveredAction.expiresAt),
            Date.parse(order["action_deadline"]),
          ),
        ).toISOString(),
      };
    }
  }
  if (canApply) {
    const changed = await draftRows(
      client,
      `UPDATE public.payment_attempts SET status=$2,provider_call_started=true,external_reference=coalesce(external_reference,$3),action_type=$7,action_ciphertext=$8::bytea,action_encrypted_data_key=$9::bytea,action_key_version=$10,action_expires_at=$11::timestamptz,action_poll_after_ms=NULL,status_evidence_kind='AUTHENTICATED_RECONCILE',provider_event_id=$4::uuid,evidence_audit_log_id=$5::uuid,evidence_reason_code=$12,version=version+1,updated_at=$6::timestamptz,terminated_at=CASE WHEN $2::text IN('FAILED','CANCELED','EXPIRED') THEN $6::timestamptz ELSE NULL END WHERE id=$1::uuid${restoresNonterminal ? ` AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id=payment_attempts.order_id AND o.current_payment_attempt_id=$1::uuid AND o.order_status='PENDING_PAYMENT' AND o.payment_status='PENDING' AND o.quote_expires_at>clock_timestamp() AND ${validPaymentReservationsSql}) AND ($11::timestamptz IS NULL OR $11::timestamptz>clock_timestamp())` : ""} RETURNING id`,
      [
        claim.attempt.id,
        target,
        command.event.association.status === "MATCHED"
          ? command.event.association.externalReference
          : null,
        evidence.providerEventId,
        evidence.auditLogId,
        at,
        recoveredAction?.type ?? null,
        recoveredAction
          ? encodedPaymentValue(recoveredAction.ciphertext)
          : null,
        recoveredAction
          ? encodedPaymentValue(recoveredAction.encryptedDataKey)
          : null,
        recoveredAction?.encryptionKeyVersion ?? null,
        recoveredAction?.expiresAt ?? null,
        reasonCode,
      ],
    );
    // A deadline may pass after readiness. Preserve the observation and UNKNOWN when the guarded write loses that race.
    if (changed.length !== 1) {
      if (!restoresNonterminal || changed.length !== 0)
        return rejectPayment("CONTENT_UNAVAILABLE");
      canApply = false;
    }
  }
  if (canApply) {
    await appendPaymentHistory(client, outbox, {
      attempt: claim.attempt,
      eventId: command.eventId,
      outboxEventId: command.outboxEventId,
      version: claim.attempt.version + 1,
      fromStatus: claim.attempt.status,
      toStatus: target,
      evidenceKind: "AUTHENTICATED_RECONCILE",
      reasonCode,
      providerEventId: evidence.providerEventId,
      auditLogId: evidence.auditLogId,
      requestId: claim.requestId,
      correlationId: claim.correlationId,
      occurredAt: at,
    });
  }
  const complete =
    canApply && ["FAILED", "CANCELED", "EXPIRED"].includes(target);
  await client.query(
    `UPDATE public.payment_runtime_operations SET phase=$2,lease_token_digest=NULL,lease_expires_at=NULL,audit_log_id=NULL,next_attempt_at=CASE WHEN $2::text='RECONCILE' THEN clock_timestamp()+$3::bigint*interval '1 millisecond' ELSE NULL END,last_error_code=NULL,defer_count=0,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1::uuid`,
    [
      claim.operationId,
      pending ? "EVIDENCE_PENDING" : complete ? "COMPLETE" : "RECONCILE",
      command.retryAfterMs,
    ],
  );
  if (!prior)
    await insertPaymentRow(client, "payment_reconcile_receipts", {
      id: command.receiptId,
      operation_id: claim.operationId,
      attempt_id: claim.attempt.id,
      provider_event_id: evidence.providerEventId,
      audit_log_id: evidence.auditLogId,
      disposition: pending
        ? "PENDING"
        : canApply
          ? "APPLIED_NONFINANCIAL"
          : "OBSERVED",
      created_at: at,
    });
  const attempt = await loadPaymentAttempt(client, claim.attempt.id);
  if (!attempt) return rejectPayment("CONTENT_UNAVAILABLE");
  return attempt;
}
export async function deferPaymentRecovery(
  client: TransactionClient,
  command: PaymentRuntimeDeferRecoveryCommand,
) {
  const claim = await requirePaymentClaim(client, command.claim);
  if (claim.auditLogId !== null)
    await client.query(
      `INSERT INTO public.audit_logs(id,actor_type,task_name,action,subject_type,subject_id,request_id,correlation_id,outcome,created_at) VALUES($1::uuid,'SYSTEM',$2,'PAYMENT_PROVIDER_RECONCILE','PAYMENT_PROVIDER_ACCOUNT',$3::uuid,$4::uuid,$5::uuid,'FAILED',clock_timestamp())`,
      [
        claim.auditLogId,
        claim.taskName,
        claim.attempt.providerAccountId,
        claim.requestId,
        claim.correlationId,
      ],
    );
  // Each consecutive deferral doubles the wait, capped at one hour (audit PAY-01); the right side reads the old count.
  await client.query(
    `UPDATE public.payment_runtime_operations SET lease_token_digest=NULL,lease_expires_at=NULL,audit_log_id=NULL,next_attempt_at=clock_timestamp()+LEAST(3600000,$2::bigint*power(2,LEAST(defer_count,9))::bigint)*interval '1 millisecond',defer_count=defer_count+1,last_error_code=$3,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1::uuid`,
    [claim.operationId, command.retryAfterMs, command.errorCode],
  );
  const attempt = await loadPaymentAttempt(client, claim.attempt.id);
  if (!attempt) return rejectPayment("CONTENT_UNAVAILABLE");
  return attempt;
}
