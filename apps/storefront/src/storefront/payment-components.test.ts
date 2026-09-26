import {
  AIRWALLEX_HPP_COMPONENT_KEY,
  encodeAirwallexHppClientToken,
} from "@fan-support/contracts";
import { afterEach, expect, it, vi } from "vitest";

import { launchers } from "./payment-component-launchers";
import {
  AIRWALLEX_SDK_URL,
  LAUNCHABLE_COMPONENT_KEYS,
  PERFORMABLE_ACTION_TYPES,
  browserPaymentComponentHost,
  canLaunchPaymentComponent,
  isPerformableActionType,
  launchPaymentComponent,
} from "./payment-components";

const origin = "https://shop.example.com";
const launch = {
  v: 1,
  env: "sandbox",
  intentId: "int_hkpdskz7vg1xc7uscdj",
  clientSecret: "fixture.client.secret-0001",
  currency: "USD",
  locale: "zh",
  cancelUrl: `${origin}/zh-CN/checkout/return?session=60000000-0000-4000-8000-000000000006&attempt=20000000-0000-4000-8000-000000000002`,
} as const;
const action = (overrides: Readonly<Record<string, unknown>> = {}) =>
  ({
    schemaVersion: 1,
    type: "PROVIDER_COMPONENT",
    componentKey: "airwallex-hpp",
    clientToken: encodeAirwallexHppClientToken(launch as never),
    ...overrides,
  }) as never;

function fakeHost(
  options: Readonly<{
    sdk?: boolean;
    payments?: boolean;
    loadFails?: boolean;
    redirectFails?: boolean;
  }> = {},
) {
  const redirectToCheckout = vi.fn(() => {
    if (options.redirectFails) throw new Error("SDK failure");
  });
  const init = vi.fn(async () =>
    options.payments === false ? {} : { payments: { redirectToCheckout } },
  );
  let installed = options.sdk ?? false;
  const loadScript = vi.fn(async () => {
    if (options.loadFails) throw new Error("blocked");
    installed = true;
  });
  return {
    host: {
      origin,
      loadScript,
      airwallex: () => (installed ? { init } : undefined),
    },
    init,
    loadScript,
    redirectToCheckout,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("advertises redirects and provider components, and launches only components this release ships", () => {
  expect(PERFORMABLE_ACTION_TYPES).toEqual(["REDIRECT", "PROVIDER_COMPONENT"]);
  expect(isPerformableActionType("PROVIDER_COMPONENT")).toBe(true);
  expect(isPerformableActionType("QR_CODE")).toBe(false);
  expect(canLaunchPaymentComponent(action())).toBe(true);
  expect(
    canLaunchPaymentComponent(action({ componentKey: "paypal-buttons" })),
  ).toBe(false);
});

it("the launchable keys are exactly the shipped launchers, including the Airwallex adapter's component", () => {
  expect([...LAUNCHABLE_COMPONENT_KEYS].sort()).toEqual(
    Object.keys(launchers).sort(),
  );
  expect(LAUNCHABLE_COMPONENT_KEYS.has(AIRWALLEX_HPP_COMPONENT_KEY)).toBe(true);
});

it("loads the official Airwallex SDK on demand and hands the intent to the Hosted Payment Page", async () => {
  const fake = fakeHost();
  expect(await launchPaymentComponent(action(), fake.host)).toBe(true);
  expect(fake.loadScript.mock.calls).toEqual([[AIRWALLEX_SDK_URL]]);
  expect(fake.init).toHaveBeenCalledWith({
    env: "sandbox",
    enabledElements: ["payments"],
  });
  expect(fake.redirectToCheckout).toHaveBeenCalledWith({
    env: "sandbox",
    mode: "payment",
    intent_id: launch.intentId,
    client_secret: launch.clientSecret,
    currency: "USD",
    locale: "zh",
    cancelUrl: launch.cancelUrl,
    methods: ["card", "applepay", "googlepay"],
  });
  const loaded = fakeHost({ sdk: true });
  expect(await launchPaymentComponent(action(), loaded.host)).toBe(true);
  expect(loaded.loadScript).not.toHaveBeenCalled();
});

it("refuses tampered tokens, foreign return origins and SDK failures, leaving the fan on checkout", async () => {
  const foreign = encodeAirwallexHppClientToken({
    ...launch,
    cancelUrl: "https://elsewhere.example.com/return",
  } as never);
  for (const [candidate, options] of [
    [action({ clientToken: "A".repeat(40) }), {}],
    [action({ clientToken: foreign }), {}],
    [action({ componentKey: "paypal-buttons" }), {}],
    [action(), { loadFails: true }],
    [action(), { payments: false }],
    [action(), { redirectFails: true }],
  ] as const) {
    const fake = fakeHost(options);
    expect(await launchPaymentComponent(candidate, fake.host)).toBe(false);
  }
  const fake = fakeHost();
  await launchPaymentComponent(action({ clientToken: foreign }), fake.host);
  expect(fake.loadScript).not.toHaveBeenCalled();
});

it("the browser host injects one script per URL and loads it again after a failure", async () => {
  const appended: EventTarget[] = [];
  vi.stubGlobal("document", {
    createElement: vi.fn(() =>
      Object.assign(new EventTarget(), {
        src: "",
        async: false,
        referrerPolicy: "",
        remove: vi.fn(),
      }),
    ),
    head: { append: (script: EventTarget) => appended.push(script) },
  });
  vi.stubGlobal("window", { location: { origin }, setTimeout, clearTimeout });
  const browser = browserPaymentComponentHost();
  expect(browser.origin).toBe(origin);
  const first = browser.loadScript(AIRWALLEX_SDK_URL);
  expect(browser.loadScript(AIRWALLEX_SDK_URL)).toBe(first);
  expect(appended).toHaveLength(1);
  appended[0]!.dispatchEvent(new Event("error"));
  await expect(first).rejects.toThrow("PAYMENT_COMPONENT_UNAVAILABLE");
  const retry = browser.loadScript(AIRWALLEX_SDK_URL);
  expect(appended).toHaveLength(2);
  expect(appended[1]).toMatchObject({
    src: AIRWALLEX_SDK_URL,
    async: true,
    referrerPolicy: "no-referrer",
  });
  appended[1]!.dispatchEvent(new Event("load"));
  await expect(retry).resolves.toBeUndefined();
});
