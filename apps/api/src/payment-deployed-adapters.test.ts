import { expect, test, vi } from "vitest";

import {
  assertDeployedPaymentAdapters,
  createDeployedPaymentAdapters,
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

test("this release deploys Stripe Checkout, and only Stripe accounts get its webhook verifier", () => {
  const adapters = createDeployedPaymentAdapters({
    credentials: { resolve: vi.fn() },
  });
  expect(
    adapters.connectorFactories.map(({ descriptor }) => [
      descriptor.adapterKey,
      descriptor.adapterVersion,
      descriptor.protocol,
    ]),
  ).toEqual([["stripe", "1.0.0", "stripe-checkout-v1"]]);
  const stripeAccount = {
    ...paymentConnection,
    binding: {
      ...paymentConnection.binding,
      providerCode: "stripe",
      allowedActionOrigins: ["https://checkout.stripe.com"],
    },
    protocol: "stripe-checkout-v1",
    apiOrigin: "https://api.stripe.com",
  } as never;
  const endpoint = {
    schemaVersion: 1,
    binding: (stripeAccount as { binding: unknown }).binding,
    endpointId: "70000000-0000-4000-8000-000000000007",
    verificationKeyReferenceHash: "a".repeat(64),
    secretRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK",
    toleranceSeconds: 300,
    maxBodyBytes: 65_536,
  } as never;
  expect(adapters.webhookVerifierFor(endpoint, stripeAccount)).toMatchObject({
    headerNames: ["stripe-signature"],
  });
  expect(
    adapters.webhookVerifierFor(endpoint, paymentConnection as never),
  ).toBeUndefined();
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
