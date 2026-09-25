"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  CheckoutSessionView,
  PaymentRuntimeAttemptView,
  SupportedLocale,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { createOrderController } from "./order-controller";
import { checkoutCalls, createCheckoutTransport } from "./checkout-transport";
import { OrderFeedback } from "./order-feedback";
import { storefrontHref } from "./navigation";
export function canOpenOrderResult(
  checkout: CheckoutSessionView | null,
  attempt: PaymentRuntimeAttemptView | null,
) {
  return (
    checkout !== null &&
    (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
      checkout.paymentStatus,
    ) ||
      attempt?.status === "SUCCEEDED")
  );
}
/** Reads an already authorized order first; only the original paid checkout may grant fresh access. */
export function CheckoutOrderResult({
  checkout,
  locale,
  copy,
}: {
  checkout: CheckoutSessionView;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}) {
  const [controller] = useState(() => createOrderController());
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    let active = true;
    let checkoutTransport = createCheckoutTransport(locale);
    async function initialize() {
      if (!active) return;
      await controller.fromCheckout(checkout.publicOrderId, async (api) => {
        const result = await checkoutTransport.request(
          checkoutCalls.session(checkout.id),
        );
        if (result.outcome !== "SUCCESS" || !("checkout" in result))
          return {
            schemaVersion: 1,
            outcome: "FAILURE",
            code:
              result.outcome === "FAILURE" &&
              ["INVALID_ACCESS", "CART_EXPIRED"].includes(result.code)
                ? "ACCESS_DENIED"
                : "TEMPORARY_UNAVAILABLE",
          };
        if (result.checkout.publicOrderId !== checkout.publicOrderId)
          return {
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "ACCESS_DENIED",
          };
        return checkoutTransport.authorizeOrder(checkout.id, api.bootstrap);
      });
    }
    const hide = () => {
      active = false;
      controller.dispose();
      checkoutTransport.dispose();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        active = true;
        checkoutTransport = createCheckoutTransport(locale);
        void initialize();
      }
    };
    void Promise.resolve().then(initialize);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      hide();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [checkout.id, checkout.publicOrderId, controller, locale]);
  useEffect(() => {
    if (state.order)
      window.location.replace(
        storefrontHref(locale, `/thank-you/${state.order.publicOrderId}`),
      );
  }, [state.order, locale]);
  return (
    <div data-order-result>
      <OrderFeedback
        state={state}
        locale={locale}
        copy={copy}
        onRetry={() => {
          void controller.retry();
        }}
      />
      {state.order && (
        <a
          className="storefront-primary"
          href={storefrontHref(
            locale,
            `/thank-you/${state.order.publicOrderId}`,
          )}
        >
          {copy.orderView}
        </a>
      )}
    </div>
  );
}
