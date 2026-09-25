import {
  paymentHealthWindowInputSchema,
  paymentHealthWindowResultSchema,
  type PaymentHealthWindowResult,
} from "@fan-support/contracts";

/** The caller supplies database time. Ordinary successes never erase in-flight failure evidence. */
export function advancePaymentHealthWindow(
  input: unknown,
): PaymentHealthWindowResult {
  const state = paymentHealthWindowInputSchema.parse(input);
  let { windowStartedAt, failureCount } = state;
  if (state.classification === "TECHNICAL_FAILURE") {
    const expired =
      windowStartedAt === null ||
      Date.parse(state.now) - Date.parse(windowStartedAt) >=
        state.policy.failureWindowMs;
    if (expired) {
      windowStartedAt = state.now;
      failureCount = 0;
    }
    failureCount = Math.min(failureCount + 1, state.policy.failureThreshold);
  }
  return paymentHealthWindowResultSchema.parse({
    schemaVersion: 1,
    windowStartedAt,
    failureCount,
    thresholdReached:
      state.classification === "TECHNICAL_FAILURE" &&
      failureCount >= state.policy.failureThreshold,
  });
}
