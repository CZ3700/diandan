import { describe, expect, test } from "vitest";

import {
  decideFulfillmentTransition,
  type FulfillmentStatus,
} from "./fulfillment-state-machine.js";

function operator(reasonCode?: string) {
  return {
    kind: "OPERATOR_COMMAND" as const,
    expectedVersion: 3,
    currentVersion: 3,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

describe("fulfillment state machine", () => {
  test("implements exactly the normal adjacency matrix", () => {
    const allowed: ReadonlyArray<
      readonly [FulfillmentStatus, FulfillmentStatus, string | undefined]
    > = [
      ["PENDING", "PREPARING", undefined],
      ["PENDING", "ON_HOLD", "OPERATIONS_REVIEW"],
      ["PENDING", "CANCELED", "ORDER_CANCELED"],
      ["PREPARING", "DELIVERED", undefined],
      ["PREPARING", "ON_HOLD", "OPERATIONS_REVIEW"],
      ["PREPARING", "CANCELED", "ORDER_CANCELED"],
      ["ON_HOLD", "PENDING", undefined],
      ["ON_HOLD", "PREPARING", undefined],
      ["ON_HOLD", "CANCELED", "ORDER_CANCELED"],
    ];

    for (const [from, to, reasonCode] of allowed) {
      expect(
        decideFulfillmentTransition(from, to, operator(reasonCode)).decision,
      ).toBe("APPLIED");
    }

    expect(
      decideFulfillmentTransition("PENDING", "DELIVERED", operator()),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "FULFILLMENT_TRANSITION_NOT_ALLOWED",
    });
  });

  test("requires optimistic version and a reason for hold or cancellation", () => {
    expect(
      decideFulfillmentTransition("PENDING", "PREPARING", {
        kind: "OPERATOR_COMMAND",
        expectedVersion: 2,
        currentVersion: 3,
      }),
    ).toMatchObject({
      decision: "REJECTED",
      reasonCode: "FULFILLMENT_STALE_VERSION",
    });

    for (const target of ["ON_HOLD", "CANCELED"] as const) {
      expect(
        decideFulfillmentTransition("PENDING", target, operator()),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "FULFILLMENT_REASON_REQUIRED",
      });

      expect(
        decideFulfillmentTransition("PENDING", target, operator("")),
      ).toMatchObject({
        decision: "REJECTED",
        reasonCode: "FULFILLMENT_REASON_REQUIRED",
      });
    }
  });

  test("makes same-state requests no-ops and terminal contradictions conflicts", () => {
    expect(
      decideFulfillmentTransition("DELIVERED", "DELIVERED", {
        kind: "OPERATOR_COMMAND",
        expectedVersion: 1,
        currentVersion: 2,
      }),
    ).toMatchObject({ decision: "NOOP", effects: [] });

    expect(
      decideFulfillmentTransition("DELIVERED", "CANCELED", operator()),
    ).toMatchObject({
      decision: "CONFLICT",
      reasonCode: "FULFILLMENT_TERMINAL_STATE_CONFLICT",
      effects: [],
    });
  });
});
