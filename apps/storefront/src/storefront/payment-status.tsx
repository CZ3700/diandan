"use client";
import type {
  PaymentRuntimeAttemptView,
  SupportedLocale,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { canLaunchPaymentComponent } from "./payment-components";
/** The provider's BCP 47 tag named in the fan's language; the raw tag only if the runtime cannot name it. */
function languageName(locale: SupportedLocale, tag: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
function statusMessage(
  attempt: PaymentRuntimeAttemptView,
  copy: StorefrontCopy,
) {
  if (attempt.recovery === "EVIDENCE_PENDING" || attempt.status === "SUCCEEDED")
    return copy.checkoutProcessing;
  if (attempt.status === "UNKNOWN") return copy.checkoutUnknown;
  if (attempt.actionExpired) return copy.checkoutActionExpired;
  if (["FAILED", "CANCELED", "EXPIRED"].includes(attempt.status))
    return copy.checkoutFailed;
  if (attempt.status === "REQUIRES_ACTION") return copy.checkoutReady;
  return copy.checkoutWaiting;
}
export function PaymentStatus({
  attempt,
  locale,
  copy,
  busy,
  onRecover,
  onRefresh,
  onContinue,
}: Readonly<{
  attempt: PaymentRuntimeAttemptView;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  busy: boolean;
  onRecover: () => void;
  onRefresh: () => void;
  onContinue: () => void;
}>) {
  const message = statusMessage(attempt, copy);
  const action = attempt.action;
  const canContinue =
    attempt.status === "REQUIRES_ACTION" &&
    attempt.recovery === "NONE" &&
    !attempt.actionExpired &&
    (action?.type === "REDIRECT" ||
      (action?.type === "PROVIDER_COMPONENT" &&
        canLaunchPaymentComponent(action)));
  return (
    <div
      className="payment-status"
      data-payment-state={attempt.status}
      data-payment-recovery={attempt.recovery}
    >
      {attempt.environment === "TEST" && (
        <p className="checkout-test" data-payment-test>
          {copy.checkoutTest}
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {attempt.providerLocaleFallbackUsed && (
        <p className="checkout-hint">
          {formatStorefrontMessage(copy, "checkoutLanguageFallback", locale, {
            language: languageName(locale, attempt.providerLocale),
          })}
        </p>
      )}
      <div className="checkout-actions">
        {canContinue && (
          <button
            className="storefront-primary"
            type="button"
            data-payment-continue
            disabled={busy}
            onClick={onContinue}
          >
            {copy.checkoutPay}
          </button>
        )}
        {["CREATE_PENDING", "RECONCILE_REQUIRED"].includes(
          attempt.recovery,
        ) && (
          <button
            className="storefront-primary"
            type="button"
            data-payment-recover
            disabled={busy}
            onClick={onRecover}
          >
            {attempt.status === "REQUIRES_ACTION" && attempt.actionExpired
              ? copy.checkoutResumePayment
              : copy.checkoutRecover}
          </button>
        )}
        <button
          className="storefront-secondary"
          type="button"
          data-payment-refresh
          disabled={busy}
          onClick={onRefresh}
        >
          {copy.checkoutRefresh}
        </button>
      </div>
    </div>
  );
}
