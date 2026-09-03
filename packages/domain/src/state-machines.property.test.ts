import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { decideDisputeTransition } from "./dispute-state-machine.js";
import { decideFulfillmentTransition } from "./fulfillment-state-machine.js";
import { decideOrderPaymentTransition } from "./order-state-machine.js";
import { decidePaymentAttemptTransition } from "./payment-state-machine.js";
import { decideRefundTransition } from "./refund-state-machine.js";

const PROPERTY_SEED = 0x5eed0103;

describe("state machine properties", () => {
  test("same-state commands are always serializable no-ops without effects", () => {
    const paymentStatuses = [
      "CREATED",
      "REQUIRES_ACTION",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "EXPIRED",
      "UNKNOWN",
    ] as const;
    const refundStatuses = [
      "REQUESTED",
      "SUBMITTING",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "UNKNOWN",
    ] as const;
    const disputeStatuses = ["NONE", "OPEN", "WON", "LOST"] as const;
    const fulfillmentStatuses = [
      "PENDING",
      "PREPARING",
      "DELIVERED",
      "ON_HOLD",
      "CANCELED",
    ] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(
          ...paymentStatuses.map((status) => ({ machine: "payment", status })),
          ...refundStatuses.map((status) => ({ machine: "refund", status })),
          ...disputeStatuses.map((status) => ({ machine: "dispute", status })),
          ...fulfillmentStatuses.map((status) => ({
            machine: "fulfillment",
            status,
          })),
        ),
        ({ machine, status }) => {
          const decision =
            machine === "payment"
              ? decidePaymentAttemptTransition(
                  status as (typeof paymentStatuses)[number],
                  status as (typeof paymentStatuses)[number],
                  { kind: "BROWSER_RETURN" },
                )
              : machine === "refund"
                ? decideRefundTransition(
                    status as (typeof refundStatuses)[number],
                    status as (typeof refundStatuses)[number],
                    { kind: "BROWSER_RETURN" },
                  )
                : machine === "dispute"
                  ? decideDisputeTransition(
                      status as (typeof disputeStatuses)[number],
                      status as (typeof disputeStatuses)[number],
                      { kind: "BROWSER_RETURN" },
                    )
                  : decideFulfillmentTransition(
                      status as (typeof fulfillmentStatuses)[number],
                      status as (typeof fulfillmentStatuses)[number],
                      {
                        kind: "OPERATOR_COMMAND",
                        expectedVersion: 1,
                        currentVersion: 2,
                      },
                    );

          expect(decision.decision).toBe("NOOP");
          expect(decision.effects).toEqual([]);
          expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
        },
      ),
      { seed: PROPERTY_SEED, numRuns: 200 },
    );
  });

  test("explicit terminal states never use last-write-wins", () => {
    const terminalStatuses = [
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "EXPIRED",
    ] as const;
    const distinctTerminalPairs = terminalStatuses.flatMap((from) =>
      terminalStatuses
        .filter((to) => to !== from)
        .map((to) => [from, to] as const),
    );

    fc.assert(
      fc.property(fc.constantFrom(...distinctTerminalPairs), ([from, to]) => {
        const result = decidePaymentAttemptTransition(from, to, {
          kind: "BROWSER_RETURN",
        });
        expect(result.decision).toBe("CONFLICT");
        expect(result.effects).toEqual([]);
      }),
      { seed: PROPERTY_SEED, numRuns: 200 },
    );
  });

  test("refund aggregate classification is deterministic at safe integer boundaries", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (capturedAmountMinor, candidateRefundAmount) => {
          const succeededRefundAmountMinor = Math.min(
            candidateRefundAmount,
            capturedAmountMinor,
          );
          const target =
            succeededRefundAmountMinor === capturedAmountMinor
              ? "REFUNDED"
              : succeededRefundAmountMinor > 0
                ? "PARTIALLY_REFUNDED"
                : "PAID";
          const result =
            target === "PAID"
              ? decideOrderPaymentTransition("PAID", "PAID", {
                  kind: "REFUND_TOTALS",
                  capturedAmountMinor,
                  succeededRefundAmountMinor,
                })
              : decideOrderPaymentTransition("PAID", target, {
                  kind: "REFUND_TOTALS",
                  capturedAmountMinor,
                  succeededRefundAmountMinor,
                });

          expect(["APPLIED", "NOOP"]).toContain(result.decision);
          expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        },
      ),
      { seed: PROPERTY_SEED, numRuns: 500 },
    );
  });
});
