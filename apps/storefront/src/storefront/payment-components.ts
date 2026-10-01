import type { PaymentAction } from "@fan-support/contracts";

export type ProviderComponentAction = Extract<
  PaymentAction,
  { type: "PROVIDER_COMPONENT" }
>;

/** Payment actions this storefront release can perform; capabilities are requested for these only. */
export const PERFORMABLE_ACTION_TYPES = Object.freeze([
  "REDIRECT",
  "PROVIDER_COMPONENT",
] as const);

export function isPerformableActionType(type: string): boolean {
  return (PERFORMABLE_ACTION_TYPES as readonly string[]).includes(type);
}

/** Component keys with a launcher in payment-component-launchers; kept in step by tests. */
export const LAUNCHABLE_COMPONENT_KEYS: ReadonlySet<string> = new Set([
  "airwallex-hpp",
]);

export function canLaunchPaymentComponent(
  action: ProviderComponentAction,
): boolean {
  return LAUNCHABLE_COMPONENT_KEYS.has(action.componentKey);
}

/**
 * The official Airwallex.js loader. It loads the payments bundle from the Hosted Payment Page
 * origin; a Content-Security-Policy for checkout must allow both origins (R1-6).
 */
export const AIRWALLEX_SDK_URL =
  "https://static.airwallex.com/components/sdk/v1/index.js";

type AirwallexPayments = Readonly<{
  redirectToCheckout(options: Readonly<Record<string, unknown>>): unknown;
}>;
export type AirwallexSdk = Readonly<{
  init(
    options: Readonly<{
      env: "sandbox" | "prod";
      enabledElements: readonly string[];
    }>,
  ): Promise<Readonly<{ payments?: AirwallexPayments }> | undefined>;
}>;

export type PaymentComponentHost = Readonly<{
  origin: string;
  /** A departed page or superseded pay action must not launch after SDK work completes. */
  isCurrent?: () => boolean;
  /** Resolves once the script has executed; rejects when it cannot load in time. */
  loadScript(url: string): Promise<void>;
  airwallex(): AirwallexSdk | undefined;
}>;

/** False means nothing was launched and the fan is still on the checkout page. */
export async function launchPaymentComponent(
  action: ProviderComponentAction,
  host: PaymentComponentHost,
): Promise<boolean> {
  if (host.isCurrent?.() === false || !canLaunchPaymentComponent(action))
    return false;
  try {
    const { launchers } = await import("./payment-component-launchers");
    if (host.isCurrent?.() === false) return false;
    const launcher = Object.hasOwn(launchers, action.componentKey)
      ? launchers[action.componentKey]
      : undefined;
    return launcher ? await launcher(action.clientToken, host) : false;
  } catch {
    return false;
  }
}

const SCRIPT_TIMEOUT_MS = 15_000;
const scripts = new Map<string, Promise<void>>();

export function browserPaymentComponentHost(
  isCurrent: () => boolean = () => true,
): PaymentComponentHost {
  return {
    origin: window.location.origin,
    isCurrent,
    loadScript(url) {
      let loading = scripts.get(url);
      if (!loading) {
        loading = new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          // Only ever called after `timer` below is assigned.
          const fail = () => {
            window.clearTimeout(timer);
            script.remove();
            scripts.delete(url);
            reject(new Error("PAYMENT_COMPONENT_UNAVAILABLE"));
          };
          const timer = window.setTimeout(fail, SCRIPT_TIMEOUT_MS);
          script.src = url;
          script.async = true;
          script.referrerPolicy = "no-referrer";
          script.addEventListener("load", () => {
            window.clearTimeout(timer);
            resolve();
          });
          script.addEventListener("error", fail);
          document.head.append(script);
        });
        scripts.set(url, loading);
      }
      return loading;
    },
    airwallex: () =>
      (window as unknown as { AirwallexComponentsSDK?: AirwallexSdk })
        .AirwallexComponentsSDK,
  };
}
