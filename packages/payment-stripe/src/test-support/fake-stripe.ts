import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import type { PaymentCredentialRequest } from "@fan-support/payment-port";

import type {
  StripeRequest,
  StripeResponse,
  StripeTransport,
} from "../transport.js";

export const accountId = "10000000-0000-4000-8000-000000000001";
export const attemptId = "20000000-0000-4000-8000-000000000002";
export const orderId = "30000000-0000-4000-8000-000000000003";
export const refundId = "40000000-0000-4000-8000-000000000004";
export const auditLogId = "50000000-0000-4000-8000-000000000005";
export const sessionId = "cs_test_a1B2c3";
export const sessionReference = "cs.test.a1B2c3";
export const intentId = "pi_3MtwBw";
export const apiKey = ["sk", "test", "fixtureApiKey0123456789"].join("_");
export const webhookSecret = ["whsec", "fixtureWebhookSecret0123"].join("_");
export const rotatedWebhookSecret = ["whsec", "rotatedWebhookSecret987"].join(
  "_",
);

const localeMapping = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [
    locale,
    {
      providerLocale:
        locale === "zh-CN" ? "zh" : locale === "pt" ? "pt-BR" : locale,
      fallbackUsed: false,
    },
  ]),
);

export const connection = Object.freeze({
  schemaVersion: 1 as const,
  binding: {
    schemaVersion: 1 as const,
    providerAccountId: accountId,
    providerCode: "stripe",
    environment: "TEST" as const,
    localeMapping,
    allowedActionOrigins: ["https://checkout.stripe.com"],
  },
  adapterVersion: "1.0.0",
  protocol: "stripe-checkout-v1",
  apiOrigin: "https://api.stripe.com",
  returnOrigin: "https://shop.example.invalid",
  merchantAccount: "fan-support-test",
  credentialRef: "secret-ref:v1:env:PAYMENT_SECRET_STRIPE_API",
  timeoutMs: 5000,
  instruments: [
    {
      kind: "CARD" as const,
      paymentMethod: "card",
      brands: ["VISA", "MASTERCARD"] as ["VISA", "MASTERCARD"],
      authentication: "PSP_MANAGED_3DS" as const,
      capture: "AUTOMATIC" as const,
    },
  ],
}) as never;

export function credentialResolver(
  values: Readonly<
    Record<PaymentCredentialRequest["purpose"], readonly string[]>
  > = {
    API_AUTH: [apiKey],
    WEBHOOK_VERIFY: [webhookSecret],
  },
) {
  return {
    resolve: async (request: PaymentCredentialRequest) => ({
      ...request,
      version: "v1",
      values: values[request.purpose],
    }),
  };
}

export function session(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: sessionId,
    object: "checkout.session",
    mode: "payment",
    status: "open",
    payment_status: "unpaid",
    url: `https://checkout.stripe.com/c/pay/${sessionId}#fragment`,
    payment_intent: null,
    amount_total: 2500,
    currency: "usd",
    client_reference_id: attemptId,
    locale: "en",
    metadata: { fan_support_attempt_id: attemptId },
    livemode: false,
    created: 1_790_000_000,
    ...overrides,
  };
}

export function paymentIntent(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: intentId,
    object: "payment_intent",
    status: "succeeded",
    amount: 2500,
    currency: "usd",
    latest_charge: "ch_1Fixture",
    metadata: { fan_support_attempt_id: attemptId },
    livemode: false,
    ...overrides,
  };
}

export function refund(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "re_1Fixture",
    object: "refund",
    amount: 1000,
    currency: "usd",
    status: "succeeded",
    payment_intent: intentId,
    metadata: {
      fan_support_refund_id: refundId,
      fan_support_refund_reference: "refund-ref-1",
      fan_support_attempt_id: attemptId,
      fan_support_external_reference: sessionReference,
    },
    created: 1_790_000_100,
    ...overrides,
  };
}

export function list(data: readonly unknown[], hasMore = false) {
  return { object: "list", data, has_more: hasMore };
}

type Handler = (
  request: StripeRequest,
) => StripeResponse | Promise<StripeResponse>;

export function ok(body: unknown, replayed = false): StripeResponse {
  return { status: 200, replayed, body };
}
export function error(
  status: number,
  type = "invalid_request_error",
): StripeResponse {
  return { status, replayed: false, body: { error: { type } } };
}

/** Routes by "METHOD path" and records every call; an unrouted call is a test failure. */
export function fakeStripe(routes: Readonly<Record<string, Handler>>) {
  const calls: StripeRequest[] = [];
  const keys: string[] = [];
  const transport: StripeTransport = async (request, secretKey) => {
    calls.push(request);
    keys.push(secretKey);
    const handler = routes[`${request.method} ${request.path}`];
    if (!handler) throw new Error(`Unrouted ${request.method} ${request.path}`);
    return handler(request);
  };
  return { transport, calls, keys };
}
