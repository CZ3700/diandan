"use client";
import { useState, useId, type ReactNode } from "react";
import type {
  CheckoutPreflightView,
  SupportedLocale,
} from "@fan-support/contracts";
import { checkoutPolicyAnchor } from "./checkout-review";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
/** Stands in for the linked policy list while the translated sentence is formatted. */
const POLICIES_SLOT = "";
/**
 * One clickwrap sentence for every policy of the preflight. Each title links to its full text
 * in the review; the create command still records each policy key and revision separately.
 */
function ConsentSentence({
  policies,
  locale,
  copy,
}: Readonly<{
  policies: CheckoutPreflightView["policies"];
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const [before = "", after = ""] = formatStorefrontMessage(
    copy,
    "checkoutConsentAll",
    locale,
    { policies: POLICIES_SLOT },
  ).split(POLICIES_SLOT);
  const parts = new Intl.ListFormat(locale, {
    type: "conjunction",
  }).formatToParts(
    policies.map((policy) =>
      formatStorefrontMessage(copy, "checkoutConsentTitle", locale, {
        title: policy.title,
      }),
    ),
  );
  const nodes: ReactNode[] = [];
  let position = 0;
  for (const [index, part] of parts.entries()) {
    const policy = part.type === "element" ? policies[position++] : undefined;
    nodes.push(
      policy ? (
        <a
          key={policy.policyKey}
          href={`#${checkoutPolicyAnchor(policy.policyKey)}`}
          lang={policy.locale}
          data-checkout-policy-link={policy.policyKey}
          onClick={(event) => {
            const target = document.getElementById(
              checkoutPolicyAnchor(policy.policyKey),
            );
            if (target instanceof HTMLDetailsElement) target.open = true;
            // The link reads a policy; it must never toggle the consent it sits in.
            event.stopPropagation();
          }}
        >
          {part.value}
        </a>
      ) : (
        <span key={`literal-${index}`}>{part.value}</span>
      ),
    );
  }
  return (
    <span>
      {before}
      {nodes}
      {after}
    </span>
  );
}
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
      <div className="checkout-policies">
        <label>
          <input
            type="checkbox"
            data-checkout-policy="all"
            required
            disabled={busy}
            checked={accepted}
            onChange={(event) => setAccepted(event.currentTarget.checked)}
          />
          <ConsentSentence
            policies={preflight.policies}
            locale={locale}
            copy={copy}
          />
        </label>
      </div>
      <button
        className="storefront-primary"
        type="submit"
        data-checkout-confirm
        disabled={busy || !accepted}
      >
        {busy ? copy.checkoutChecking : copy.checkoutConfirm}
      </button>
    </form>
  );
}
