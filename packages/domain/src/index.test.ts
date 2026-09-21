import { expect, test } from "vitest";

import * as domain from "./index.js";

test("exposes the domain workspace boundary", () => {
  expect(domain.workspacePackageName).toBe("@fan-support/domain");
});

test("exports the complete public domain decision surface", () => {
  expect(Object.keys(domain).sort()).toEqual([
    "advancePaymentHealthWindow",
    "calculateLineAmounts",
    "calculateOrderAmounts",
    "decideDisputeTransitionCommand",
    "decideFinanceEvidence",
    "decideFulfillmentTransitionCommand",
    "decideIdempotency",
    "decideOrderLifecycleTransitionCommand",
    "decideOrderPaymentTransitionCommand",
    "decidePaymentAttemptTransitionCommand",
    "decideRefundTransitionCommand",
    "evaluateGiftEligibility",
    "evaluatePaymentRollout",
    "evaluateRefundCapacity",
    "planCheckoutInventory",
    "planInventoryReservationCreation",
    "planInventoryReservationTransition",
    "planLatePaymentSuccessCommand",
    "projectCheckoutPreflight",
    "projectCheckoutSession",
    "projectFinanceDisputeStatus",
    "selectCheckoutInventory",
    "selectEffectivePrice",
    "selectPaymentRoute",
    "workspacePackageName",
  ]);
});
