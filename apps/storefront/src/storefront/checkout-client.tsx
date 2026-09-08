"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { createCheckoutController } from "./checkout-controller";
import { CheckoutReview } from "./checkout-review";
import { CheckoutForm } from "./checkout-form";
import { PaymentStatus } from "./payment-status";
import { startPaymentPolling } from "./payment-polling";
import { storefrontHref } from "./navigation";
import { prepareCheckoutStepFocus } from "./checkout-focus";
function errorText(code: string, copy: StorefrontCopy) {
  if (
    [
      "PREFLIGHT_CHANGED",
      "POLICY_CHANGED",
      "VERSION_CONFLICT",
      "PRICE_CHANGED",
      "STALE_CONFIGURATION",
    ].includes(code)
  )
    return copy.checkoutChanged;
  if (
    [
      "PREFLIGHT_EXPIRED",
      "CHECKOUT_EXPIRED",
      "CART_EXPIRED",
      "RECHECKOUT_REQUIRED",
    ].includes(code)
  )
    return copy.checkoutExpired;
  if (["INVALID_COMMAND", "POLICY_ACCEPTANCE_REQUIRED"].includes(code))
    return copy.checkoutInvalid;
  if (code === "TRANSACTION_OUTCOME_UNKNOWN") return copy.checkoutUnknown;
  return copy.checkoutUnavailable;
}
export function CheckoutClient({
  locale,
  copy,
  locator,
  invalid = false,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  locator?: Readonly<{ session: string; attempt: string }>;
  invalid?: boolean;
}>) {
  const [controller] = useState(() => createCheckoutController(locale));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const [email, setEmail] = useState("");
  const mounted = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<number | null>(null);
  const sessionId = locator?.session,
    attemptId = locator?.attempt;
  useEffect(() => {
    mounted.current = true;
    const initialize = () => {
      if (!invalid)
        void controller.initialize(
          sessionId && attemptId
            ? { session: sessionId, attempt: attemptId }
            : undefined,
        );
    };
    const hide = () => {
      mounted.current = false;
      if (focusFrame.current !== null)
        window.cancelAnimationFrame(focusFrame.current);
      setEmail("");
      controller.dispose();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        mounted.current = true;
        initialize();
      }
    };
    initialize();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      hide();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [controller, invalid, sessionId, attemptId]);
  useEffect(() => {
    if (state.checkout) setEmail("");
  }, [state.checkout]);
  const attempt = state.attempt;
  const shouldPoll =
    !!attempt &&
    !state.uncertain &&
    (attempt.recovery === "EVIDENCE_PENDING" ||
      ["CREATED", "PROCESSING", "UNKNOWN"].includes(attempt.status));
  useEffect(() => {
    if (!shouldPoll) return;
    return startPaymentPolling(
      controller.refresh,
      attempt?.action?.type === "WAIT" ? attempt.action.pollAfterMs : undefined,
    );
  }, [
    controller,
    shouldPoll,
    attempt?.id,
    attempt?.action?.type === "WAIT" ? attempt.action.pollAfterMs : undefined,
  ]);
  const review = state.checkout ?? state.preflight;
  const caps = state.capabilities;
  async function continuePayment() {
    const url = await controller.continuePayment();
    if (mounted.current && url) window.location.assign(url);
  }
  async function submit(operation: () => Promise<void>) {
    const restore = root.current
      ? prepareCheckoutStepFocus(root.current)
      : () => {};
    await operation();
    if (mounted.current) {
      if (focusFrame.current !== null)
        window.cancelAnimationFrame(focusFrame.current);
      focusFrame.current = window.requestAnimationFrame(restore);
    }
  }
  return (
    <div
      className="checkout-content"
      ref={root}
      tabIndex={-1}
      role="group"
      aria-label={copy.checkoutTitle}
      data-checkout-root
      data-checkout-session={state.checkout?.id}
    >
      {(!state.initialized || state.busy) && !invalid && (
        <p className="checkout-progress" role="status" aria-busy="true">
          {copy.checkoutChecking}
        </p>
      )}
      {(invalid || state.error) && (
        <div className="checkout-error" role="alert" data-checkout-error>
          <p>
            {invalid ? copy.checkoutUnavailable : errorText(state.error!, copy)}
          </p>
          {!invalid && (
            <button
              type="button"
              className="storefront-secondary"
              data-checkout-retry
              disabled={state.busy}
              onClick={() => {
                void controller.retry();
              }}
            >
              {state.uncertain ? copy.checkoutRecover : copy.cartRetry}
            </button>
          )}
        </div>
      )}
      {review && (
        <div className="checkout-layout">
          <CheckoutReview review={review} locale={locale} copy={copy} />
          <div className="checkout-workspace">
            {state.preflight && !state.checkout && (
              <CheckoutForm
                key={state.preflight.id}
                preflight={state.preflight}
                locale={locale}
                copy={copy}
                email={email}
                onEmail={setEmail}
                busy={state.busy || state.uncertain}
                onConfirm={() => {
                  void submit(() => controller.confirm(email));
                }}
              />
            )}
            {state.checkout?.expired && (
              <p role="status">{copy.checkoutExpired}</p>
            )}
            {attempt && (
              <PaymentStatus
                attempt={attempt}
                locale={locale}
                copy={copy}
                busy={state.busy || state.uncertain}
                onContinue={() => {
                  void continuePayment();
                }}
                onRecover={() => {
                  void controller.retry();
                }}
                onRefresh={() => {
                  void controller.refresh();
                }}
              />
            )}
            {state.checkout &&
              !state.checkout.expired &&
              (!attempt || attempt.canRetry) &&
              !state.uncertain && (
                <div className="checkout-methods" data-payment-methods>
                  <h2>
                    {attempt ? copy.checkoutRetryPayment : copy.checkoutMethod}
                  </h2>
                  {caps ? (
                    <>
                      <label className="checkout-field">
                        {copy.checkoutCountry}
                        <select
                          data-payment-country
                          value={caps.country ?? ""}
                          disabled={state.busy}
                          onChange={(event) => {
                            if (event.currentTarget.value)
                              void controller.capabilities(
                                event.currentTarget.value,
                              );
                          }}
                        >
                          <option value="">{copy.checkoutChooseCountry}</option>
                          {caps.countries.map((country) => (
                            <option key={country} value={country}>
                              {new Intl.DisplayNames([locale], {
                                type: "region",
                              }).of(country) ?? country}
                            </option>
                          ))}
                        </select>
                      </label>
                      {((caps.country &&
                        caps.capabilities.filter((capability) =>
                          capability.supportedActionTypes.includes("REDIRECT"),
                        ).length === 0) ||
                        caps.countries.length === 0) && (
                        <p>{copy.checkoutNoMethods}</p>
                      )}
                      {caps.capabilities
                        .filter((capability) =>
                          capability.supportedActionTypes.includes("REDIRECT"),
                        )
                        .map((capability) => (
                          <div className="checkout-method" key={capability.id}>
                            {capability.environment === "TEST" && (
                              <p className="checkout-test">
                                {copy.checkoutTest}
                              </p>
                            )}
                            <p>{capability.customerHint}</p>
                            <button
                              className="storefront-primary"
                              type="button"
                              data-payment-create={capability.id}
                              disabled={state.busy}
                              onClick={() => {
                                void submit(() => controller.start(capability));
                              }}
                            >
                              {capability.displayName}
                            </button>
                          </div>
                        ))}
                    </>
                  ) : (
                    !state.busy && (
                      <button
                        type="button"
                        className="storefront-secondary"
                        data-payment-method-refresh
                        onClick={() => {
                          void controller.capabilities();
                        }}
                      >
                        {copy.checkoutRefresh}
                      </button>
                    )
                  )}
                </div>
              )}
          </div>
        </div>
      )}
      {state.initialized && !state.busy && !state.error && !review && (
        <p>{copy.checkoutEmpty}</p>
      )}
      <a
        className="storefront-secondary checkout-back"
        href={storefrontHref(locale, "/cart")}
      >
        {copy.cartViewBag}
      </a>
    </div>
  );
}
