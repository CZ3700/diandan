import {
  providerEventIdSchema,
  orderPaymentApplyCommandSchema,
  orderPaymentApplyResultSchema,
  orderPaymentListPendingCommandSchema,
  orderPaymentPendingEventsSchema,
  type OrderPaymentApplyCommand,
  type OrderPaymentApplyResult,
} from "@fan-support/contracts";
import {
  parsePersistenceTransactionFailure,
  PersistenceTransactionFailureError,
} from "@fan-support/persistence-port";
import type {
  InventoryRepository,
  OutboxRepository,
  OrderPaymentApplicationRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
import {
  rejectOrderPayment,
  recordOrderPaymentResult,
  associateOrderPaymentEvidence,
} from "./order-payment-data.js";
import { applyOrderPaymentAggregate } from "./order-payment-write.js";

async function apply(
  client: TransactionClient,
  inventory: InventoryRepository,
  outbox: OutboxRepository,
  command: OrderPaymentApplyCommand,
): Promise<OrderPaymentApplyResult> {
  // The source event and every financial value are loaded from PostgreSQL, never supplied by callers.
  const [event] = await draftRows(
    client,
    `SELECT e.*,to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at FROM public.provider_events e WHERE e.id=$1::uuid FOR UPDATE`,
    [command.providerEventId],
  );
  if (!event) return rejectOrderPayment("NOT_FOUND");
  const [prior] = await draftRows(
    client,
    `SELECT result FROM public.order_payment_application_receipts WHERE provider_event_id=$1::uuid`,
    [command.providerEventId],
  );
  if (prior) {
    const result = orderPaymentApplyResultSchema.parse(prior["result"]);
    return result.decision === "APPLIED"
      ? { ...result, decision: "ALREADY_APPLIED" }
      : result;
  }
  if (["REFUND_STATUS", "DISPUTE_STATUS"].includes(String(event["event_type"])))
    return recordOrderPaymentResult(client, command, {
      decision: "IGNORED",
      attemptId: null,
      orderId: null,
      reasonCode: "NON_PAYMENT_EVENT",
    });
  const canonicalId =
    typeof event["canonical_transaction_event_id"] === "string"
      ? providerEventIdSchema.parse(event["canonical_transaction_event_id"])
      : command.providerEventId;
  if (canonicalId !== command.providerEventId) {
    const result = await apply(client, inventory, outbox, {
      ...command,
      providerEventId: canonicalId,
    });
    if (result.decision === "UNMATCHED")
      return { ...result, providerEventId: command.providerEventId };
    if (
      result.decision === "APPLIED" ||
      result.decision === "ALREADY_APPLIED"
    ) {
      await associateOrderPaymentEvidence(client, event, result.attemptId);
      const receipt = await recordOrderPaymentResult(
        client,
        command,
        {
          decision: "APPLIED",
          attemptId: result.attemptId,
          orderId: result.orderId,
          outcome: result.outcome,
        },
        canonicalId,
      );
      return {
        ...receipt,
        decision: "ALREADY_APPLIED",
      } as OrderPaymentApplyResult;
    }
    return recordOrderPaymentResult(
      client,
      command,
      {
        decision: result.decision,
        attemptId: result.attemptId,
        orderId: result.orderId,
        reasonCode: result.reasonCode,
      },
      canonicalId,
    );
  }
  const targets = await draftRows(
    client,
    `WITH matched AS (SELECT payment_attempt_id FROM public.provider_event_associations WHERE provider_event_id=$4::uuid AND association_status='MATCHED') SELECT a.id,a.order_id,o.cart_id FROM public.payment_attempts a JOIN public.orders o ON o.id=a.order_id WHERE a.id IN(SELECT payment_attempt_id FROM matched) OR (NOT EXISTS(SELECT 1 FROM matched) AND a.provider_account_id=$1::uuid AND a.environment=$2 AND a.external_reference=$3)`,
    [
      event["provider_account_id"],
      event["environment"],
      event["external_payment_reference"],
      event["id"],
    ],
  );
  if (targets.length === 0)
    return {
      schemaVersion: 1,
      decision: "UNMATCHED",
      providerEventId: command.providerEventId,
      reason: "EXTERNAL_REFERENCE_NOT_BOUND",
    };
  if (targets.length !== 1)
    return recordOrderPaymentResult(client, command, {
      decision: "REVIEW",
      attemptId: null,
      orderId: null,
      reasonCode: "AMBIGUOUS_PAYMENT_REFERENCE",
    });
  const target = targets[0]!;
  await draftRows(
    client,
    `SELECT id FROM public.carts WHERE id=$1::uuid FOR UPDATE`,
    [target["cart_id"]],
  );
  const [order] = await draftRows(
    client,
    `SELECT o.*,c.status cart_status FROM public.orders o JOIN public.carts c ON c.id=o.cart_id WHERE o.id=$1::uuid FOR UPDATE OF o`,
    [target["order_id"]],
  );
  const [attempt] = await draftRows(
    client,
    `SELECT * FROM public.payment_attempts WHERE id=$1::uuid FOR UPDATE`,
    [target["id"]],
  );
  if (!order || !attempt) return rejectOrderPayment("INTEGRITY_VIOLATION");
  const refs = {
    attemptId: String(attempt["id"]),
    orderId: String(order["id"]),
  };
  // A durable MATCHED association can recover a lost create reference; it cannot change an already bound identity.
  if (
    event["provider_account_id"] !== attempt["provider_account_id"] ||
    event["environment"] !== attempt["environment"] ||
    (attempt["external_reference"] !== null &&
      attempt["external_reference"] !== event["external_payment_reference"])
  )
    return recordOrderPaymentResult(client, command, {
      decision: "REVIEW",
      ...refs,
      reasonCode: "PAYMENT_IDENTITY_MISMATCH",
    });
  if (
    event["currency"] !== attempt["currency"] ||
    String(event["amount_minor"]) !== String(attempt["amount_minor"])
  )
    return recordOrderPaymentResult(client, command, {
      decision: "REVIEW",
      ...refs,
      reasonCode: "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH",
    });
  const associations = await draftRows(
    client,
    `SELECT payment_attempt_id FROM public.provider_event_associations WHERE provider_event_id=$1::uuid AND association_status='MATCHED'`,
    [event["id"]],
  );
  if (associations.some((row) => row["payment_attempt_id"] !== attempt["id"]))
    return recordOrderPaymentResult(client, command, {
      decision: "REVIEW",
      ...refs,
      reasonCode: "PAYMENT_ASSOCIATION_MISMATCH",
    });
  await associateOrderPaymentEvidence(client, event, refs.attemptId);
  if (event["event_type"] !== "PAYMENT_STATUS")
    return recordOrderPaymentResult(client, command, {
      decision: "IGNORED",
      ...refs,
      reasonCode: "NON_PAYMENT_EVENT",
    });
  if (
    !["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(
      String(event["normalized_status"]),
    )
  )
    return recordOrderPaymentResult(client, command, {
      decision: "IGNORED",
      ...refs,
      reasonCode: "NONTERMINAL_PAYMENT_OBSERVATION",
    });
  if (order["current_payment_attempt_id"] !== attempt["id"])
    return recordOrderPaymentResult(client, command, {
      decision: "REVIEW",
      ...refs,
      reasonCode: "SUPERSEDED_PAYMENT_ATTEMPT",
    });
  return applyOrderPaymentAggregate({
    client,
    inventory,
    outbox,
    command,
    event,
    attempt,
    order,
  });
}
export function createOrderPaymentApplicationRepository(
  client: TransactionClient,
  inventory: InventoryRepository,
  outbox: OutboxRepository,
  scope: TransactionScopeControl,
): OrderPaymentApplicationRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        const failure = parsePersistenceTransactionFailure(error);
        if (failure) throw new PersistenceTransactionFailureError(failure);
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    apply(input) {
      return run(async () => {
        const parsed = orderPaymentApplyCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderPayment("INVALID_COMMAND");
        return apply(client, inventory, outbox, parsed.data);
      });
    },
    listPending(input) {
      return run(async () => {
        const parsed = orderPaymentListPendingCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderPayment("INVALID_COMMAND");
        // Claiming the scan is its own durable transaction. Failed and unmatched applications move behind later due work.
        const rows = await draftRows(
          client,
          `WITH due AS (SELECT e.id FROM public.provider_events e LEFT JOIN public.order_payment_application_schedule s ON s.provider_event_id=e.id WHERE e.event_type='PAYMENT_STATUS' AND NOT EXISTS(SELECT 1 FROM public.order_payment_application_receipts r WHERE r.provider_event_id=e.id) AND coalesce(s.next_attempt_at,e.normalized_at)<=clock_timestamp() ORDER BY coalesce(s.next_attempt_at,e.normalized_at),e.id LIMIT $1::integer FOR UPDATE OF e SKIP LOCKED) INSERT INTO public.order_payment_application_schedule(provider_event_id,next_attempt_at,attempt_count) SELECT id,clock_timestamp()+interval '30 seconds',1 FROM due ON CONFLICT(provider_event_id) DO UPDATE SET next_attempt_at=EXCLUDED.next_attempt_at,attempt_count=order_payment_application_schedule.attempt_count+1 RETURNING provider_event_id`,
          [parsed.data.limit],
        );
        return orderPaymentPendingEventsSchema.parse({
          schemaVersion: 1,
          providerEventIds: rows.map((row) => row["provider_event_id"]),
        });
      });
    },
  };
}
