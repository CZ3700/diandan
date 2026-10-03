"use client";
import type {
  PaymentRuntimeCapabilitiesView,
  PaymentRuntimeCapabilityView,
  SupportedLocale,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { isPerformableActionType } from "./payment-components";
export function PaymentMethods({
  capabilities: caps,
  locale,
  copy,
  busy,
  retrying,
  onCountry,
  onStart,
  onRefresh,
}: Readonly<{
  capabilities: PaymentRuntimeCapabilitiesView | null;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  busy: boolean;
  retrying: boolean;
  onCountry: (country: string) => void;
  onStart: (capability: PaymentRuntimeCapabilityView) => void;
  onRefresh: () => void;
}>) {
  const performable =
    caps?.capabilities.filter((capability) =>
      capability.supportedActionTypes.some(isPerformableActionType),
    ) ?? [];
  return (
    <div className="checkout-methods" data-payment-methods>
      <h2>{retrying ? copy.checkoutRetryPayment : copy.checkoutMethod}</h2>
      <p className="checkout-hint">{copy.checkoutPaymentSecurity}</p>
      {caps ? (
        <>
          {/* The server asks only when the country changes which methods apply. */}
          {caps.countrySelectionRequired && (
            <label className="checkout-field">
              {copy.checkoutCountry}
              <select
                data-payment-country
                value={caps.country ?? ""}
                disabled={busy}
                onChange={(event) => {
                  if (event.currentTarget.value)
                    onCountry(event.currentTarget.value);
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
          )}
          {((caps.country && performable.length === 0) ||
            caps.countries.length === 0) && <p>{copy.checkoutNoMethods}</p>}
          {performable.map((capability) => (
            <div className="checkout-method" key={capability.id}>
              {capability.environment === "TEST" && (
                <p className="checkout-test">{copy.checkoutTest}</p>
              )}
              <p>{capability.customerHint}</p>
              <button
                className="storefront-primary"
                type="button"
                data-payment-create={capability.id}
                disabled={busy}
                onClick={() => {
                  onStart(capability);
                }}
              >
                {capability.displayName}
              </button>
            </div>
          ))}
        </>
      ) : (
        !busy && (
          <button
            type="button"
            className="storefront-secondary"
            data-payment-method-refresh
            onClick={onRefresh}
          >
            {copy.checkoutRefresh}
          </button>
        )
      )}
    </div>
  );
}
