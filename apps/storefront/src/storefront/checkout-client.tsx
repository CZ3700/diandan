"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { createCheckoutController } from "./checkout-controller";
import { CheckoutReview } from "./checkout-review";
import { CheckoutForm } from "./checkout-form";
import {
  CheckoutOrderResult,
  canOpenOrderResult,
} from "./checkout-order-result";
import { PaymentStatus } from "./payment-status";
import { PaymentMethods } from "./payment-methods";
import {
  browserPaymentComponentHost,
  launchPaymentComponent,
} from "./payment-components";
import { shouldPollPayment, startPaymentPolling } from "./payment-polling";
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
  const [launchFailedFor, setLaunchFailedFor] = useState<string | null>(null);
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
  const shouldPoll = shouldPollPayment(
    attempt,
    state.uncertain,
    !invalid && !!sessionId && !!attemptId,
  );
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
    setLaunchFailedFor(null);
    const next = await controller.continuePayment();
    if (!mounted.current || !next) return;
    if (next.type === "REDIRECT") {
      window.location.assign(next.url);
      return;
    }
    // A provider component that cannot load leaves the attempt payable; the fan may retry.
    const launched = await launchPaymentComponent(
      next.action,
      browserPaymentComponentHost(),
    );
    if (!launched && mounted.current)
      setLaunchFailedFor(controller.snapshot().attempt?.id ?? null);
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
  if (canOpenOrderResult(state.checkout, attempt))
    return (
      <CheckoutOrderResult
        checkout={state.checkout!}
        locale={locale}
        copy={copy}
      />
    );
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
            {attempt && launchFailedFor === attempt.id && (
              <p
                className="checkout-error"
                role="alert"
                data-payment-launch-failed
              >
                {copy.checkoutUnavailable}
              </p>
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
                <PaymentMethods
                  capabilities={caps}
                  locale={locale}
                  copy={copy}
                  busy={state.busy}
                  retrying={!!attempt}
                  onCountry={(country) => {
                    void controller.capabilities(country);
                  }}
                  onStart={(capability) => {
                    void submit(() => controller.start(capability));
                  }}
                  onRefresh={() => {
                    void controller.capabilities();
                  }}
                />
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
