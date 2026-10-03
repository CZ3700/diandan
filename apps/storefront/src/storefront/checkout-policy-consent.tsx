"use client";

import type { ReactNode } from "react";
import type {
  CheckoutPreflightView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Dialog } from "@fan-support/ui/interactions";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { PolicyBody } from "./gift-content";

/** Keeps the policy list in the sentence's locale-defined position. */
const POLICIES_SLOT = "";

/** Reading uses this preflight's exact policy text; consent remains a separate action. */
export function CheckoutPolicyConsent({
  policies,
  locale,
  copy,
  inputId,
  accepted,
  busy,
  onChange,
}: Readonly<{
  policies: CheckoutPreflightView["policies"];
  locale: SupportedLocale;
  copy: StorefrontCopy;
  inputId: string;
  accepted: boolean;
  busy: boolean;
  onChange: (accepted: boolean) => void;
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
        <span
          key={`${policy.policyKey}:${policy.policyRevisionId}`}
          className="checkout-policy-link"
          lang={policy.locale}
          data-checkout-policy-link={policy.policyKey}
        >
          <Dialog
            triggerLabel={part.value}
            title={<span lang={policy.locale}>{policy.title}</span>}
            description={copy.giftPolicies}
            closeLabel={copy.close}
            initialFocus="popup"
          >
            <div
              lang={policy.locale}
              data-checkout-policy-body={policy.policyKey}
            >
              <PolicyBody body={policy.body} />
            </div>
          </Dialog>
        </span>
      ) : (
        <label key={`literal-${index}`} htmlFor={inputId}>
          {part.value}
        </label>
      ),
    );
  }
  return (
    <div className="checkout-consent">
      <label className="checkout-consent-toggle" htmlFor={inputId}>
        <input
          id={inputId}
          type="checkbox"
          data-checkout-policy="all"
          aria-labelledby={`${inputId}-label`}
          required
          disabled={busy}
          checked={accepted}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      </label>
      <span id={`${inputId}-label`} className="checkout-consent-text">
        <label htmlFor={inputId}>{before}</label>
        {nodes}
        <label htmlFor={inputId}>{after}</label>
      </span>
    </div>
  );
}
