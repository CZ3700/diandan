import { describe, expect, it } from "vitest";
import {
  paymentRuntimeProviderBindingSchema,
  SUPPORTED_LOCALES,
  paymentPortCommandSchema,
} from "@fan-support/contracts";

const load = () => import("./payment-runtime-provider.js").catch(() => null);
const id = "10000000-0000-4000-8000-000000000001";
const binding = paymentRuntimeProviderBindingSchema.parse({
  schemaVersion: 1,
  providerAccountId: id,
  providerCode: "fake",
  environment: "TEST",
  localeMapping: Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      { providerLocale: "en", fallbackUsed: locale !== "en" },
    ]),
  ),
  allowedActionOrigins: ["https://payments.example.test"],
});
const command = paymentPortCommandSchema.parse({
  schemaVersion: 1,
  operation: "CREATE_PAYMENT",
  providerAccountId: id,
  environment: "TEST",
  attemptId: id,
  orderId: id,
  paymentMethod: "fake_card",
  amountMinor: 500,
  currency: "USD",
  requestedLocale: "ja",
  merchantReference: id,
  providerIdempotencyKey: id,
  returnUrl: "https://store.example.test/ja/checkout/return",
  cancelUrl: "https://store.example.test/ja/checkout/return",
});
const response = {
  schemaVersion: 1,
  operation: "CREATE_PAYMENT",
  outcome: "SUCCESS",
  value: {
    providerAccountId: id,
    environment: "TEST",
    attemptId: id,
    orderId: id,
    amountMinor: 500,
    currency: "USD",
    externalReference: "fake/payment/one",
    providerLocale: "en",
    fallbackUsed: true,
    status: "REQUIRES_ACTION",
    action: {
      schemaVersion: 1,
      type: "REDIRECT",
      url: "https://payments.example.test/continue/one",
    },
    observedAt: "2026-09-09T00:00:00.000Z",
  },
};

describe("deployed payment provider result boundary", () => {
  it("accepts an exact GET action with the frozen provider locale and rejects changed identity, origin, locale or state", async () => {
    const helpers = await load();
    const lookup = paymentPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "GET_PAYMENT",
      providerAccountId: id,
      environment: "TEST",
      attemptId: id,
      externalReference: response.value.externalReference,
    });
    const value = {
      providerAccountId: response.value.providerAccountId,
      environment: response.value.environment,
      attemptId: response.value.attemptId,
      externalReference: response.value.externalReference,
      providerLocale: response.value.providerLocale,
      fallbackUsed: response.value.fallbackUsed,
      status: response.value.status,
      action: response.value.action,
      observedAt: response.value.observedAt,
    };
    const observed = { ...response, operation: "GET_PAYMENT", value };
    const pinned = { providerLocale: "en", fallbackUsed: true };
    expect(
      helpers?.readPaymentRecoveryAction?.(
        lookup,
        observed,
        binding,
        ["REDIRECT"],
        pinned,
      ),
    ).toEqual(value.action);
    for (const changes of [
      { externalReference: "another/payment" },
      { attemptId: "10000000-0000-4000-8000-000000000002" },
      { providerAccountId: "10000000-0000-4000-8000-000000000002" },
      { environment: "LIVE" },
      { providerLocale: "ja" },
      { fallbackUsed: false },
      {
        action: {
          ...value.action,
          url: "https://payments.example.test.attacker.test/continue",
        },
      },
      { action: { ...value.action, type: "PROVIDER_HOSTED_IFRAME" } },
      {
        status: "PROCESSING",
        action: { schemaVersion: 1, type: "WAIT", pollAfterMs: 1000 },
      },
      { status: "SUCCEEDED", action: undefined },
    ])
      expect(
        helpers?.readPaymentRecoveryAction?.(
          lookup,
          { ...observed, value: { ...value, ...changes } },
          binding,
          ["REDIRECT"],
          pinned,
        ),
      ).toBeNull();
  });
  it("accepts only the original account, financial identity and explicitly mapped hosted language", async () => {
    const helpers = await load();
    expect(
      helpers?.readPaymentCreateResult(command, response, binding, [
        "REDIRECT",
      ]),
    ).toEqual(response.value);
    for (const changes of [
      { amountMinor: 1 },
      { providerLocale: "ja" },
      { fallbackUsed: false },
      { environment: "LIVE" },
      { status: "SUCCEEDED", action: undefined },
    ])
      expect(
        helpers?.readPaymentCreateResult(
          command,
          { ...response, value: { ...response.value, ...changes } },
          binding,
          ["REDIRECT"],
        ),
      ).toBeNull();
  });
  it("rejects redirect spoofing and unsupported hosted action types", async () => {
    const helpers = await load();
    for (const action of [
      {
        schemaVersion: 1,
        type: "REDIRECT",
        url: "https://payments.example.test.attacker.test/continue",
      },
      {
        schemaVersion: 1,
        type: "REDIRECT",
        url: "http://payments.example.test/continue",
      },
      {
        schemaVersion: 1,
        type: "PROVIDER_HOSTED_IFRAME",
        url: "https://payments.example.test/continue",
      },
    ])
      expect(
        helpers?.readPaymentCreateResult(
          command,
          { ...response, value: { ...response.value, action } },
          binding,
          ["REDIRECT"],
        ),
      ).toBeNull();
  });
  it("preserves a valid empty capability response without treating it as a create error", async () => {
    const helpers = await load();
    const caps = paymentPortCommandSchema.parse({
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      providerAccountId: id,
      environment: "TEST",
      market: "US",
      country: "US",
      currency: "USD",
      amountMinor: 500,
      requestedLocale: "ja",
      supportedActionTypes: ["REDIRECT"],
    });
    expect(
      helpers?.readPaymentCapabilities(caps, {
        schemaVersion: 1,
        operation: "GET_CAPABILITIES",
        outcome: "SUCCESS",
        value: { capabilities: [] },
      }),
    ).toEqual([]);
  });
});
