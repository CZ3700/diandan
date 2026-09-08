import type {
  CartRuntimeView,
  CheckoutPreflightView,
  CheckoutSessionView,
  PaymentRuntimeAttemptView,
  PaymentRuntimeCapabilitiesView,
  PaymentRuntimeCapabilityView,
  SupportedLocale,
} from "@fan-support/contracts";
import {
  checkoutCalls,
  createCheckoutTransport,
  type CheckoutCall,
  type CheckoutReply,
  type CheckoutTransport,
} from "./checkout-transport";
export type CheckoutSnapshot = Readonly<{
  busy: boolean;
  initialized: boolean;
  cart: CartRuntimeView | null;
  preflight: CheckoutPreflightView | null;
  checkout: CheckoutSessionView | null;
  attempt: PaymentRuntimeAttemptView | null;
  capabilities: PaymentRuntimeCapabilitiesView | null;
  error: string | null;
  uncertain: boolean;
}>;
const initial = (): CheckoutSnapshot => ({
  busy: false,
  initialized: false,
  cart: null,
  preflight: null,
  checkout: null,
  attempt: null,
  capabilities: null,
  error: null,
  uncertain: false,
});
const uncertain = (reply: CheckoutReply) =>
  reply.outcome === "UNKNOWN" ||
  (reply.outcome === "FAILURE" &&
    ["TRANSACTION_OUTCOME_UNKNOWN", "TEMPORARY_UNAVAILABLE"].includes(
      reply.code,
    ));
/** Coordinates UI requests only. All prices, eligibility and payment decisions remain server facts. */
export function createCheckoutController(
  locale: SupportedLocale,
  transport: CheckoutTransport = createCheckoutTransport(locale),
) {
  let state = initial();
  let epoch = 0;
  let active = true;
  let pending: CheckoutCall | null = null;
  let returnLocator: Readonly<{ session: string; attempt: string }> | undefined;
  const listeners = new Set<() => void>();
  function update(change: Partial<CheckoutSnapshot>) {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  }
  async function run(call: CheckoutCall): Promise<boolean> {
    if (!active || state.busy) return false;
    const version = epoch;
    update({ busy: true, error: null });
    if (call.method === "POST") pending = call;
    let result: CheckoutReply;
    try {
      result = await transport.request(call);
    } catch {
      result = { outcome: "UNKNOWN" };
    }
    if (!active || version !== epoch) return false;
    if (uncertain(result)) {
      update({
        busy: false,
        initialized: true,
        error:
          result.outcome === "FAILURE"
            ? result.code
            : "TRANSACTION_OUTCOME_UNKNOWN",
        uncertain: pending !== null,
      });
      return false;
    }
    if (result.outcome === "FAILURE") {
      pending = null;
      update({
        busy: false,
        initialized: true,
        error: result.code,
        uncertain: false,
        ...([
          "PREFLIGHT_EXPIRED",
          "PREFLIGHT_CHANGED",
          "POLICY_CHANGED",
          "VERSION_CONFLICT",
          "PRICE_CHANGED",
        ].includes(result.code)
          ? { preflight: null }
          : {}),
        ...(["STALE_CONFIGURATION", "CAPABILITY_UNAVAILABLE"].includes(
          result.code,
        )
          ? { capabilities: null }
          : {}),
      });
      return false;
    }
    if (result.outcome !== "SUCCESS") return false;
    if (
      result.action === "CAPABILITIES" &&
      state.checkout &&
      (result.capabilities.amountMinor !==
        state.checkout.amount.totalAmountMinor ||
        result.capabilities.currency !== state.checkout.currency ||
        result.capabilities.market !== state.checkout.market)
    ) {
      update({ busy: false, error: "TEMPORARY_UNAVAILABLE" });
      return false;
    }
    pending = null;
    const common = {
      busy: false,
      initialized: true,
      error: null,
      uncertain: false,
    };
    if (result.action === "CURRENT")
      update({
        ...common,
        checkout: result.checkout,
        attempt: result.attempt,
        preflight: null,
      });
    else if (result.action === "EMPTY")
      update({ ...common, checkout: null, attempt: null });
    else if (result.action === "VALIDATED")
      update({ ...common, preflight: result.preflight });
    else if (result.action === "CAPABILITIES")
      update({ ...common, capabilities: result.capabilities });
    else if ("checkout" in result)
      update({ ...common, checkout: result.checkout, preflight: null });
    else if ("attempt" in result)
      update({
        ...common,
        attempt: result.attempt,
        ...(result.attempt?.canRetry ? {} : { capabilities: null }),
      });
    else if ("cart" in result) update({ ...common, cart: result.cart });
    return true;
  }
  async function capabilities(country?: string) {
    if (
      !state.checkout ||
      state.checkout.expired ||
      (state.attempt && !state.attempt.canRetry) ||
      state.busy ||
      pending
    )
      return;
    update({
      capabilities: state.capabilities
        ? {
            ...state.capabilities,
            country:
              state.capabilities.countries.find((value) => value === country) ??
              state.capabilities.country,
            capabilities: [],
          }
        : null,
    });
    await run(checkoutCalls.capabilities(state.checkout.id, locale, country));
  }
  async function validate(version: number) {
    if (!pending) await run(checkoutCalls.validate(version, locale));
  }
  async function initialize(
    locator?: Readonly<{ session: string; attempt: string }>,
  ) {
    active = true;
    if (pending || state.busy) return;
    if (locator) returnLocator = locator;
    if (returnLocator) {
      if (!(await run(checkoutCalls.session(returnLocator.session)))) return;
      await run(
        checkoutCalls.attempt(returnLocator.session, returnLocator.attempt),
      );
      return;
    }
    if (!(await run(checkoutCalls.current()))) {
      const currentError = state.error;
      if (currentError === "INVALID_ACCESS") {
        const version = epoch;
        await run(checkoutCalls.cart(locale));
        if (!active || version !== epoch) return;
        // Only the cart BFF distinguishes an absent Cookie from invalid access.
        // This read never creates a session or turns other auth failures into emptiness.
        if (state.error === "CART_NOT_FOUND")
          update({ ...initial(), initialized: true });
        else update({ error: currentError });
      }
      return;
    }
    if (state.checkout) {
      await capabilities();
      return;
    }
    if (!(await run(checkoutCalls.cart(locale)))) return;
    if (!state.cart || state.cart.items.length === 0) return;
    if (state.cart.status !== "ACTIVE") {
      update({ error: "SESSION_NOT_READY" });
      return;
    }
    await validate(state.cart.version);
  }
  async function confirm(email: string) {
    if (pending || state.busy || !state.preflight || state.checkout) return;
    if (await run(checkoutCalls.create(state.preflight, email)))
      await capabilities();
  }
  async function start(capability: PaymentRuntimeCapabilityView) {
    if (
      pending ||
      state.busy ||
      !state.checkout ||
      state.checkout.expired ||
      !state.capabilities?.country ||
      (state.attempt && !state.attempt.canRetry) ||
      !state.capabilities.capabilities.some(
        (value) => value.id === capability.id,
      )
    )
      return;
    await run(
      checkoutCalls.start(
        state.checkout.id,
        capability,
        state.capabilities.country,
      ),
    );
  }
  async function refresh() {
    if (!active || pending || state.busy) return;
    if (state.checkout && state.attempt)
      await run(checkoutCalls.attempt(state.checkout.id, state.attempt.id));
    else await initialize();
  }
  async function retry() {
    if (!active || state.busy) return;
    if (pending) {
      const call = pending;
      if (await run(call)) {
        if (state.checkout) await capabilities();
      }
      return;
    }
    if (
      state.checkout &&
      state.attempt &&
      ["CREATE_PENDING", "RECONCILE_REQUIRED"].includes(state.attempt.recovery)
    )
      await run(checkoutCalls.recover(state.checkout.id, state.attempt.id));
    else await initialize();
  }
  async function continuePayment(): Promise<string | null> {
    if (pending || state.busy || !state.checkout || !state.attempt) return null;
    if (
      !(await run(checkoutCalls.attempt(state.checkout.id, state.attempt.id)))
    )
      return null;
    const attempt = state.attempt;
    return attempt?.status === "REQUIRES_ACTION" &&
      attempt.recovery === "NONE" &&
      !attempt.actionExpired &&
      attempt.action?.type === "REDIRECT"
      ? attempt.action.url
      : null;
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize,
    validate,
    confirm,
    capabilities,
    start,
    refresh,
    retry,
    continuePayment,
    dispose() {
      active = false;
      epoch++;
      pending = null;
      transport.dispose();
      state = initial();
      for (const listener of listeners) listener();
    },
  };
}
export type CheckoutController = ReturnType<typeof createCheckoutController>;
