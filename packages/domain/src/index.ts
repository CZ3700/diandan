export const workspacePackageName = "@fan-support/domain" as const;

export { evaluateGiftEligibility } from "./gift-eligibility.js";
export { decideIdempotency } from "./idempotency.js";
export {
  planInventoryReservationCreation,
  planInventoryReservationTransition,
} from "./inventory-reservation.js";
export { calculateLineAmounts, calculateOrderAmounts } from "./money.js";
export { selectPaymentRoute } from "./payment-routing.js";
export { selectEffectivePrice } from "./price-selection.js";
export { evaluateRefundCapacity } from "./refund-capacity.js";
export {
  decideDisputeTransitionCommand,
  decideFulfillmentTransitionCommand,
  decideOrderLifecycleTransitionCommand,
  decideOrderPaymentTransitionCommand,
  decidePaymentAttemptTransitionCommand,
  decideRefundTransitionCommand,
  planLatePaymentSuccessCommand,
} from "./state-machine-commands.js";
