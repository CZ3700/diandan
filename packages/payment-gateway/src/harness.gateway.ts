import {
  createPaymentCommandSchema,
  paymentAccountConnectionSchema,
  paymentPortCommandSchema,
  paymentPortResponseSchema,
  SUPPORTED_LOCALES,
  type GetPaymentCapabilitiesCommand,
  type GetPaymentCommand,
} from "@fan-support/contracts";
import type { GatewayCredentialRequest } from "./credentials.js";
export const accountId = "71000000-0000-4000-8000-000000000001";
export const attemptId = "71000000-0000-4000-8000-000000000002";
export const connection = paymentAccountConnectionSchema.parse({
  schemaVersion: 1,
  binding: {
    schemaVersion: 1,
    providerAccountId: accountId,
    providerCode: "normalized-gateway",
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
  protocol: "fan-support-gateway-v1",
  apiOrigin: "https://gateway.example.invalid",
  returnOrigin: "https://shop.example.invalid",
  merchantAccount: "test-merchant",
  credentialRef: "secret-ref:v1:payment:test/api",
  timeoutMs: 100,
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
export const create = createPaymentCommandSchema.parse({
  schemaVersion: 1,
  operation: "CREATE_PAYMENT",
  providerAccountId: accountId,
  environment: "TEST",
  attemptId,
  orderId: "71000000-0000-4000-8000-000000000003",
  paymentMethod: "card",
  amountMinor: 2500,
  currency: "USD",
  requestedLocale: "en",
  merchantReference: attemptId,
  providerIdempotencyKey: attemptId,
  returnUrl: "https://shop.example.invalid/en/checkout/return",
  cancelUrl: "https://shop.example.invalid/en/checkout/cancel",
});
export const capabilities = paymentPortCommandSchema.parse({
  schemaVersion: 1,
  operation: "GET_CAPABILITIES",
  providerAccountId: accountId,
  environment: "TEST",
  market: "GLOBAL",
  country: "US",
  currency: "USD",
  amountMinor: 2500,
  requestedLocale: "en",
  supportedActionTypes: ["REDIRECT", "WAIT"],
}) as GetPaymentCapabilitiesCommand;
export const get = paymentPortCommandSchema.parse({
  schemaVersion: 1,
  operation: "GET_PAYMENT",
  providerAccountId: accountId,
  environment: "TEST",
  attemptId,
  externalReference: "gateway-payment/test-1",
}) as GetPaymentCommand;
export const observedAt = "2026-09-09T00:00:00.000Z";
export const createResponse = paymentPortResponseSchema.parse({
  schemaVersion: 1,
  operation: "CREATE_PAYMENT",
  outcome: "SUCCESS",
  value: {
    providerAccountId: accountId,
    environment: "TEST",
    attemptId,
    orderId: create.orderId,
    amountMinor: create.amountMinor,
    currency: create.currency,
    status: "REQUIRES_ACTION",
    externalReference: get.externalReference,
    providerLocale: "en",
    fallbackUsed: false,
    observedAt,
    action: {
      schemaVersion: 1,
      type: "REDIRECT",
      url: "https://payments.example.invalid/hosted/test-1",
    },
  },
});
export const capability = {
  schemaVersion: 1,
  id: "71000000-0000-4000-8000-000000000004",
  paymentMethod: "card",
  displayName: "TEST cards",
  market: "GLOBAL",
  country: "US",
  currency: "USD",
  minimumAmountMinor: 1,
  maximumAmountMinor: 100000,
  actionTypes: ["REDIRECT"],
  available: true,
};
export const credentials = {
  resolve: async (request: GatewayCredentialRequest) => ({
    ...request,
    version: "v1",
    values: ["test-runtime-bearer"],
  }),
};
