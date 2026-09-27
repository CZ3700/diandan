import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  SUPPORTED_LOCALES,
  paymentAccountConnectionSchema,
  paymentGatewayWebhookConfigSchema,
} from "@fan-support/contracts";
import {
  STRIPE_ADAPTER_VERSION,
  STRIPE_API_ORIGIN,
  STRIPE_CHECKOUT_ORIGIN,
  STRIPE_PROTOCOL,
} from "@fan-support/payment-stripe";

/** Persist only provider identity and safe deployment metadata; credentials remain in the API process. */
export function createLocalPaymentBinding(
  provider,
  providerAccountId,
  origins,
) {
  if (!["fake", "stripe-test"].includes(provider))
    throw new TypeError("Invalid local payment provider");
  const stripe = provider === "stripe-test";
  return {
    schemaVersion: 1,
    providerAccountId,
    providerCode: stripe ? "stripe" : "fake",
    environment: "TEST",
    allowedActionOrigins: [stripe ? STRIPE_CHECKOUT_ORIGIN : origins.psp],
    localeMapping: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        {
          providerLocale: stripe
            ? ({ "zh-CN": "zh", pt: "pt-BR" }[locale] ?? locale)
            : locale,
          fallbackUsed: false,
        },
      ]),
    ),
  };
}

/** A single immutable profile owns the account, route method, action origins and endpoint metadata. */
export function localPaymentProfile(config) {
  const provider = config.paymentProvider ?? "fake",
    stripe = provider === "stripe-test";
  const binding = config.services.psp.binding;
  const expected = createLocalPaymentBinding(
    provider,
    binding.providerAccountId,
    config.origins,
  );
  if (
    config.environment !== "LOCAL_TEST" ||
    !isDeepStrictEqual(binding, expected) ||
    (stripe &&
      (!/^(?:test|acceptance)-[a-z0-9-]+$/u.test(config.instance) ||
        config.exposure))
  )
    throw new TypeError("Invalid local payment profile");
  const paymentMethod = stripe ? "card" : "fake_card";
  const connection = paymentAccountConnectionSchema.parse({
    schemaVersion: 1,
    binding,
    adapterVersion: stripe ? STRIPE_ADAPTER_VERSION : "1.0.0",
    protocol: stripe ? STRIPE_PROTOCOL : "persistent-test-v1",
    apiOrigin: stripe ? STRIPE_API_ORIGIN : config.origins.psp,
    returnOrigin: config.origins.storefront,
    merchantAccount: `local-test-${config.instanceId}`,
    credentialRef: stripe
      ? "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_API"
      : `secret-ref:v1:test:local/${binding.providerAccountId}`,
    timeoutMs: stripe ? 15000 : 5000,
    instruments: [
      {
        kind: "CARD",
        paymentMethod,
        brands: ["VISA", "MASTERCARD"],
        authentication: "PSP_MANAGED_3DS",
        capture: "AUTOMATIC",
      },
    ],
  });
  const secretRef = stripe
    ? "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK"
    : "secret-ref:v1:test:local/webhook/" +
      config.services.psp.webhookEndpointId;
  const webhook = paymentGatewayWebhookConfigSchema.parse({
    schemaVersion: 1,
    binding,
    endpointId: config.services.psp.webhookEndpointId,
    secretRef,
    verificationKeyReferenceHash: createHash("sha256")
      .update(secretRef)
      .digest("hex"),
    toleranceSeconds: 300,
    maxBodyBytes: 49152,
  });
  return {
    paymentMethod,
    connection,
    webhook,
    actionOrigins: binding.allowedActionOrigins,
    startFakePsp: !stripe,
    healthPolicy: {
      schemaVersion: 1,
      providerAccountId: binding.providerAccountId,
      environment: "TEST",
      version: 1,
      failureThreshold: 3,
      failureWindowMs: 60000,
      openDurationMs: 30000,
      probeLeaseMs: 5000,
      probeRetryMs: 1000,
    },
  };
}

/** Payment credentials are consumed by the API, never inherited by its browser or worker children. */
export function withoutLocalPaymentCredentials(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        !key.startsWith("PAYMENT_SECRET_") && !key.startsWith("STRIPE_TEST_"),
    ),
  );
}
