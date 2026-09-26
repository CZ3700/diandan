import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import type { PaymentCredentialRequest } from "@fan-support/payment-port";

import type {
  AirwallexApiOrigin,
  AirwallexAuthorization,
  AirwallexRequest,
  AirwallexResponse,
  AirwallexTransport,
} from "../transport.js";

export const accountId = "10000000-0000-4000-8000-000000000001";
export const attemptId = "20000000-0000-4000-8000-000000000002";
export const orderId = "30000000-0000-4000-8000-000000000003";
export const refundId = "40000000-0000-4000-8000-000000000004";
export const auditLogId = "50000000-0000-4000-8000-000000000005";
export const intentId = "int_hkpdskz7vg1xc7uscdj";
export const intentReference = "int.hkpdskz7vg1xc7uscdj";
export const airwallexRefundId = "rfd_hkpdbybkch3ovunwjy1_1raukh";
export const clientSecret = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJ0eXBlIjoiY2xpZW50LXNlY3JldCJ9",
  "fixtureSignature-0_9",
].join(".");
export const clientId = ["fixture", "ClientId", "01"].join("");
export const apiKey = ["fixture", "ApiKey", "0123456789abcdef"].join("");
export const webhookSecret = ["fixture", "WebhookSecret", "0123"].join("");
export const rotatedWebhookSecret = ["rotated", "WebhookSecret", "987"].join(
  "",
);
export const returnUrl =
  "https://shop.example.invalid/zh-CN/checkout/return?session=60000000-0000-4000-8000-000000000006&attempt=20000000-0000-4000-8000-000000000002";

const providerLocales: Readonly<Record<string, string>> = {
  "zh-CN": "zh",
  th: "en",
};
export const localeMapping = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [
    locale,
    {
      providerLocale: providerLocales[locale] ?? locale,
      // Thai is not among the Hosted Payment Page languages.
      fallbackUsed: locale === "th",
    },
  ]),
);

export const connection = Object.freeze({
  schemaVersion: 1 as const,
  binding: {
    schemaVersion: 1 as const,
    providerAccountId: accountId,
    providerCode: "airwallex",
    environment: "TEST" as const,
    localeMapping,
    allowedActionOrigins: ["https://checkout.sandbox.airwallex.com"],
  },
  adapterVersion: "1.0.0",
  protocol: "airwallex-hpp-v1",
  apiOrigin: "https://api.sandbox.airwallex.com",
  returnOrigin: "https://shop.example.invalid",
  merchantAccount: "fan-support-test",
  credentialRef: "secret-ref:v1:env:PAYMENT_SECRET_AIRWALLEX_API",
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
    API_AUTH: [`${clientId}:${apiKey}`],
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

export function intent(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: intentId,
    request_id: attemptId,
    amount: 25,
    currency: "USD",
    merchant_order_id: attemptId,
    status: "REQUIRES_PAYMENT_METHOD",
    client_secret: clientSecret,
    return_url: returnUrl,
    metadata: {
      fan_support_attempt_id: attemptId,
      fan_support_order_id: orderId,
      fan_support_requested_locale: "zh-CN",
      fan_support_cancel_url: returnUrl,
    },
    created_at: "2026-09-26T00:00:00+0000",
    ...overrides,
  };
}

export function refund(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: airwallexRefundId,
    request_id: refundId,
    payment_intent_id: intentId,
    payment_attempt_id: "att_hkpdskz7vg1xc7uscdj",
    amount: 10,
    currency: "USD",
    status: "RECEIVED",
    metadata: {
      fan_support_refund_id: refundId,
      fan_support_refund_reference: "refund-ref-1",
      fan_support_attempt_id: attemptId,
      fan_support_external_reference: intentReference,
    },
    created_at: "2026-09-26T00:01:00+0000",
    ...overrides,
  };
}

export function list(items: readonly unknown[], hasMore = false) {
  return { has_more: hasMore, items };
}

type Handler = (
  request: AirwallexRequest,
  authorization: AirwallexAuthorization,
) => AirwallexResponse | Promise<AirwallexResponse>;

export function ok(body: unknown, status = 200): AirwallexResponse {
  return { status, body };
}
export function error(
  status: number,
  code = "validation_error",
): AirwallexResponse {
  return { status, body: { code, message: "fixture" } };
}

let tokenCounter = 0;
export const loginResponse = () =>
  ok({
    token: `fixture-access-token-${String(++tokenCounter).padStart(4, "0")}`,
    expires_at: "2026-09-26T00:30:00+0000",
  });

export type RecordedCall = Readonly<{
  origin: AirwallexApiOrigin;
  request: AirwallexRequest;
  authorization: AirwallexAuthorization;
}>;

/**
 * Routes by "METHOD path" and records every call; an unrouted call is a test failure.
 * Logging in succeeds unless a test routes the login path itself.
 */
export function fakeAirwallex(routes: Readonly<Record<string, Handler>>) {
  const calls: RecordedCall[] = [];
  const transport: AirwallexTransport = async (
    origin,
    request,
    authorization,
  ) => {
    calls.push({ origin, request, authorization });
    const key = `${request.method} ${request.path}`;
    const handler =
      routes[key] ??
      (key === "POST /api/v1/authentication/login" ? loginResponse : undefined);
    if (!handler) throw new Error(`Unrouted ${key}`);
    return handler(request, authorization);
  };
  /** Calls other than logging in, in order. */
  const apiCalls = () =>
    calls.filter(
      (call) => call.request.path !== "/api/v1/authentication/login",
    );
  return { transport, calls, apiCalls };
}
