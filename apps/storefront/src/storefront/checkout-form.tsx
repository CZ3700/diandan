"use client";
import { useState, useId } from "react";
import type {
  CheckoutPreflightView,
  SupportedLocale,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { CheckoutPolicyConsent } from "./checkout-policy-consent";
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
  const [accepted, setAccepted] = useState(false);
  return (
    <form
      className="checkout-form"
      data-checkout-form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && accepted) onConfirm();
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
      <CheckoutPolicyConsent
        policies={preflight.policies}
        locale={locale}
        copy={copy}
        inputId={`${id}-consent`}
        accepted={accepted}
        busy={busy}
        onChange={setAccepted}
      />
      <button
        className="storefront-primary"
        type="submit"
        data-checkout-confirm
        disabled={busy || !accepted}
      >
        {busy ? copy.checkoutChecking : copy.checkoutPay}
      </button>
    </form>
  );
}
