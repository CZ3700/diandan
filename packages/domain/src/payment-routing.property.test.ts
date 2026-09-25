import { expect, test } from "vitest";
import fc from "fast-check";

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
import { PROPERTY_PARAMETERS } from "./test-support/property-parameters.js";

const providers = [
  providerAccountIdSchema.parse("00000000-0000-4000-8000-0000000000a1"),
  providerAccountIdSchema.parse("00000000-0000-4000-8000-0000000000b2"),
  providerAccountIdSchema.parse("00000000-0000-4000-8000-0000000000c3"),
] as const;

function routingInput(priorities: readonly number[]): SelectPaymentRouteInput {
  const rules: PaymentRouteRule[] = priorities.map((priority, index) => ({
    schemaVersion: 1,
    id: `route-${String(index)}`,
    providerAccountId: providers[index]!,
    paymentMethod: "card",
    enabled: true,
    countries: [countrySchema.parse("US")],
    markets: [marketSchema.parse("AMERICAS")],
    currencies: [currencySchema.parse("USD")],
    minimumAmountMinor: minorAmountSchema.parse(0),
    maximumAmountMinor: minorAmountSchema.parse(100_000),
    requiredDeviceCapabilities: ["REDIRECT"],
    priority,
  }));
  return {
    schemaVersion: 1,
    context: {
      schemaVersion: 1,
      country: countrySchema.parse("US"),
      market: marketSchema.parse("AMERICAS"),
      currency: currencySchema.parse("USD"),
      amountMinor: minorAmountSchema.parse(500),
      deviceCapabilities: ["REDIRECT"],
    },
    publishedRuleSet: {
      schemaVersion: 1,
      status: "PUBLISHED",
      ruleVersion: 11,
      rules,
    },
    providerHealth: providers.map((providerAccountId) => ({
      schemaVersion: 1 as const,
      providerAccountId,
      status: "HEALTHY" as const,
    })),
  };
}

test("routing is deterministic and order-independent without locale as an input", () => {
  fc.assert(
    fc.property(
      fc.tuple(fc.integer(), fc.integer(), fc.integer()),
      fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }),
      (priorities, order) => {
        const original = routingInput(priorities);
        const reordered: SelectPaymentRouteInput = {
          ...original,
          publishedRuleSet: {
            ...original.publishedRuleSet,
            rules: order.map(
              (index) => original.publishedRuleSet.rules[index]!,
            ),
          },
          providerHealth: [...original.providerHealth].reverse(),
        };
        expect(selectPaymentRoute(original)).toEqual(
          selectPaymentRoute(reordered),
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});
