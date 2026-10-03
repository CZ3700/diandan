import { Buffer } from "node:buffer";
import {
  paymentRuntimeBeginCreateResultSchema,
  type PaymentRuntimeBeginCreateCommand,
  type PaymentRuntimeSettleCreateCommand,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import type { OutboxRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  authorizePaymentCart,
  encodedPaymentValue,
  loadPaymentAttempt,
  loadPermanentPaymentReceipt,
  paymentEventTime,
  rejectPayment,
} from "./payment-runtime-data.js";
import { loadPaymentContext } from "./payment-runtime-context.js";
import {
  appendPaymentHistory,
  insertPaymentRow,
  markPaymentUnknown,
} from "./payment-runtime-history.js";
import {
  paymentClaimFromRow,
  requirePaymentClaim,
  runtimeOperationColumns,
} from "./payment-runtime-fence.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function beginPaymentCreate(
  client: TransactionClient,
  outbox: OutboxRepository,
  command: PaymentRuntimeBeginCreateCommand,
) {
  const cart = await authorizePaymentCart(client, command.accesses);
  const existing = await loadPermanentPaymentReceipt(
    client,
    cart.id,
    command.checkoutSessionId,
    command.idempotencyKey,
  );
  if (existing)
    return rejectPayment(
      existing.canonicalRequestHash === command.canonicalRequestHash
        ? "STALE_CLAIM"
        : "IDEMPOTENCY_CONFLICT",
    );
  const current = await loadPaymentContext(client, {
    schemaVersion: 1,
    accesses: command.accesses,
    checkoutSessionId: command.checkoutSessionId,
    presentationLocale: command.createCommand.requestedLocale,
    country: command.country,
    supportedActionTypes: command.supportedActionTypes,
  });
  if (current.currentAttempt && !current.currentAttempt.canRetry)
    return rejectPayment("PAYMENT_IN_PROGRESS");
  if (current.readiness !== "READY") return rejectPayment(current.readiness);
  if (current.orderVersion !== command.expectedOrderVersion)
    return rejectPayment("VERSION_CONFLICT");
  const routing = current.routing;
  if (
    !routing ||
    routing.publicationId !== command.configPublicationId ||
    routing.configVersionId !== command.configVersionId ||
    routing.configVersion !== command.configVersion ||
    routing.ruleVersion !== command.ruleVersion
  )
    return rejectPayment("STALE_CONFIGURATION");
  const route = routing.routes.find((r) => r.rule.id === command.routeRuleId);
  const create = command.createCommand;
  if (
    !route ||
    !route.rule.enabled ||
    !route.providerEnabled ||
    !["INTERNAL", "ACTIVE"].includes(route.accountStatus) ||
    route.merchantStatus !== "ACTIVE" ||
    route.healthStatus !== "HEALTHY" ||
    !route.rule.countries.includes(command.country) ||
    !route.rule.markets.includes(current.cart.market) ||
    !route.rule.currencies.includes(current.cart.currency) ||
    route.rule.requiredDeviceCapabilities.some(
      (cap) => !command.supportedActionTypes.includes(cap),
    ) ||
    create.amountMinor < route.rule.minimumAmountMinor ||
    create.amountMinor > route.rule.maximumAmountMinor
  )
    return rejectPayment("CAPABILITY_UNAVAILABLE");
  const [admission] = await draftRows(
    client,
    `SELECT public.payment_rollout_bucket_v1('provider',$1::uuid,$2::uuid)<$4::integer AND public.payment_rollout_bucket_v1('rule',$1::uuid,$3::uuid)<$5::integer AS eligible`,
    [
      current.checkout.receipt.checkoutSessionId,
      route.rule.providerAccountId,
      route.rule.id,
      route.providerRolloutBasisPoints,
      route.rolloutBasisPoints,
    ],
  );
  if (admission?.["eligible"] !== true)
    return rejectPayment("CAPABILITY_UNAVAILABLE");
  if (
    create.providerAccountId !== route.rule.providerAccountId ||
    create.environment !== route.environment ||
    create.paymentMethod !== route.rule.paymentMethod ||
    create.orderId !== current.checkout.receipt.orderId ||
    create.currency !== current.cart.currency ||
    create.amountMinor !==
      current.checkout.observation.quote.amount.totalAmountMinor ||
    create.requestedLocale !==
      current.checkout.observation.consent.presentationLocale
  )
    return rejectPayment("INVALID_COMMAND");
  const eventTime = await paymentEventTime(client, create.orderId);
  const [order] = await draftRows(
    client,
    `SELECT * FROM public.orders WHERE id=$1::uuid FOR UPDATE`,
    [create.orderId],
  );
  if (!order) return rejectPayment("CONTENT_UNAVAILABLE");
  await insertPaymentRow(client, "payment_attempts", {
    id: command.attemptId,
    order_id: create.orderId,
    provider_account_id: create.providerAccountId,
    environment: create.environment,
    config_version_id: command.configVersionId,
    config_version: command.configVersion,
    route_rule_id: command.routeRuleId,
    rule_version: command.ruleVersion,
    payment_method: create.paymentMethod,
    status: "CREATED",
    amount_minor: create.amountMinor,
    currency: create.currency,
    requested_locale: create.requestedLocale,
    provider_locale: command.providerLocale,
    provider_locale_fallback_used: command.providerLocaleFallbackUsed,
    merchant_reference: create.attemptId,
    provider_idempotency_key: create.attemptId,
    provider_call_started: false,
    return_state_digest: Buffer.from(command.returnStateDigest, "hex"),
    return_state_expires_at: command.returnStateExpiresAt,
    status_evidence_kind: "ATTEMPT_CREATED",
    evidence_reason_code: "PAYMENT_ATTEMPT_CREATED",
    version: 1,
    created_at: eventTime,
    updated_at: eventTime,
  });
  await client.query(
    `INSERT INTO public.payment_runtime_operations(id,attempt_id,phase,lease_token_digest,lease_expires_at,next_attempt_at,request_id,correlation_id,task_name,created_at,updated_at) VALUES($1::uuid,$2::uuid,'CREATE',decode($3,'hex'),clock_timestamp()+$4::bigint*interval '1 millisecond',clock_timestamp()+$4::bigint*interval '1 millisecond',$5::uuid,$6::uuid,$7,$8::timestamptz,$8::timestamptz)`,
    [
      command.operationId,
      command.attemptId,
      command.leaseTokenDigest,
      command.leaseDurationMs,
      command.requestId,
      command.correlationId,
      command.taskName,
      eventTime,
    ],
  );
  const canonical = canonicalPublicationValue(create);
  await client.query(
    `INSERT INTO public.payment_create_receipts(id,operation_id,attempt_id,cart_id,checkout_session_id,idempotency_key,canonical_request_hash,create_command,create_command_hash,supported_action_types,country,config_publication_id,original_order_version,request_id,correlation_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::jsonb,encode(sha256(convert_to(public.canonical_publication_json($8::jsonb),'UTF8')),'hex'),$9::jsonb,$10,$11::uuid,$12::bigint,$13::uuid,$14::uuid,$15::timestamptz)`,
    [
      command.receiptId,
      command.operationId,
      command.attemptId,
      cart.id,
      command.checkoutSessionId,
      command.idempotencyKey,
      command.canonicalRequestHash,
      canonical,
      JSON.stringify(command.supportedActionTypes),
      command.country,
      command.configPublicationId,
      command.expectedOrderVersion,
      command.requestId,
      command.correlationId,
      eventTime,
    ],
  );
  const first = order["current_payment_attempt_id"] === null;
  await insertPaymentRow(client, "order_events", {
    id: command.orderEventId,
    order_id: create.orderId,
    sequence: command.expectedOrderVersion + 1,
    event_type: first ? "PAYMENT_STATUS_CHANGED" : "PAYMENT_ATTEMPT_BOUND",
    from_order_status: order["order_status"],
    to_order_status: order["order_status"],
    from_payment_status: order["payment_status"],
    to_payment_status: "PENDING",
    from_dispute_status: order["dispute_status"],
    to_dispute_status: order["dispute_status"],
    from_fulfillment_status: order["fulfillment_status"],
    to_fulfillment_status: order["fulfillment_status"],
    from_payment_attempt_id: order["current_payment_attempt_id"],
    to_payment_attempt_id: command.attemptId,
    authority_kind: "CHECKOUT",
    reason_code: first
      ? "ORDER_PAYMENT_ATTEMPT_CREATED"
      : "PAYMENT_ATTEMPT_BOUND",
    request_id: command.requestId,
    correlation_id: command.correlationId,
    occurred_at: eventTime,
  });
  await client.query(
    `UPDATE public.orders SET payment_status='PENDING',current_payment_attempt_id=$2::uuid,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid`,
    [create.orderId, command.attemptId, eventTime],
  );
  await client.query(
    `UPDATE public.checkout_sessions SET status='PAYMENT_PENDING',updated_at=$2::timestamptz WHERE id=$1::uuid AND status='READY'`,
    [command.checkoutSessionId, eventTime],
  );
  await appendPaymentHistory(client, outbox, {
    attempt: {
      id: command.attemptId,
      orderId: create.orderId,
      market: cart.market,
      currency: cart.currency,
    },
    eventId: command.attemptEventId,
    outboxEventId: command.outboxEventId,
    version: 1,
    fromStatus: null,
    toStatus: "CREATED",
    evidenceKind: "ATTEMPT_CREATED",
    reasonCode: "PAYMENT_ATTEMPT_CREATED",
    requestId: command.requestId,
    correlationId: command.correlationId,
    occurredAt: eventTime,
  });
  const receipt = await loadPermanentPaymentReceipt(
    client,
    cart.id,
    command.checkoutSessionId,
    command.idempotencyKey,
  );
  const [operation] = await draftRows(
    client,
    `SELECT ${runtimeOperationColumns} FROM public.payment_runtime_operations operation JOIN public.payment_create_receipts receipt ON receipt.operation_id=operation.id WHERE operation.id=$1::uuid`,
    [command.operationId],
  );
  if (!receipt || !operation) return rejectPayment("CONTENT_UNAVAILABLE");
  return paymentRuntimeBeginCreateResultSchema.parse({
    schemaVersion: 1,
    receipt,
    claim: await paymentClaimFromRow(client, operation),
  });
}

export async function settlePaymentCreate(
  client: TransactionClient,
  outbox: OutboxRepository,
  command: PaymentRuntimeSettleCreateCommand,
) {
  const claim = await requirePaymentClaim(client, command.claim);
  const eventTime = await paymentEventTime(client, claim.attempt.orderId);
  if (command.result.kind === "NETWORK_UNCERTAINTY") {
    await markPaymentUnknown(
      client,
      outbox,
      claim,
      command.eventId,
      command.outboxEventId,
      eventTime,
      command.result.reasonCode,
    );
  } else {
    const result = command.result,
      action = result.action;
    const interactive = action && action.type !== "WAIT" ? action : null;
    await client.query(
      `UPDATE public.payment_attempts SET status=$2,provider_call_started=true,external_reference=$3,action_type=$4,action_ciphertext=$5,action_encrypted_data_key=$6,action_key_version=$7,action_expires_at=$8::timestamptz,action_poll_after_ms=$9,version=version+1,status_evidence_kind='CREATE_RESULT',evidence_reason_code='PAYMENT_CREATE_RESULT',updated_at=$10::timestamptz WHERE id=$1::uuid`,
      [
        claim.attempt.id,
        result.status,
        result.externalReference,
        action?.type ?? null,
        interactive ? encodedPaymentValue(interactive.ciphertext) : null,
        interactive ? encodedPaymentValue(interactive.encryptedDataKey) : null,
        interactive?.encryptionKeyVersion ?? null,
        interactive?.expiresAt ?? null,
        action?.type === "WAIT" ? action.pollAfterMs : null,
        eventTime,
      ],
    );
    await appendPaymentHistory(client, outbox, {
      attempt: claim.attempt,
      eventId: command.eventId,
      outboxEventId: command.outboxEventId,
      version: claim.attempt.version + 1,
      fromStatus: "CREATED",
      toStatus: result.status,
      evidenceKind: "CREATE_RESULT",
      reasonCode: "PAYMENT_CREATE_RESULT",
      requestId: claim.requestId,
      correlationId: claim.correlationId,
      occurredAt: eventTime,
    });
  }
  await client.query(
    `UPDATE public.payment_runtime_operations SET phase='RECONCILE',lease_token_digest=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp()+$2::bigint*interval '1 millisecond',defer_count=0,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at),last_error_code=$3 WHERE id=$1::uuid`,
    [
      claim.operationId,
      command.retryAfterMs,
      command.result.kind === "NETWORK_UNCERTAINTY"
        ? command.result.reasonCode
        : null,
    ],
  );
  const attempt = await loadPaymentAttempt(client, claim.attempt.id);
  if (!attempt) return rejectPayment("CONTENT_UNAVAILABLE");
  return attempt;
}
