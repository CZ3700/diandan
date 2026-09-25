"use client";
import { useState, useId } from "react";
import type {
  CheckoutPreflightView,
  SupportedLocale,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
export function CheckoutForm({
  preflight,
  locale,
  copy,
  busy,
  email,
  onEmail,
  onConfirm,
}: Readonly<{
  preflight: CheckoutPreflightView;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  busy: boolean;
  email: string;
  onEmail: (value: string) => void;
  onConfirm: () => void;
}>) {
  const id = useId();
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  return (
    <form
      className="checkout-form"
      data-checkout-form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && accepted.size === preflight.policies.length) onConfirm();
      }}
    >
      <label className="checkout-field" htmlFor={`${id}-email`}>
        {copy.checkoutEmail}
        <input
          id={`${id}-email`}
          data-checkout-email
          type="email"
          name="email"
          autoComplete="off"
          inputMode="email"
          required
          maxLength={254}
          value={email}
          disabled={busy}
          aria-describedby={`${id}-email-hint`}
          onChange={(event) => onEmail(event.currentTarget.value)}
        />
      </label>
      <p id={`${id}-email-hint`} className="checkout-hint">
        {copy.checkoutEmailHint}
      </p>
      <div className="checkout-policies">
        {preflight.policies.map((policy) => (
          <div key={policy.policyKey} lang={policy.locale}>
            <label>
              <input
                type="checkbox"
                data-checkout-policy={policy.policyKey}
                required
                disabled={busy}
                checked={accepted.has(policy.policyKey)}
                onChange={(event) => {
                  const next = new Set(accepted);
                  if (event.currentTarget.checked) next.add(policy.policyKey);
                  else next.delete(policy.policyKey);
                  setAccepted(next);
                }}
              />
              <span>
                {formatStorefrontMessage(copy, "checkoutConsent", locale, {
                  policy: policy.title,
                })}
              </span>
            </label>
          </div>
        ))}
      </div>
      <button
        className="storefront-primary"
        type="submit"
        data-checkout-confirm
        disabled={busy || accepted.size !== preflight.policies.length}
      >
        {busy ? copy.checkoutChecking : copy.checkoutConfirm}
      </button>
    </form>
  );
}
