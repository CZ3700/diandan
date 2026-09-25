import { expect, test } from "vitest";

import {
  countrySchema,
  currencySchema,
  marketSchema,
  minorAmountSchema,
  providerAccountIdSchema,
} from "@fan-support/contracts";

import {
  selectPaymentRoute,
  type PaymentRouteRule,
  type SelectPaymentRouteInput,
} from "./payment-routing.js";

import { paymentRouteDecisionSchema } from "@fan-support/contracts";

const providerA = providerAccountIdSchema.parse(
  "00000000-0000-4000-8000-0000000000a1",
);
const providerB = providerAccountIdSchema.parse(
  "00000000-0000-4000-8000-0000000000b2",
);

function rule(overrides: Partial<PaymentRouteRule> = {}): PaymentRouteRule {
  return {
    schemaVersion: 1,
    id: "route-primary",
    providerAccountId: providerA,
    paymentMethod: "card",
    enabled: true,
    countries: [countrySchema.parse("US")],
    markets: [marketSchema.parse("AMERICAS")],
    currencies: [currencySchema.parse("USD")],
    minimumAmountMinor: minorAmountSchema.parse(100),
    maximumAmountMinor: minorAmountSchema.parse(100_000),
    requiredDeviceCapabilities: ["REDIRECT"],
    priority: 100,
    ...overrides,
  };
}

function input(rules: PaymentRouteRule[]): SelectPaymentRouteInput {
  return {
    schemaVersion: 1,
    context: {
      schemaVersion: 1,
      country: countrySchema.parse("US"),
      market: marketSchema.parse("AMERICAS"),
      currency: currencySchema.parse("USD"),
      amountMinor: minorAmountSchema.parse(5_000),
      deviceCapabilities: ["REDIRECT"],
    },
    publishedRuleSet: {
      schemaVersion: 1,
      status: "PUBLISHED",
      ruleVersion: 7,
      rules,
    },
    providerHealth: [
      { schemaVersion: 1, providerAccountId: providerA, status: "HEALTHY" },
      { schemaVersion: 1, providerAccountId: providerB, status: "HEALTHY" },
    ],
  };
}

test("selects an eligible healthy route with an explicit stable tie-break", () => {
  const decision = selectPaymentRoute(
    input([
      rule({ id: "route-z", providerAccountId: providerB }),
      rule({ id: "route-a", providerAccountId: providerA }),
    ]),
  );

  expect(decision).toEqual({
    schemaVersion: 1,
    kind: "SELECTED",
    route: {
      schemaVersion: 1,
      ruleId: "route-a",
      ruleVersion: 7,
      providerAccountId: providerA,
      paymentMethod: "card",
    },
  });
});

test("uses provider and method as stable fallbacks when rule ids collide", () => {
  const decision = selectPaymentRoute(
    input([
      rule({ id: "duplicate", providerAccountId: providerB }),
      rule({
        id: "duplicate",
        providerAccountId: providerA,
        paymentMethod: "wallet",
      }),
      rule({
        id: "duplicate",
        providerAccountId: providerA,
        paymentMethod: "bank",
      }),
    ]),
  );

  expect(decision).toMatchObject({
    kind: "SELECTED",
    route: {
      ruleId: "duplicate",
      providerAccountId: providerA,
      paymentMethod: "bank",
    },
  });
});

test("orders the full safe-integer priority range without subtraction overflow", () => {
  const decision = selectPaymentRoute(
    input([
      rule({
        id: "lowest-priority",
        providerAccountId: providerB,
        priority: Number.MIN_SAFE_INTEGER,
      }),
      rule({
        id: "highest-priority",
        providerAccountId: providerA,
        priority: Number.MAX_SAFE_INTEGER,
      }),
    ]),
  );

  expect(decision).toMatchObject({
    kind: "SELECTED",
    route: { ruleId: "highest-priority", providerAccountId: providerA },
  });
});

test("keeps a fixed UNKNOWN attempt pinned even when another route is healthy", () => {
  const request: SelectPaymentRouteInput = {
    ...input([rule({ providerAccountId: providerB })]),
    providerHealth: [
      { schemaVersion: 1, providerAccountId: providerA, status: "UNAVAILABLE" },
      { schemaVersion: 1, providerAccountId: providerB, status: "HEALTHY" },
    ],
    fixedAttempt: {
      schemaVersion: 1,
      status: "UNKNOWN",
      providerAccountId: providerA,
      paymentMethod: "card",
      ruleVersion: 4,
    },
  };

  expect(selectPaymentRoute(request)).toMatchObject({
    kind: "PINNED",
    attemptStatus: "UNKNOWN",
    route: { providerAccountId: providerA, ruleVersion: 4 },
  });
});

test("fails closed when country, market, currency, amount, device, or health is ineligible", () => {
  const cases = [
    rule({ countries: [countrySchema.parse("CA")] }),
    rule({ markets: [marketSchema.parse("EUROPE")] }),
    rule({ currencies: [currencySchema.parse("CAD")] }),
    rule({ minimumAmountMinor: minorAmountSchema.parse(5_001) }),
    rule({ maximumAmountMinor: minorAmountSchema.parse(4_999) }),
    rule({ requiredDeviceCapabilities: ["QR_CODE"] }),
    rule({ enabled: false }),
  ];

  for (const candidate of cases) {
    expect(selectPaymentRoute(input([candidate]))).toEqual({
      schemaVersion: 1,
      kind: "UNAVAILABLE",
      reason: "NO_ELIGIBLE_ROUTE",
    });
  }

  const unhealthy: SelectPaymentRouteInput = {
    ...input([rule()]),
    providerHealth: [
      { schemaVersion: 1, providerAccountId: providerA, status: "UNAVAILABLE" },
      { schemaVersion: 1, providerAccountId: providerA, status: "HEALTHY" },
    ],
  };
  expect(selectPaymentRoute(unhealthy).kind).toBe("UNAVAILABLE");
});

test("strictly validates the complete routing command and its decision", () => {
  const invalidInputs: unknown[] = [
    { ...input([rule()]), locale: "en" },
    { ...input([rule()]), schemaVersion: 2 },
    input([rule({ priority: Number.POSITIVE_INFINITY })]),
    {
      ...input([rule()]),
      fixedAttempt: {
        schemaVersion: 1,
        status: "SUCCEEDED",
        providerAccountId: providerA,
        paymentMethod: "card",
        ruleVersion: 4,
      },
    },
  ];

  for (const candidate of invalidInputs) {
    const decision = selectPaymentRoute(candidate);
    expect(decision).toEqual({
      schemaVersion: 1,
      kind: "UNAVAILABLE",
      reason: "INVALID_ROUTING_INPUT",
    });
    expect(paymentRouteDecisionSchema.safeParse(decision).success).toBe(true);
  }
});
