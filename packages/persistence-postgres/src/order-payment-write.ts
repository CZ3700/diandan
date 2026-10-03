import { randomUUID } from "node:crypto";
import {
  inventoryReservationSchema,
  latePaymentSuccessStateSchema,
  providerEventSchema,
  persistencePortCommandSchema,
  type OrderPaymentApplyCommand,
} from "@fan-support/contracts";
import { planLatePaymentSuccessCommand } from "@fan-support/domain";
import type {
  InventoryRepository,
  OutboxRepository,
} from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import {
  appendPaymentHistory,
  insertPaymentRow,
} from "./payment-runtime-history.js";
import { paymentEventTime } from "./payment-runtime-data.js";
import { applyOrderPaymentInventory } from "./order-payment-inventory.js";
import { deliverDigitalFulfillments } from "./digital-fulfillment.js";
import { deriveFulfillmentAggregate } from "./fulfillment-aggregate.js";
import {
  lockOrderWishBindings,
  recordPaidWishSupports,
} from "./wish-gallery-payment.js";
import {
  rejectOrderPayment,
  recordOrderPaymentResult,
} from "./order-payment-data.js";
import type { TransactionClient } from "./transaction-runner.js";

type Input = {
  client: TransactionClient;
  inventory: InventoryRepository;
  outbox: OutboxRepository;
  command: OrderPaymentApplyCommand;
  event: DraftRow;
  attempt: DraftRow;
  order: DraftRow;
};
async function appendOutbox(
  input: Input,
  type: "ORDER_PAYMENT_CONFIRMED" | "FULFILLMENT_STATUS_CHANGED",
  aggregateId: string,
  secondaryId: string,
  version: number,
  payload: unknown,
  at: string,
) {
  const command = persistencePortCommandSchema.parse({
    schemaVersion: 1,
    operation: "APPEND_OUTBOX_EVENT",
    event: {
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: type,
      aggregateId,
      requestId: input.command.requestId,
      correlationId: input.command.correlationId,
      occurredAt: at,
      payload,
    },
    aggregateVersion: version,
    primarySubjectId: aggregateId,
    secondarySubjectId: secondaryId,
    market: input.order["market"],
    currency: input.order["currency"],
    idempotencyKey: `order-payment:${type}:${aggregateId}:${version}`,
    availableAt: at,
  });
  if (command.operation !== "APPEND_OUTBOX_EVENT")
    return rejectOrderPayment("INTEGRITY_VIOLATION");
  const result = await input.outbox.append(command);
  if (
    result.outcome !== "SUCCESS" ||
    result.operation !== "APPEND_OUTBOX_EVENT" ||
    result.value.eventId !== command.event.eventId
  )
    return rejectOrderPayment("INTEGRITY_VIOLATION");
}
async function setAttempt(input: Input, at: string) {
  const { client, event, attempt, order, command } = input;
  await client.query(
    `UPDATE public.payment_attempts SET status=$2,external_reference=coalesce(external_reference,$7::text),provider_call_started=true,action_type=NULL,action_ciphertext=NULL,action_encrypted_data_key=NULL,action_key_version=NULL,action_expires_at=NULL,action_poll_after_ms=NULL,status_evidence_kind=$3,provider_event_id=$4::uuid,evidence_audit_log_id=$5::uuid,evidence_reason_code='PAYMENT_STATUS_CONFIRMED',version=version+1,updated_at=$6::timestamptz,succeeded_at=CASE WHEN $2::text='SUCCEEDED' THEN $6::timestamptz ELSE NULL END,terminated_at=CASE WHEN $2::text<>'SUCCEEDED' THEN $6::timestamptz ELSE NULL END WHERE id=$1::uuid`,
    [
      attempt["id"],
      event["normalized_status"],
      event["evidence_kind"],
      event["id"],
      event["reconcile_audit_log_id"],
      at,
      event["external_payment_reference"],
    ],
  );
  await appendPaymentHistory(client, input.outbox, {
    attempt: {
      id: attempt["id"],
      orderId: order["id"],
      market: order["market"],
      currency: order["currency"],
    } as Parameters<typeof appendPaymentHistory>[2]["attempt"],
    eventId: randomUUID(),
    outboxEventId: randomUUID(),
    version: Number(attempt["version"]) + 1,
    fromStatus: String(attempt["status"]),
    toStatus: String(event["normalized_status"]),
    evidenceKind: String(event["evidence_kind"]),
    reasonCode: "PAYMENT_STATUS_CONFIRMED",
    providerEventId: String(event["id"]),
    ...(event["reconcile_audit_log_id"]
      ? { auditLogId: String(event["reconcile_audit_log_id"]) }
      : {}),
    requestId: command.requestId,
    correlationId: command.correlationId,
    occurredAt: at,
  });
  // Existing terminal EVIDENCE_PENDING receipts remain immutable; live workers lose their original fence.
  await client.query(
    `UPDATE public.payment_runtime_operations SET phase='COMPLETE',lease_token_digest=NULL,lease_expires_at=NULL,audit_log_id=NULL,next_attempt_at=NULL,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE attempt_id=$1::uuid AND phase IN('CREATE','RECONCILE')`,
    [attempt["id"]],
  );
}
export async function applyOrderPaymentAggregate(input: Input) {
  const { client, event, attempt, order, command } = input;
  const refs = {
    attemptId: String(attempt["id"]),
    orderId: String(order["id"]),
  };
  const review = (reasonCode: string) =>
    recordOrderPaymentResult(client, command, {
      decision: "REVIEW",
      ...refs,
      reasonCode,
    });
  const success = event["normalized_status"] === "SUCCEEDED";
  if (success && event["provider_transaction_type"] !== "CAPTURE")
    return review("PAYMENT_CAPTURE_EVIDENCE_REQUIRED");
  if (attempt["status"] === "SUCCEEDED")
    return review("PAYMENT_ALREADY_SUCCEEDED_WITH_OTHER_EVIDENCE");
  if (
    ["FAILED", "CANCELED", "EXPIRED"].includes(String(attempt["status"])) &&
    (success ||
      attempt["status"] !== event["normalized_status"] ||
      attempt["provider_event_id"] !== event["id"])
  )
    return review("TERMINAL_PAYMENT_CONFLICT");
  if (
    !["PENDING_PAYMENT", "CANCELED"].includes(String(order["order_status"])) ||
    order["payment_status"] !== "PENDING" ||
    order["cart_status"] !== "LOCKED"
  )
    return review("ORDER_STATE_CONFLICT");
  const lines = await draftRows(
    client,
    `SELECT i.id,i.cart_item_id,i.gift_variant_id,i.quantity,i.support_intent_id,i.gift_kind,v.inventory_policy,s.status intent_status FROM public.order_items i JOIN public.gift_variants v ON v.id=i.gift_variant_id JOIN public.support_intents s ON s.id=i.support_intent_id WHERE i.order_id=$1::uuid ORDER BY i.id FOR UPDATE OF s`,
    [order["id"]],
  );
  if (
    lines.length === 0 ||
    lines.some((row) => row["intent_status"] !== "CHECKOUT_LOCKED")
  )
    return review("ORDER_INTENT_STATE_CONFLICT");
  const reservationRows = await draftRows(
    client,
    `SELECT DISTINCT ON(r.cart_item_id) r.*,${cartTimestamp("r.expires_at")} expires_at,ii.id inventory_item_id FROM public.inventory_reservations r JOIN public.inventory_items ii ON ii.gift_variant_id=r.gift_variant_id WHERE r.locked_order_id=$1::uuid ORDER BY r.cart_item_id,r.created_at DESC,r.id DESC`,
    [order["id"]],
  );
  if (
    reservationRows.some(
      (r) =>
        !lines.some(
          (l) =>
            l["cart_item_id"] === r["cart_item_id"] &&
            l["inventory_policy"] === "TRACKED",
        ),
    )
  )
    return review("RESERVATION_COVERAGE_CONFLICT");
  for (const line of lines) {
    const rs = reservationRows.filter(
      (r) => r["cart_item_id"] === line["cart_item_id"],
    );
    if (
      line["inventory_policy"] === "TRACKED" &&
      (rs.length !== 1 ||
        rs[0]!["gift_variant_id"] !== line["gift_variant_id"] ||
        Number(rs[0]!["quantity"]) !== Number(line["quantity"]) ||
        rs[0]!["checkout_quote_id"] !== order["checkout_quote_id"] ||
        rs[0]!["checkout_session_id"] !== order["checkout_session_id"])
    )
      return review("RESERVATION_COVERAGE_CONFLICT");
  }
  const reservations = reservationRows.map((r) =>
    inventoryReservationSchema.parse({
      schemaVersion: 1,
      id: r["id"],
      checkoutQuoteId: r["checkout_quote_id"],
      cartItemId: r["cart_item_id"],
      giftVariantId: r["gift_variant_id"],
      inventoryLocationId: r["location_id"],
      quantity: Number(r["quantity"]),
      status: r["status"],
      expiresAt: r["expires_at"],
      version: Number(r["version"]),
    }),
  );
  const unavailable = reservations.some(
    (r) => r.status === "RELEASED" || r.status === "EXPIRED",
  );
  if (success && unavailable && attempt["status"] !== "UNKNOWN")
    return review("LATE_SUCCESS_REQUIRES_UNKNOWN_ATTEMPT");
  const fulfillments = await draftRows(
    client,
    `SELECT * FROM public.fulfillments WHERE order_id=$1::uuid ORDER BY id FOR UPDATE`,
    [order["id"]],
  );
  if (
    fulfillments.length !== lines.length ||
    fulfillments.some((f) => f["status"] !== "PENDING")
  )
    return review("FULFILLMENT_STATE_CONFLICT");
  let at = await paymentEventTime(client, refs.orderId);
  if (success) {
    const [cart] = await draftRows(
      client,
      `SELECT version FROM public.carts WHERE id=$1::uuid`,
      [order["cart_id"]],
    );
    const competing = await draftRows(
      client,
      `SELECT id FROM public.payment_attempts WHERE order_id=$1::uuid AND id<>$2::uuid AND status IN('CREATED','REQUIRES_ACTION','PROCESSING','UNKNOWN','SUCCEEDED')`,
      [order["id"], attempt["id"]],
    );
    const state = latePaymentSuccessStateSchema.parse({
      schemaVersion: 1,
      paymentAttempt: {
        schemaVersion: 1,
        id: attempt["id"],
        orderId: order["id"],
        version: Number(attempt["version"]),
        status: attempt["status"],
        providerAccountId: attempt["provider_account_id"],
        environment: attempt["environment"],
        ...(attempt["external_reference"] !== null
          ? { externalReference: attempt["external_reference"] }
          : {}),
        amountMinor: Number(attempt["amount_minor"]),
        currency: attempt["currency"],
        providerCallStarted: attempt["provider_call_started"],
      },
      order: {
        schemaVersion: 1,
        id: order["id"],
        version: Number(order["version"]),
        orderStatus: order["order_status"],
        paymentStatus: order["payment_status"],
        currentPaymentAttemptId: order["current_payment_attempt_id"],
      },
      cart: {
        schemaVersion: 1,
        id: order["cart_id"],
        orderId: order["id"],
        version: Number(cart?.["version"]),
        status: order["cart_status"],
      },
      reservations: reservations.map((r) => ({
        schemaVersion: 1,
        id: r.id,
        orderId: order["id"],
        version: r.version,
        status: r.status,
      })),
      fulfillments: fulfillments.map((f) => ({
        schemaVersion: 1,
        id: f["id"],
        orderId: order["id"],
        orderItemId: f["order_item_id"],
        version: Number(f["version"]),
        status: f["status"],
      })),
      competingPaymentAttemptIds: competing.map((r) => r["id"]),
    });
    const normalized = providerEventSchema.parse({
      schemaVersion: 1,
      eventType: "PAYMENT_STATUS",
      providerAccountId: event["provider_account_id"],
      environment: event["environment"],
      providerEventId: event["provider_event_id"],
      status: event["normalized_status"],
      evidence:
        event["evidence_kind"] === "VERIFIED_WEBHOOK"
          ? {
              kind: "VERIFIED_WEBHOOK",
              webhookInboxId: event["webhook_inbox_id"],
            }
          : {
              kind: "AUTHENTICATED_RECONCILE",
              auditLogId: event["reconcile_audit_log_id"],
            },
      association: {
        status: "MATCHED",
        paymentAttemptId: attempt["id"],
        externalReference: event["external_payment_reference"],
      },
      amountMinor: Number(event["amount_minor"]),
      currency: event["currency"],
      occurredAt: event["occurred_at"],
      ...(event["provider_transaction_type"]
        ? {
            transaction: {
              type: event["provider_transaction_type"],
              providerReference: event["provider_transaction_reference"],
            },
          }
        : {}),
    });
    const plan = planLatePaymentSuccessCommand({
      schemaVersion: 1,
      state,
      authority: {
        kind: "PROVIDER_EVENT",
        paymentAttempt: state.paymentAttempt,
        event: normalized,
      },
      auditActor: { kind: "SYSTEM", taskName: command.taskName },
    });
    if (plan.decision !== "APPLIED") return review(plan.reasonCode);
    if (attempt["status"] === "UNKNOWN") {
      const [instant] = await draftRows(
        client,
        `SELECT ${cartTimestamp("transaction_timestamp()")} at,transaction_timestamp()>a.updated_at AND transaction_timestamp()>=o.updated_at valid FROM public.payment_attempts a JOIN public.orders o ON o.id=a.order_id WHERE a.id=$1::uuid`,
        [attempt["id"]],
      );
      if (instant?.["valid"] !== true)
        return rejectOrderPayment("INTEGRITY_VIOLATION");
      at = String(instant["at"]);
      await insertPaymentRow(client, "audit_logs", {
        id: randomUUID(),
        actor_type: "SYSTEM",
        task_name: command.taskName,
        action: "LATE_PAYMENT_SUCCESS_APPLIED",
        subject_type: "PAYMENT_ATTEMPT",
        subject_id: attempt["id"],
        reason_code: unavailable
          ? "LATE_PAYMENT_INVENTORY_UNAVAILABLE"
          : "PAYMENT_SUCCESS_RECONCILED",
        request_id: command.requestId,
        correlation_id: command.correlationId,
        outcome: "SUCCEEDED",
        created_at: at,
      });
    }
  }
  // The existing inventory guard permits release only after trusted failure is visible on this same client.
  if (!success && attempt["status"] !== event["normalized_status"])
    await setAttempt(input, at);
  const hasWish = lines.some((line) => line["gift_kind"] === "WISH");
  if (hasWish) await lockOrderWishBindings(client, refs.orderId);
  await applyOrderPaymentInventory({
    repository: input.inventory,
    targets: reservations.map((r, i) => ({
      inventoryItemId: String(
        reservationRows[i]!["inventory_item_id"],
      ) as Parameters<
        typeof applyOrderPaymentInventory
      >[0]["targets"][number]["inventoryItemId"],
      inventoryLocationId: r.inventoryLocationId,
      reservationId: r.id,
    })),
    reservations,
    targetStatus: success ? "COMMITTED" : "RELEASED",
    evaluatedAt: at,
    requestId: command.requestId,
    correlationId: command.correlationId,
  });
  if (success && attempt["status"] !== event["normalized_status"])
    await setAttempt(input, at);
  if (success) {
    // ADR-019: a VIRTUAL line whose own reservation is intact is delivered now; every other line
    // keeps the existing rule (all held for review when any reservation was released).
    const lineByItem = new Map(lines.map((l) => [String(l["id"]), l]));
    const reservationUnavailable = (cartItemId: unknown) =>
      reservationRows.some(
        (r) =>
          r["cart_item_id"] === cartItemId &&
          ["RELEASED", "EXPIRED"].includes(String(r["status"])),
      );
    const statuses = new Map<string, string>();
    const digital = [];
    for (const f of fulfillments) {
      const line = lineByItem.get(String(f["order_item_id"]));
      if (!line) return rejectOrderPayment("INTEGRITY_VIOLATION");
      if (
        line["gift_kind"] === "VIRTUAL" &&
        !reservationUnavailable(line["cart_item_id"])
      ) {
        digital.push({
          fulfillmentId: String(f["id"]),
          orderItemId: String(f["order_item_id"]),
          status: String(f["status"]),
          version: Number(f["version"]),
          giftKind: "VIRTUAL",
        });
        continue;
      }
      if (!unavailable) {
        statuses.set(String(f["id"]), "PENDING");
        continue;
      }
      await client.query(
        `UPDATE public.fulfillments SET status='ON_HOLD',hold_reason_code='LATE_PAYMENT_INVENTORY_UNAVAILABLE',version=version+1,updated_at=GREATEST($2::timestamptz,updated_at) WHERE id=$1::uuid`,
        [f["id"], at],
      );
      await insertPaymentRow(client, "fulfillment_events", {
        id: randomUUID(),
        fulfillment_id: f["id"],
        order_id: order["id"],
        sequence: Number(f["version"]) + 1,
        from_status: f["status"],
        to_status: "ON_HOLD",
        authority_kind: "SYSTEM",
        reason_code: "LATE_PAYMENT_INVENTORY_UNAVAILABLE",
        request_id: command.requestId,
        correlation_id: command.correlationId,
        occurred_at: at,
      });
      await appendOutbox(
        input,
        "FULFILLMENT_STATUS_CHANGED",
        String(f["id"]),
        refs.orderId,
        Number(f["version"]) + 1,
        { fulfillmentId: f["id"], orderId: order["id"], status: "ON_HOLD" },
        at,
      );
      statuses.set(String(f["id"]), "ON_HOLD");
    }
    const delivered = await deliverDigitalFulfillments(client, {
      orderId: refs.orderId,
      lines: digital,
      at,
      taskName: command.taskName,
      requestId: command.requestId,
      correlationId: command.correlationId,
      appendOutbox: (event) =>
        appendOutbox(
          input,
          "FULFILLMENT_STATUS_CHANGED",
          event.fulfillmentId,
          event.orderId,
          event.version,
          {
            fulfillmentId: event.fulfillmentId,
            orderId: event.orderId,
            status: "DELIVERED",
          },
          event.at,
        ),
    });
    for (const id of delivered) statuses.set(id, "DELIVERED");
    const held = deriveFulfillmentAggregate([...statuses.values()]);
    await client.query(
      `UPDATE public.support_intents s SET status='CONVERTED',version=version+1,updated_at=GREATEST($2::timestamptz,updated_at) WHERE s.id IN(SELECT support_intent_id FROM public.order_items WHERE order_id=$1::uuid)`,
      [order["id"], at],
    );
    await client.query(
      `UPDATE public.carts SET status='CONVERTED',version=version+1,updated_at=GREATEST($2::timestamptz,updated_at) WHERE id=$1::uuid`,
      [order["cart_id"], at],
    );
    await client.query(
      `UPDATE public.orders SET order_status='OPEN',payment_status='PAID',fulfillment_status=$2,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid`,
      [order["id"], held, at],
    );
    if (hasWish)
      await recordPaidWishSupports(client, {
        orderId: refs.orderId,
        providerEventId: String(event["id"]),
        supportedAt: at,
      });
    await insertPaymentRow(client, "order_events", {
      id: randomUUID(),
      order_id: order["id"],
      sequence: Number(order["version"]) + 1,
      event_type:
        order["order_status"] === "CANCELED"
          ? "LATE_PAYMENT_RECOVERED"
          : "PAYMENT_STATUS_CHANGED",
      from_order_status: order["order_status"],
      to_order_status: "OPEN",
      from_payment_status: order["payment_status"],
      to_payment_status: "PAID",
      from_dispute_status: order["dispute_status"],
      to_dispute_status: order["dispute_status"],
      from_fulfillment_status: order["fulfillment_status"],
      to_fulfillment_status: held,
      from_payment_attempt_id: attempt["id"],
      to_payment_attempt_id: attempt["id"],
      authority_kind: "PROVIDER_EVIDENCE",
      reason_code:
        order["order_status"] === "CANCELED"
          ? unavailable
            ? "LATE_PAYMENT_INVENTORY_UNAVAILABLE"
            : "PAYMENT_SUCCESS_RECONCILED"
          : "ORDER_PAYMENT_CONFIRMED",
      provider_event_id: event["id"],
      request_id: command.requestId,
      correlation_id: command.correlationId,
      occurred_at: at,
    });
    await appendOutbox(
      input,
      "ORDER_PAYMENT_CONFIRMED",
      refs.orderId,
      refs.attemptId,
      Number(order["version"]) + 1,
      { orderId: order["id"], paymentAttemptId: attempt["id"] },
      at,
    );
  }
  return recordOrderPaymentResult(client, command, {
    decision: "APPLIED",
    ...refs,
    outcome: success
      ? unavailable
        ? "PAID_REVIEW"
        : "PAID"
      : "FAILED_RELEASED",
  });
}
