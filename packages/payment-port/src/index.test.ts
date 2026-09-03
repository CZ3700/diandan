import { expect, test } from "vitest";

import * as paymentPort from "./index.js";

test("exports all eight normalized payment provider operations", () => {
  const exports = paymentPort as Record<string, unknown>;
  expect(exports["paymentPortCommandSchema"]).toBeDefined();
  expect(exports["paymentPortResponseSchema"]).toBeDefined();
  expect(exports["PAYMENT_PROVIDER_OPERATIONS"]).toEqual([
    "GET_CAPABILITIES",
    "CREATE_PAYMENT",
    "VERIFY_AND_PARSE_WEBHOOK",
    "GET_PAYMENT",
    "CANCEL_PAYMENT",
    "REFUND_PAYMENT",
    "RECONCILE_PAYMENT",
    "RECONCILE_REFUND",
  ]);
});
