import {
  AIRWALLEX_HPP_COMPONENT_KEY,
  decodeAirwallexHppClientToken,
} from "@fan-support/contracts";

import {
  AIRWALLEX_SDK_URL,
  type PaymentComponentHost,
} from "./payment-components";

type Launcher = (
  clientToken: string,
  host: PaymentComponentHost,
) => Promise<boolean>;

/**
 * The fan leaves for the Hosted Payment Page; the payment intent's server-side return URL
 * brings them back. Card and card wallets only, matching the CARD capability offered.
 */
const launchAirwallexHostedPage: Launcher = async (clientToken, host) => {
  const launch = decodeAirwallexHppClientToken(clientToken);
  if (!launch || new URL(launch.cancelUrl).origin !== host.origin) return false;
  if (!host.airwallex()) await host.loadScript(AIRWALLEX_SDK_URL);
  const sdk = host.airwallex();
  if (!sdk) return false;
  const initialized = await sdk.init({
    env: launch.env,
    enabledElements: ["payments"],
  });
  const payments = initialized?.payments;
  if (!payments) return false;
  payments.redirectToCheckout({
    env: launch.env,
    mode: "payment",
    intent_id: launch.intentId,
    client_secret: launch.clientSecret,
    currency: launch.currency,
    locale: launch.locale,
    cancelUrl: launch.cancelUrl,
    methods: ["card", "applepay", "googlepay"],
  });
  return true;
};

/** Loaded only when a fan continues into a component, so token parsing stays off first paint. */
export const launchers: Readonly<Record<string, Launcher>> = Object.freeze({
  [AIRWALLEX_HPP_COMPONENT_KEY]: launchAirwallexHostedPage,
});
