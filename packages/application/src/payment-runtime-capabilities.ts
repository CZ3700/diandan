import {
  paymentPortCommandSchema,
  paymentRuntimeContextSchema,
  paymentRuntimeCapabilitiesViewSchema,
  type CartRuntimeRequestContext,
  type PaymentRuntimeCapabilitiesCommand,
  type PaymentRuntimeContext,
  type PaymentRuntimeRoute,
  type PaymentRuntimeCapabilityView,
  type PaymentDeviceCapability,
} from "@fan-support/contracts";
import {
  evaluatePaymentRollout,
  selectPaymentRoute,
} from "@fan-support/domain";
import {
  findPaymentProvider,
  readPaymentCapabilities,
} from "./payment-runtime-provider.js";
import {
  rejectPayment,
  type PaymentRuntime,
} from "./payment-runtime-context.js";
import { observePaymentProvider } from "./payment-runtime-health.js";

export async function loadPaymentContext(
  runtime: PaymentRuntime,
  command: PaymentRuntimeCapabilitiesCommand,
  context: CartRuntimeRequestContext,
) {
  const value = await runtime.run(({ paymentRuntime }) =>
    paymentRuntime.loadContext({
      schemaVersion: 1,
      accesses: context.accesses,
      checkoutSessionId: command.checkoutSessionId,
      presentationLocale: command.presentationLocale,
      country: command.country ?? null,
      supportedActionTypes: command.supportedActionTypes,
    }),
  );
  const current = paymentRuntimeContextSchema.parse(value);
  if (
    current.checkout.receipt.checkoutSessionId.toLowerCase() !==
      command.checkoutSessionId.toLowerCase() ||
    current.cart.market !== current.checkout.observation.consent.market ||
    current.cart.currency !== current.checkout.observation.consent.currency
  )
    return rejectPayment("INVALID_ACCESS");
  return current;
}
export function eligiblePaymentRoute(
  runtime: PaymentRuntime,
  current: PaymentRuntimeContext,
  route: PaymentRuntimeRoute,
  country: string,
  supportedActionTypes: readonly PaymentDeviceCapability[],
) {
  if (
    !route.providerEnabled ||
    !["ACTIVE", "INTERNAL"].includes(route.accountStatus) ||
    route.merchantStatus !== "ACTIVE" ||
    evaluatePaymentRollout({
      schemaVersion: 1,
      checkoutSessionId: current.checkout.receipt.checkoutSessionId,
      providerAccountId: route.rule.providerAccountId,
      routeRuleId: route.rule.id,
      providerRolloutBasisPoints: route.providerRolloutBasisPoints,
      ruleRolloutBasisPoints: route.rolloutBasisPoints,
    }).kind !== "ELIGIBLE" ||
    (route.accountStatus === "INTERNAL" && route.environment !== "TEST")
  )
    return false;
  if (
    !findPaymentProvider(runtime.providers, {
      providerAccountId: route.rule.providerAccountId,
      environment: route.environment,
      adapterKey: route.adapterKey,
    })
  )
    return false;
  return (
    selectPaymentRoute({
      schemaVersion: 1,
      context: {
        schemaVersion: 1,
        country,
        market: current.cart.market,
        currency: current.cart.currency,
        amountMinor: current.checkout.observation.quote.amount.totalAmountMinor,
        deviceCapabilities: supportedActionTypes,
      },
      publishedRuleSet: {
        schemaVersion: 1,
        status: "PUBLISHED",
        ruleVersion: route.ruleVersion,
        rules: [route.rule],
      },
      providerHealth: [
        {
          schemaVersion: 1,
          providerAccountId: route.rule.providerAccountId,
          status: route.healthStatus,
        },
      ],
    }).kind === "SELECTED"
  );
}
export async function availablePaymentActions(
  runtime: PaymentRuntime,
  current: PaymentRuntimeContext,
  route: PaymentRuntimeRoute,
  country: string,
  supportedActionTypes: readonly PaymentDeviceCapability[],
) {
  const provider = findPaymentProvider(runtime.providers, {
    providerAccountId: route.rule.providerAccountId,
    environment: route.environment,
    adapterKey: route.adapterKey,
  });
  if (!provider) return [];
  const command = paymentPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "GET_CAPABILITIES",
    providerAccountId: route.rule.providerAccountId,
    environment: route.environment,
    market: current.cart.market,
    country,
    currency: current.cart.currency,
    amountMinor: current.checkout.observation.quote.amount.totalAmountMinor,
    requestedLocale: current.checkout.observation.consent.presentationLocale,
    supportedActionTypes,
  });
  if (command.operation !== "GET_CAPABILITIES") return [];
  try {
    if (runtime.health && !(await runtime.health.initialize(command)))
      return [];
    const observed = await observePaymentProvider(
      runtime.health,
      command,
      () => provider.provider.getCapabilities(command),
      {
        schemaVersion: 1,
        routeId: route.rule.id,
        configVersion: current.routing!.configVersion,
        ruleVersion: route.ruleVersion,
        command,
      },
    );
    if (!observed.healthAvailable) return [];
    const capabilities = readPaymentCapabilities(command, observed.response);
    return [
      ...new Set(
        (capabilities ?? [])
          .filter(
            (entry) =>
              entry.available &&
              entry.paymentMethod === route.rule.paymentMethod &&
              entry.minimumAmountMinor <= command.amountMinor &&
              entry.maximumAmountMinor >= command.amountMinor,
          )
          .flatMap((entry) =>
            entry.actionTypes.filter(
              (type): type is PaymentDeviceCapability =>
                type !== "WAIT" && supportedActionTypes.includes(type),
            ),
          ),
      ),
    ];
  } catch {
    return [];
  }
}
export async function listPaymentCapabilities(
  runtime: PaymentRuntime,
  command: PaymentRuntimeCapabilitiesCommand,
  context: CartRuntimeRequestContext,
) {
  const current = await loadPaymentContext(runtime, command, context);
  if (current.readiness !== "READY") return rejectPayment(current.readiness);
  const routes = current.routing?.routes ?? [];
  // The fan is asked for a country only when the answer changes which routes apply.
  const routesByCountry = new Map<string, string>();
  for (const country of new Set(
    routes.flatMap((route) => route.rule.countries),
  )) {
    const eligible = routes
      .filter((route) =>
        eligiblePaymentRoute(
          runtime,
          current,
          route,
          country,
          command.supportedActionTypes,
        ),
      )
      .map((route) => route.rule.id.toLowerCase());
    if (eligible.length > 0) routesByCountry.set(country, eligible.join(","));
  }
  const countries = [...routesByCountry.keys()].sort();
  const countrySelectionRequired = new Set(routesByCountry.values()).size > 1;
  if (command.country !== undefined && !countries.includes(command.country))
    return rejectPayment("CAPABILITY_UNAVAILABLE");
  const country =
    command.country ?? (countrySelectionRequired ? undefined : countries[0]);
  const capabilities: PaymentRuntimeCapabilityView[] = [];
  if (
    country !== undefined &&
    (!current.currentAttempt || current.currentAttempt.canRetry)
  ) {
    const ordered = routes
      .filter((route) =>
        eligiblePaymentRoute(
          runtime,
          current,
          route,
          country,
          command.supportedActionTypes,
        ),
      )
      .toSorted(
        (a, b) =>
          a.displayOrder - b.displayOrder ||
          b.rule.priority - a.rule.priority ||
          a.rule.id.localeCompare(b.rule.id, "en"),
      );
    for (const route of ordered) {
      const actions = await availablePaymentActions(
        runtime,
        current,
        route,
        country,
        command.supportedActionTypes,
      );
      if (
        actions.length === 0 ||
        route.displayLocale !== command.presentationLocale
      )
        continue;
      capabilities.push({
        schemaVersion: 1,
        id: route.rule.id as PaymentRuntimeCapabilityView["id"],
        paymentMethod: route.rule.paymentMethod,
        displayName: route.displayName,
        customerHint: route.customerHint,
        environment: route.environment,
        configVersion: current.routing!.configVersion,
        ruleVersion: route.ruleVersion,
        supportedActionTypes: actions,
      });
    }
  }
  return paymentRuntimeCapabilitiesViewSchema.parse({
    schemaVersion: 1,
    checkoutSessionId: command.checkoutSessionId,
    presentationLocale: command.presentationLocale,
    market: current.cart.market,
    currency: current.cart.currency,
    amountMinor: current.checkout.observation.quote.amount.totalAmountMinor,
    countries,
    country: country ?? null,
    countrySelectionRequired,
    capabilities,
  });
}
