import { deployedPaymentAdapterSchema } from "@fan-support/contracts";
import { expect, test } from "vitest";

import { createStripeAdapter } from "./factory.js";
import { connection, credentialResolver } from "./test-support/fake-stripe.js";

const account = connection as unknown as Record<string, unknown> & {
  binding: Record<string, unknown>;
};

test("the deployed descriptor promises durable, reference-recoverable card checkout", () => {
  const adapter = createStripeAdapter({ credentials: credentialResolver() });
  expect(
    deployedPaymentAdapterSchema.parse(adapter.connector.descriptor),
  ).toEqual({
    schemaVersion: 1,
    adapterKey: "stripe",
    adapterVersion: "1.0.0",
    protocol: "stripe-checkout-v1",
    supportedOperations: [
      "GET_CAPABILITIES",
      "CREATE_PAYMENT",
      "GET_PAYMENT",
      "CANCEL_PAYMENT",
      "REFUND_PAYMENT",
      "RECONCILE_PAYMENT",
      "RECONCILE_REFUND",
    ],
    supportedInstrumentKinds: ["CARD"],
    idempotency: {
      retention: "DURABLE",
      minimumRetentionSeconds: 0,
      referenceLookup: true,
    },
  });
  const registration = adapter.connector.create(connection);
  expect(registration.configuration).toEqual(account.binding);
  expect(registration.provider.createPayment).toBeTypeOf("function");
});

test("only hosted Stripe Checkout card accounts construct providers or verifiers", () => {
  const adapter = createStripeAdapter({ credentials: credentialResolver() });
  for (const change of [
    { binding: { ...account.binding, providerCode: "normalized-gateway" } },
    { protocol: "fan-support-gateway-v1" },
    { adapterVersion: "2.0.0" },
    { apiOrigin: "https://api.stripe.example" },
    {
      binding: {
        ...account.binding,
        allowedActionOrigins: ["https://pay.example.invalid"],
      },
    },
    {
      instruments: [{ kind: "LOCAL_PAYMENT", paymentMethod: "pix" }],
    },
  ]) {
    expect(() =>
      adapter.connector.create({ ...account, ...change } as never),
    ).toThrow("Invalid Stripe connection");
    expect(() =>
      adapter.createWebhookVerifier(
        {} as never,
        { ...account, ...change } as never,
      ),
    ).toThrow();
  }
});
