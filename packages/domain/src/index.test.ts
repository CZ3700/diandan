import { expect, test } from "vitest";

import * as domain from "./index.js";

test("exposes the domain workspace boundary", () => {
  expect(domain.workspacePackageName).toBe("@fan-support/domain");
});

test("exports the complete public domain decision surface", () => {
  expect(Object.keys(domain).sort()).toEqual([
    "calculateLineAmounts",
    "calculateOrderAmounts",
    "decideDisputeTransitionCommand",
    "decideFulfillmentTransitionCommand",
    "decideIdempotency",
    "decideOrderLifecycleTransitionCommand",
    "decideOrderPaymentTransitionCommand",
    "decidePaymentAttemptTransitionCommand",
    "decideRefundTransitionCommand",
    "evaluateGiftEligibility",
    "evaluateRefundCapacity",
    "planInventoryReservationCreation",
    "planInventoryReservationTransition",
    "planLatePaymentSuccessCommand",
    "selectEffectivePrice",
    "selectPaymentRoute",
    "workspacePackageName",
  ]);
});
