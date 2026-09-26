import { expect, test, vi } from "vitest";

import {
  assertDeployedPaymentAdapters,
  deployedPaymentConnectorFactories,
} from "./payment-deployed-adapters.js";
import { paymentConnection } from "./test-support/production-environment.js";

const factory = {
  descriptor: {
    schemaVersion: 1,
    adapterKey: "sandbox-gateway",
    adapterVersion: "1.0.0",
    protocol: "sandbox-gateway-v1",
    supportedOperations: ["GET_CAPABILITIES"],
    supportedInstrumentKinds: ["CARD"],
    idempotency: {
      retention: "DURABLE",
      minimumRetentionSeconds: 0,
      referenceLookup: true,
    },
  },
  create: vi.fn(),
} as never;

test("this release deploys no payment adapter code yet, so no account can activate", () => {
  expect(deployedPaymentConnectorFactories).toEqual([]);
  expect(Object.isFrozen(deployedPaymentConnectorFactories)).toBe(true);
  expect(() =>
    assertDeployedPaymentAdapters([], deployedPaymentConnectorFactories),
  ).not.toThrow();
});

test("an account needs deployed code with the exact adapter key, version and protocol", () => {
  expect(() =>
    assertDeployedPaymentAdapters([paymentConnection as never], [factory]),
  ).not.toThrow();
  for (const connection of [
    { ...paymentConnection, adapterVersion: "1.0.1" },
    { ...paymentConnection, protocol: "sandbox-gateway-v2" },
    {
      ...paymentConnection,
      binding: { ...paymentConnection.binding, providerCode: "other" },
    },
  ])
    expect(() =>
      assertDeployedPaymentAdapters([connection as never], [factory]),
    ).toThrow("Payment account has no deployed adapter");
  // Construction is deferred to the registry; the assertion itself never builds providers.
  expect(
    (factory as { create: ReturnType<typeof vi.fn> }).create,
  ).not.toHaveBeenCalled();
});
