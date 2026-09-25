import {
  selectPaymentRouteInputSchema,
  type PaymentProviderHealth,
  type PaymentRouteContext,
  type PaymentRouteDecision,
  type PaymentRouteRule,
} from "@fan-support/contracts";

export type {
  FixedPaymentAttemptRoute,
  PaymentDeviceCapability,
  PaymentProviderHealth,
  PaymentRouteContext,
  PaymentRouteDecision,
  PaymentRouteRule,
  PublishedPaymentRouteRuleSet,
  SelectPaymentRouteInput,
} from "@fan-support/contracts";

function compareAscii(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function healthByProvider(
  healthEntries: readonly PaymentProviderHealth[],
): ReadonlyMap<string, PaymentProviderHealth["status"]> {
  const result = new Map<string, PaymentProviderHealth["status"]>();
  for (const entry of healthEntries) {
    const key = String(entry.providerAccountId).toLowerCase();
    const previous = result.get(key);
    result.set(
      key,
      previous === "UNAVAILABLE" || entry.status === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : "HEALTHY",
    );
  }
  return result;
}

function includesValue(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function isEligible(
  rule: PaymentRouteRule,
  context: PaymentRouteContext,
  providerHealth: ReadonlyMap<string, PaymentProviderHealth["status"]>,
): boolean {
  const deviceCapabilities = new Set(context.deviceCapabilities);
  return (
    rule.enabled &&
    providerHealth.get(String(rule.providerAccountId).toLowerCase()) ===
      "HEALTHY" &&
    includesValue(rule.countries, context.country) &&
    includesValue(rule.markets, context.market) &&
    includesValue(rule.currencies, context.currency) &&
    context.amountMinor >= rule.minimumAmountMinor &&
    context.amountMinor <= rule.maximumAmountMinor &&
    rule.requiredDeviceCapabilities.every((capability) =>
      deviceCapabilities.has(capability),
    )
  );
}

function compareCandidates(
  left: PaymentRouteRule,
  right: PaymentRouteRule,
): number {
  if (left.priority > right.priority) {
    return -1;
  }
  if (left.priority < right.priority) {
    return 1;
  }

  return (
    compareAscii(left.id, right.id) ||
    compareAscii(
      String(left.providerAccountId).toLowerCase(),
      String(right.providerAccountId).toLowerCase(),
    ) ||
    compareAscii(left.paymentMethod, right.paymentMethod)
  );
}

export function selectPaymentRoute(input: unknown): PaymentRouteDecision {
  const parsed = selectPaymentRouteInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      schemaVersion: 1,
      kind: "UNAVAILABLE",
      reason: "INVALID_ROUTING_INPUT",
    };
  }
  const value = parsed.data;
  if (value.fixedAttempt !== undefined) {
    return {
      schemaVersion: 1,
      kind: "PINNED",
      attemptStatus: value.fixedAttempt.status,
      route: {
        schemaVersion: 1,
        ruleVersion: value.fixedAttempt.ruleVersion,
        providerAccountId: value.fixedAttempt.providerAccountId,
        paymentMethod: value.fixedAttempt.paymentMethod,
      },
    };
  }

  const providerHealth = healthByProvider(value.providerHealth);
  const selected = value.publishedRuleSet.rules
    .filter((rule) => isEligible(rule, value.context, providerHealth))
    .toSorted(compareCandidates)[0];

  if (selected === undefined) {
    return {
      schemaVersion: 1,
      kind: "UNAVAILABLE",
      reason: "NO_ELIGIBLE_ROUTE",
    };
  }

  return {
    schemaVersion: 1,
    kind: "SELECTED",
    route: {
      schemaVersion: 1,
      ruleId: selected.id,
      ruleVersion: value.publishedRuleSet.ruleVersion,
      providerAccountId: selected.providerAccountId,
      paymentMethod: selected.paymentMethod,
    },
  };
}
