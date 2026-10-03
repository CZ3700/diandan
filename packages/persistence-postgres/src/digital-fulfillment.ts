import { randomUUID } from "node:crypto";
import { decideFulfillmentTransition } from "@fan-support/domain";
import { createPersistenceTransactionFailureError } from "./transaction-runner.js";
import { draftRows } from "./content-draft-data.js";
import { insertPaymentRow } from "./payment-runtime-history.js";
import type { TransactionClient } from "./transaction-runner.js";

export const DIGITAL_DELIVERY_REASON = "VIRTUAL_GIFT_AUTO_DELIVERED";

export type DigitalFulfillmentLine = Readonly<{
  fulfillmentId: string;
  orderItemId: string;
  status: string;
  version: number;
  giftKind: string | null;
}>;

export type DigitalDeliveryOutboxEvent = Readonly<{
  eventId: string;
  fulfillmentId: string;
  orderId: string;
  version: number;
  at: string;
}>;

/** A VIRTUAL gift line is a digital support record (ADR-019); legacy lines without a kind are studio work. */
export function isDigitalFulfillmentLine(
  line: Readonly<{ giftKind: string | null }>,
): boolean {
  return line.giftKind === "VIRTUAL";
}

const integrity = (): never => {
  throw createPersistenceTransactionFailureError({
    code: "INTEGRITY_VIOLATION",
    recovery: "NONE",
  });
};

/**
 * Delivers every pending VIRTUAL line in the caller's transaction: domain decision, fulfillment
 * row, SYSTEM audit, fulfillment event, then the caller's outbox writer. Returns the delivered
 * fulfillment IDs so the caller can derive the order aggregate. Never touches studio lines.
 */
export async function deliverDigitalFulfillments(
  client: TransactionClient,
  input: Readonly<{
    orderId: string;
    lines: readonly DigitalFulfillmentLine[];
    at: string;
    taskName: string;
    requestId: string;
    correlationId: string;
    appendOutbox: (event: DigitalDeliveryOutboxEvent) => Promise<void>;
  }>,
): Promise<string[]> {
  const delivered: string[] = [];
  for (const line of input.lines) {
    if (!isDigitalFulfillmentLine(line) || line.status !== "PENDING") continue;
    const decision = decideFulfillmentTransition("PENDING", "DELIVERED", {
      kind: "SYSTEM_DIGITAL_DELIVERY",
      expectedVersion: line.version,
      currentVersion: line.version,
    });
    if (decision.decision !== "APPLIED") return integrity();
    const updated = await draftRows(
      client,
      `UPDATE public.fulfillments SET status='DELIVERED',prepared_at=coalesce(prepared_at,$2::timestamptz),delivered_at=$2::timestamptz,version=version+1,updated_at=GREATEST($2::timestamptz,updated_at) WHERE id=$1::uuid AND order_id=$4::uuid AND status='PENDING' AND version=$3 RETURNING id`,
      [line.fulfillmentId, input.at, line.version, input.orderId],
    );
    if (updated.length !== 1) return integrity();
    const auditLogId = randomUUID();
    await insertPaymentRow(client, "audit_logs", {
      id: auditLogId,
      actor_type: "SYSTEM",
      task_name: input.taskName,
      action: DIGITAL_DELIVERY_REASON,
      subject_type: "FULFILLMENT",
      subject_id: line.fulfillmentId,
      reason_code: DIGITAL_DELIVERY_REASON,
      request_id: input.requestId,
      correlation_id: input.correlationId,
      outcome: "SUCCEEDED",
      created_at: input.at,
    });
    const eventId = randomUUID();
    await insertPaymentRow(client, "fulfillment_events", {
      id: eventId,
      fulfillment_id: line.fulfillmentId,
      order_id: input.orderId,
      sequence: line.version + 1,
      from_status: "PENDING",
      to_status: "DELIVERED",
      authority_kind: "SYSTEM",
      reason_code: DIGITAL_DELIVERY_REASON,
      audit_log_id: auditLogId,
      request_id: input.requestId,
      correlation_id: input.correlationId,
      occurred_at: input.at,
    });
    await input.appendOutbox({
      eventId,
      fulfillmentId: line.fulfillmentId,
      orderId: input.orderId,
      version: line.version + 1,
      at: input.at,
    });
    delivered.push(line.fulfillmentId);
  }
  return delivered;
}
