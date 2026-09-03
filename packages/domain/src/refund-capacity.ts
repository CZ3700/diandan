import {
  refundCapacityDecisionSchema,
  refundCapacityInputSchema,
  type RefundCapacityDecision,
  type RefundCapacityInput,
} from "@fan-support/contracts";

type RefundDataRejectionCode =
  "REFUND_AMOUNT_INVALID" | "REFUND_CURRENCY_MISMATCH" | "REFUND_DATA_INVALID";

function rejected(code: "REFUND_DATA_INVALID"): RefundCapacityDecision {
  return { schemaVersion: 1 as const, kind: "REJECTED" as const, code };
}

function capacityIdentity(value: RefundCapacityInput) {
  return {
    refundId: value.refund.id,
    orderId: value.order.id,
    paymentAttemptId: value.paymentAttempt.id,
    refundExpectedVersion: value.refund.version,
    orderExpectedVersion: value.order.version,
    paymentAttemptExpectedVersion: value.paymentAttempt.version,
    capturedCurrency: value.paymentAttempt.currency,
    capturedAmountMinor: value.paymentAttempt.amountMinor,
    requestedCurrency: value.refund.currency,
    requestedAmountMinor: value.refund.requestedAmountMinor,
  };
}

function rejectedBound(
  code: RefundDataRejectionCode,
  value: RefundCapacityInput,
): RefundCapacityDecision {
  return refundCapacityDecisionSchema.parse({
    schemaVersion: 1 as const,
    kind: "REJECTED" as const,
    code,
    ...capacityIdentity(value),
  });
}

function capacityExceeded(
  occupiedAmountMinor: number,
  value: RefundCapacityInput,
): RefundCapacityDecision {
  return refundCapacityDecisionSchema.parse({
    schemaVersion: 1 as const,
    kind: "REJECTED" as const,
    code: "REFUND_CAPACITY_EXCEEDED" as const,
    occupiedAmountMinor,
    availableAmountMinor: 0,
    ...capacityIdentity(value),
  });
}

/**
 * Evaluates a complete, versioned refund projection for one locked order and
 * its current captured payment attempt. The caller must load the full refund
 * set in the same database transaction that applies the returned predicates.
 */
export function evaluateRefundCapacity(input: unknown): RefundCapacityDecision {
  const parsed = refundCapacityInputSchema.safeParse(input);
  if (!parsed.success) {
    return rejected("REFUND_DATA_INVALID");
  }
  const value: RefundCapacityInput = parsed.data;
  if (value.refund.requestedAmountMinor === 0) {
    return rejectedBound("REFUND_AMOUNT_INVALID", value);
  }
  if (value.refund.currency !== value.paymentAttempt.currency) {
    return rejectedBound("REFUND_CURRENCY_MISMATCH", value);
  }

  const seenIds = new Set<string>();
  let occupied = 0n;
  let currentRefundCount = 0;
  for (const refund of value.refunds) {
    const id = refund.id.toLowerCase();
    if (
      seenIds.has(id) ||
      refund.orderId.toLowerCase() !== value.order.id.toLowerCase() ||
      refund.paymentAttemptId.toLowerCase() !==
        value.paymentAttempt.id.toLowerCase() ||
      refund.capturedCurrency !== value.paymentAttempt.currency ||
      refund.currency !== value.paymentAttempt.currency ||
      refund.capturedAmountMinor !== value.paymentAttempt.amountMinor ||
      refund.processedAmountMinor > refund.requestedAmountMinor ||
      (refund.status === "FAILED" && refund.processedAmountMinor !== 0) ||
      (refund.status === "SUCCEEDED" &&
        refund.processedAmountMinor !== refund.requestedAmountMinor)
    ) {
      return rejectedBound("REFUND_DATA_INVALID", value);
    }
    seenIds.add(id);
    if (id === value.refund.id.toLowerCase()) {
      currentRefundCount += 1;
    }
    if (refund.status !== "FAILED") {
      occupied += BigInt(refund.requestedAmountMinor);
    }
  }
  if (currentRefundCount !== 1 || occupied > BigInt(Number.MAX_SAFE_INTEGER)) {
    return rejectedBound("REFUND_DATA_INVALID", value);
  }

  const captured = BigInt(value.paymentAttempt.amountMinor);
  const occupiedAmountMinor = Number(occupied);
  if (occupied > captured) {
    return capacityExceeded(occupiedAmountMinor, value);
  }
  return refundCapacityDecisionSchema.parse({
    schemaVersion: 1 as const,
    kind: "AVAILABLE" as const,
    occupiedAmountMinor,
    availableAmountMinor: Number(captured - occupied),
    ...capacityIdentity(value),
  });
}
