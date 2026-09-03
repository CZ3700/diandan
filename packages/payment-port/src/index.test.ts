import { expect, test } from "vitest";

import type { PaymentProvider } from "./index.js";
import * as paymentPort from "./index.js";

type CurrentProviderExcludesLegacyParser =
  "verifyAndParseWebhook" extends keyof PaymentProvider ? false : true;
const currentProviderExcludesLegacyParser: CurrentProviderExcludesLegacyParser = true;

test("exports only current payment provider operations", () => {
  const exports = paymentPort as Record<string, unknown>;
  expect(exports["paymentPortCommandSchema"]).toBeDefined();
  expect(exports["paymentPortResponseSchema"]).toBeDefined();
  expect(exports["PAYMENT_PROVIDER_OPERATIONS"]).toEqual([
    "GET_CAPABILITIES",
    "CREATE_PAYMENT",
    "GET_PAYMENT",
    "CANCEL_PAYMENT",
    "REFUND_PAYMENT",
    "RECONCILE_PAYMENT",
    "RECONCILE_REFUND",
  ]);
  expect(exports["LEGACY_WEBHOOK_PARSER_OPERATIONS"]).toEqual([
    "VERIFY_AND_PARSE_WEBHOOK",
  ]);
});

test("separates raw webhook verification from the payment provider", () => {
  const exports = paymentPort as Record<string, unknown>;

  expect(exports["PAYMENT_WEBHOOK_VERIFIER_OPERATIONS"]).toEqual([
    "VERIFY_PAYMENT_WEBHOOK",
  ]);
  expect(exports["paymentWebhookVerificationCommandSchema"]).toBeDefined();
  expect(exports["paymentWebhookVerificationResponseSchema"]).toBeDefined();
  expect(exports["verifiedWebhookEventCandidateSchema"]).toBeDefined();
  expect(currentProviderExcludesLegacyParser).toBe(true);
});
