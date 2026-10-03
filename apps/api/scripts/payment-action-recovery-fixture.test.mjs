import assert from "node:assert/strict";
import test from "node:test";
import { withPaymentRuntimeFixture } from "./payment-runtime-runtime.mjs";

test("isolated action expiry accepts only contract durations before starting any service", async () => {
  for (const paymentActionTtlMs of [999, 0, -1, 1500.5, 86_400_001, "1500"])
    await assert.rejects(
      () => withPaymentRuntimeFixture({ paymentActionTtlMs }),
      (error) => error.name === "ZodError",
    );
});
