import { describe, expect, it } from "vitest";
import {
  checkoutSessionIdSchema,
  providerAccountIdSchema,
} from "@fan-support/contracts";
import { paymentHarness } from "./payment-runtime.harness.js";
import { eligiblePaymentRoute } from "./payment-runtime-capabilities.js";
import {
  paymentTransactions,
  type PaymentRuntime,
} from "./payment-runtime-context.js";
import { createPaymentRuntimeUseCases } from "./payment-runtime.js";

describe("payment runtime consumes deterministic rollout eligibility", () => {
  it("accepts a partial cohort and preserves strict independent threshold boundaries", async () => {
    const h = await paymentHarness();
    const current = h.state().current;
    current.checkout.receipt.checkoutSessionId = checkoutSessionIdSchema.parse(
      "a1000000-0000-4000-8000-000000000001",
    );
    const route = current.routing!.routes[0]!;
    route.rule.providerAccountId = providerAccountIdSchema.parse(
      "a1000000-0000-4000-8000-000000000002",
    );
    route.rule.id = "a1000000-0000-4000-8000-000000000003";
    const runtime: PaymentRuntime = {
      run: paymentTransactions(h.dependencies.transactions),
      keys: h.dependencies.keyManagement,
      configuration: h.dependencies.configuration,
      providers: h.dependencies.providers.map((entry) => ({
        ...entry,
        configuration: {
          ...entry.configuration,
          providerAccountId: route.rule.providerAccountId,
        },
      })),
    };
    for (const [provider, rule, eligible] of [
      [507, 7858, true],
      [506, 7858, false],
      [507, 7857, false],
      [10000, 10000, true],
      [0, 10000, false],
    ] as const) {
      route.providerRolloutBasisPoints = provider;
      route.rolloutBasisPoints = rule;
      expect(
        eligiblePaymentRoute(runtime, current, route, "US", ["REDIRECT"]),
      ).toBe(eligible);
    }
    route.providerRolloutBasisPoints = 507;
    route.rolloutBasisPoints = 7858;
    current.checkout.observation.consent.presentationLocale = "th";
    expect(
      eligiblePaymentRoute(runtime, current, route, "US", ["REDIRECT"]),
    ).toBe(true);
    route.healthStatus = "UNAVAILABLE";
    expect(
      eligiblePaymentRoute(runtime, current, route, "US", ["REDIRECT"]),
    ).toBe(false);
  });
  it("a cohort exclusion prevents capability calls and all provider creation", async () => {
    const h = await paymentHarness();
    h.state().current.routing!.routes[0]!.rolloutBasisPoints = 0;
    const app = createPaymentRuntimeUseCases(h.dependencies);
    expect(await app.create(h.create, h.context)).toMatchObject({
      outcome: "FAILURE",
      code: "CAPABILITY_UNAVAILABLE",
    });
    expect(h.provider.getCapabilities).not.toHaveBeenCalled();
    expect(h.provider.createPayment).not.toHaveBeenCalled();
  });
  it("a permanent create receipt remains replayable after cohort closure", async () => {
    const h = await paymentHarness();
    const app = createPaymentRuntimeUseCases(h.dependencies);
    const first = await app.create(h.create, h.context);
    expect(first).toMatchObject({ outcome: "SUCCESS" });
    h.state().current.routing!.routes[0]!.providerRolloutBasisPoints = 0;
    const second = await app.create(h.create, h.context);
    expect(second).toMatchObject({ action: "REPLAYED" });
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
  });
});
