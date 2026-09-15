"use client";
import { useEffect, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { OrderSnapshot } from "./order-controller";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
function orderFeedbackMessage(
  error: OrderSnapshot["error"],
  copy: StorefrontCopy,
  locale: SupportedLocale,
  seconds: number,
) {
  switch (error) {
    case "ACCESS_DENIED":
      return copy.orderAccessDenied;
    case "INVALID_LINK":
    case "INVALID_REQUEST":
      return copy.orderLinkInvalid;
    case "PAYMENT_NOT_CONFIRMED":
      return copy.orderPaymentPending;
    case "RATE_LIMITED":
      return formatStorefrontMessage(copy, "orderRateLimited", locale, {
        seconds,
      });
    default:
      return copy.orderUnavailable;
  }
}
export function OrderFeedback({
  state,
  locale,
  copy,
  onRetry,
}: {
  state: OrderSnapshot;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (state.retryAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.retryAt]);
  const seconds =
    state.retryAt === null
      ? 0
      : Math.max(0, Math.ceil((state.retryAt - (now || Date.now())) / 1000));
  const message = orderFeedbackMessage(state.error, copy, locale, seconds);
  return (
    <>
      {state.busy && (
        <p role="status" aria-busy="true" data-order-loading>
          {copy.orderLoading}
        </p>
      )}
      {state.error && (
        <div className="order-feedback" role="alert" data-order-error>
          <p>{message}</p>
          {state.error === "ACCESS_DENIED" && <p>{copy.orderRecoveryHelp}</p>}
          {state.publicOrderId && (
            <button
              type="button"
              className="storefront-secondary"
              disabled={state.busy || seconds > 0}
              data-order-retry
              onClick={onRetry}
            >
              {copy.orderRetry}
            </button>
          )}
        </div>
      )}
      {state.revoked && (
        <p role="status" data-order-revoked>
          {copy.orderRevoked}
        </p>
      )}
    </>
  );
}
