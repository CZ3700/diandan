import { expect, test } from "vitest";
import * as stripe from "./index.js";

test("the deployment boundary exposes the adapter factory and wiring constants, never raw transports or credentials", () => {
  expect(Object.keys(stripe).sort()).toEqual([
    "STRIPE_ADAPTER_KEY",
    "STRIPE_ADAPTER_VERSION",
    "STRIPE_API_ORIGIN",
    "STRIPE_API_VERSION",
    "STRIPE_CHECKOUT_ORIGIN",
    "STRIPE_PROTOCOL",
    "STRIPE_SIGNATURE_HEADER",
    "STRIPE_WEBHOOK_EVENT_TYPES",
    "createStripeAdapter",
    "workspacePackageName",
  ]);
  expect(stripe.workspacePackageName).toBe("@fan-support/payment-stripe");
  expect(stripe.STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
});
