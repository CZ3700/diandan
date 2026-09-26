import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { vi } from "vitest";

import type { ApiReliableEventsComposition } from "../reliable-events-composition.js";

const kmsKey =
  "arn:aws:kms:us-east-1:111122223333:key/11111111-1111-4111-8111-111111111111";

export const quietLogger = Object.freeze({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/** Deployed-tier core settings. The database address refuses connections, so no test traffic leaves the process. */
export const coreEnvironment = Object.freeze({
  NODE_ENV: "production",
  FAN_SUPPORT_DEPLOYMENT_ENV: "staging",
  FAN_SUPPORT_SITE_ORIGIN: "https://shop.example.invalid",
  FAN_SUPPORT_DATABASE_URL: [
    "postgresql://",
    "api",
    ":",
    "fixture-password",
    "@127.0.0.1:1/fan_support",
  ].join(""),
  FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "ambient",
  FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
  FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "fan-support-media-derivative",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
    "https://media.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
});

export const commerceEnvironment = Object.freeze({
  FAN_SUPPORT_CART_KMS_REGION: "us-east-1",
  FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION: "encryption-v1",
  FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON: JSON.stringify({
    "encryption-v1": kmsKey,
  }),
  FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION: "blind-v1",
  FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON: JSON.stringify({
    "blind-v1": kmsKey,
  }),
  FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON: JSON.stringify({
    schemaVersion: 1,
    publicStorefrontOrigin: "https://shop.example.invalid",
    sessionTtlSeconds: 900,
    linkTtlSeconds: 3600,
    rateLimit: {
      windowSeconds: 60,
      exchangeMax: 10,
      bootstrapMax: 10,
      readMax: 100,
      revokeMax: 10,
    },
  }),
});

export const paymentEnvironment = Object.freeze({
  FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON: JSON.stringify({
    schemaVersion: 1,
    publicStorefrontOrigin: "https://shop.example.invalid",
    leaseMs: 10_000,
    recoveryDelayMs: 10_000,
    actionTtlMs: 60_000,
    returnStateTtlMs: 60_000,
    recoveryBatchSize: 5,
  }),
  FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: "[]",
  FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: "[]",
});

export const adminOidcConfiguration = Object.freeze({
  schemaVersion: 1,
  clientId: "fan-support-admin",
  clientAuthentication: "NONE",
  acceptedAcrValues: [],
  requiredAmrValues: ["mfa"],
  policyVersion: "admin-mfa-v1",
  loginTtlSeconds: 300,
  sessionTtlSeconds: 3600,
  maxAuthenticationAgeSeconds: 300,
});

export const adminEnvironment = Object.freeze({
  FAN_SUPPORT_ADMIN_ORIGIN: "https://admin.example.invalid",
  FAN_SUPPORT_ADMIN_ACCESS_KEY: "1".repeat(64),
  FAN_SUPPORT_ADMIN_TOKEN_PEPPER: "2".repeat(64),
  FAN_SUPPORT_ADMIN_SUBJECT_PEPPER: "3".repeat(64),
  FAN_SUPPORT_ADMIN_OIDC_ISSUER: "https://identity.example.invalid",
  FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: JSON.stringify(adminOidcConfiguration),
});

export const completeProductionEnvironment = Object.freeze({
  ...coreEnvironment,
  ...commerceEnvironment,
  ...paymentEnvironment,
  ...adminEnvironment,
});

export const paymentConnection = Object.freeze({
  schemaVersion: 1,
  binding: {
    schemaVersion: 1,
    providerAccountId: "10000000-0000-4000-8000-000000000001",
    providerCode: "sandbox-gateway",
    environment: "TEST",
    localeMapping: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        { providerLocale: locale, fallbackUsed: false },
      ]),
    ),
    allowedActionOrigins: ["https://payments.example.invalid"],
  },
  adapterVersion: "1.0.0",
  protocol: "sandbox-gateway-v1",
  apiOrigin: "https://api.payments.example.invalid",
  returnOrigin: "https://shop.example.invalid",
  merchantAccount: "sandbox-merchant",
  credentialRef: "secret-ref:v1:aws:fan-support/sandbox-gateway",
  timeoutMs: 5000,
  instruments: [
    {
      kind: "CARD",
      paymentMethod: "card",
      brands: ["VISA", "MASTERCARD"],
      authentication: "PSP_MANAGED_3DS",
      capture: "AUTOMATIC",
    },
  ],
});

export const paymentHealthPolicy = Object.freeze({
  schemaVersion: 1,
  providerAccountId: paymentConnection.binding.providerAccountId,
  environment: "TEST",
  version: 1,
  failureThreshold: 3,
  failureWindowMs: 60_000,
  openDurationMs: 30_000,
  probeLeaseMs: 5_000,
  probeRetryMs: 1_000,
});

/** Stands in for the pg-boss backed receiver; the production root must still gate unknown endpoints itself. */
export function createFakeReliableEvents() {
  const endpointPreflight = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "ELIGIBLE" as const,
  }));
  const receive = vi.fn();
  const stop = vi.fn(async () => undefined);
  const composition = {
    paymentWebhookRoute: { receiver: { receive }, endpointPreflight },
    reliableEventsRuntime: { start: vi.fn(async () => undefined), stop },
  } as unknown as ApiReliableEventsComposition;
  return { composition, endpointPreflight, receive, stop };
}

export const stripeConnection = Object.freeze({
  ...paymentConnection,
  binding: {
    ...paymentConnection.binding,
    providerAccountId: "10000000-0000-4000-8000-00000000000a",
    providerCode: "stripe",
    allowedActionOrigins: ["https://checkout.stripe.com"],
  },
  protocol: "stripe-checkout-v1",
  apiOrigin: "https://api.stripe.com",
  credentialRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_API",
});

export const stripeHealthPolicy = Object.freeze({
  ...paymentHealthPolicy,
  providerAccountId: stripeConnection.binding.providerAccountId,
});

export const stripeWebhookEndpoint = Object.freeze({
  schemaVersion: 1,
  binding: stripeConnection.binding,
  endpointId: "70000000-0000-4000-8000-000000000007",
  verificationKeyReferenceHash: "a".repeat(64),
  secretRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_WEBHOOK",
  toleranceSeconds: 300,
  maxBodyBytes: 65_536,
});

/** A complete deployment with one sandbox Stripe account and its webhook endpoint. */
export const stripeEnvironment = Object.freeze({
  ...completeProductionEnvironment,
  FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: JSON.stringify([
    stripeConnection,
  ]),
  FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: JSON.stringify([
    stripeHealthPolicy,
  ]),
  FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON: JSON.stringify([
    stripeWebhookEndpoint,
  ]),
});

/** Thai is not a Hosted Payment Page language, so it falls back to English. */
const airwallexLocales: Readonly<Record<string, string>> = {
  "zh-CN": "zh",
  th: "en",
};

export const airwallexConnection = Object.freeze({
  ...paymentConnection,
  binding: {
    ...paymentConnection.binding,
    providerAccountId: "10000000-0000-4000-8000-00000000000b",
    providerCode: "airwallex",
    localeMapping: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        {
          providerLocale: airwallexLocales[locale] ?? locale,
          fallbackUsed: locale === "th",
        },
      ]),
    ),
    allowedActionOrigins: ["https://checkout.sandbox.airwallex.com"],
  },
  protocol: "airwallex-hpp-v1",
  apiOrigin: "https://api.sandbox.airwallex.com",
  credentialRef: "secret-ref:v1:env:PAYMENT_SECRET_AIRWALLEX_API",
});

export const airwallexHealthPolicy = Object.freeze({
  ...paymentHealthPolicy,
  providerAccountId: airwallexConnection.binding.providerAccountId,
});

export const airwallexWebhookEndpoint = Object.freeze({
  schemaVersion: 1,
  binding: airwallexConnection.binding,
  endpointId: "70000000-0000-4000-8000-000000000008",
  verificationKeyReferenceHash: "c".repeat(64),
  secretRef: "secret-ref:v1:env:PAYMENT_SECRET_AIRWALLEX_WEBHOOK",
  toleranceSeconds: 300,
  maxBodyBytes: 65_536,
});

/** A complete deployment with both launch PSPs in sandbox and one endpoint each. */
export const launchPaymentEnvironment = Object.freeze({
  ...completeProductionEnvironment,
  FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: JSON.stringify([
    stripeConnection,
    airwallexConnection,
  ]),
  FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: JSON.stringify([
    stripeHealthPolicy,
    airwallexHealthPolicy,
  ]),
  FAN_SUPPORT_PAYMENT_WEBHOOK_ENDPOINTS_JSON: JSON.stringify([
    stripeWebhookEndpoint,
    airwallexWebhookEndpoint,
  ]),
});
