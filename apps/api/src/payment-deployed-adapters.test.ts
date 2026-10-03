import { expect, test, vi } from "vitest";

import {
  assertDeployedPaymentAdapters,
  assertPaymentActionLifetime,
  createDeployedPaymentAdapters,
} from "./payment-deployed-adapters.js";
import {
  airwallexConnection,
  airwallexWebhookEndpoint,
  paymentConnection,
  stripeConnection,
} from "./test-support/production-environment.js";

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

test("this release deploys Stripe Checkout and the Airwallex Hosted Payment Page, each with its own webhook verifier", () => {
  const adapters = createDeployedPaymentAdapters({
    credentials: { resolve: vi.fn() },
  });
  expect(
    adapters.connectorFactories.map(({ descriptor }) => [
      descriptor.adapterKey,
      descriptor.adapterVersion,
      descriptor.protocol,
    ]),
  ).toEqual([
    ["stripe", "1.0.0", "stripe-checkout-v1"],
    ["airwallex", "1.0.0", "airwallex-hpp-v1"],
  ]);
  expect(
    adapters.webhookVerifierFor(
      airwallexWebhookEndpoint as never,
      airwallexConnection as never,
    ),
  ).toMatchObject({ headerNames: ["x-signature", "x-timestamp"] });
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

test("stored actions must expire before an Airwallex client secret does; other accounts set no limit", () => {
  const adapters = createDeployedPaymentAdapters({
    credentials: { resolve: vi.fn() },
  });
  const airwallex = [airwallexConnection as never];
  expect(() =>
    assertPaymentActionLifetime(300_000, airwallex, adapters),
  ).not.toThrow();
  expect(() =>
    assertPaymentActionLifetime(3_300_000, airwallex, adapters),
  ).not.toThrow();
  expect(() =>
    assertPaymentActionLifetime(3_300_001, airwallex, adapters),
  ).toThrow("Payment action lifetime exceeds a deployed provider token");
  expect(() =>
    assertPaymentActionLifetime(
      86_400_000,
      [stripeConnection as never],
      adapters,
    ),
  ).not.toThrow();
  expect(() =>
    assertPaymentActionLifetime(undefined, airwallex, adapters),
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
