import { expect, test } from "vitest";
import * as gateway from "./index.js";

test("the deployment boundary exposes factories and pure settlement helpers without raw credential resolvers or test harnesses", () => {
  expect(Object.keys(gateway).sort()).toEqual([
    "atomicToDecimal",
    "createGatewayPaymentProvider",
    "createGatewayWebhookVerifier",
    "createNormalizedGatewayFactory",
    "createPaymentConnectorRegistry",
    "decimalToAtomic",
    "evaluateStablecoinPayment",
    "workspacePackageName",
  ]);
  expect(gateway.workspacePackageName).toBe("@fan-support/payment-gateway");
});
