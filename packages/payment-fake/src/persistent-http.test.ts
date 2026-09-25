import { expect, test, vi } from "vitest";
import { deterministicPortFixtures } from "@fan-support/testing";
import {
  SUPPORTED_LOCALES,
  type PaymentRuntimeProviderBinding,
} from "@fan-support/contracts";
import { createFakePaymentProvider } from "./index.js";
import { createPersistentTestPaymentProvider } from "./persistent-http.js";
const create = deterministicPortFixtures.payment.createPayment;
const origin = "https://payments.example.invalid";
const returnOrigin = new URL(create.returnUrl).origin;
const token = "A".repeat(43);
const binding = {
  schemaVersion: 1,
  providerAccountId: create.providerAccountId,
  providerCode: "fake",
  environment: "TEST",
  localeMapping: Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      { providerLocale: locale, fallbackUsed: false },
    ]),
  ),
  allowedActionOrigins: [origin],
} as PaymentRuntimeProviderBinding;
function setup(fetcher: typeof fetch) {
  return createPersistentTestPaymentProvider({
    binding,
    endpointOrigin: origin,
    returnOrigin,
    authorizationToken: token,
    fetcher,
  });
}
test("creates no local provider truth; each call goes to the authenticated fixed TEST PSP", async () => {
  const response = await createFakePaymentProvider().createPayment(create);
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(response));
  const first = setup(fetcher),
    restarted = setup(fetcher);
  expect(await first.createPayment(create)).toEqual(response);
  expect(await restarted.createPayment(create)).toEqual(response);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, init] = fetcher.mock.lastCall!;
  expect(String(url)).toBe(origin + "/v1/commands");
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  expect(JSON.parse(init!.body as string)).toEqual(create);
  expect(new Headers(init!.headers).get("authorization")).toBe(
    `Bearer ${token}`,
  );
});
test("LIVE, foreign accounts and foreign return origins cannot dispatch", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const provider = setup(fetcher);
  for (const command of [
    { ...create, environment: "LIVE" },
    { ...create, providerAccountId: "10000000-0000-4000-8000-000000000099" },
    { ...create, returnUrl: "https://unapproved.example.invalid/return" },
  ]) {
    expect(
      await provider.createPayment(command as typeof create),
    ).toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(() =>
    createPersistentTestPaymentProvider({
      binding: { ...binding, environment: "LIVE" },
      endpointOrigin: origin,
      returnOrigin,
      authorizationToken: token,
    }),
  ).toThrow();
});
test("accepted create network loss is unknown; a new adapter can reconcile the durable PSP without external reference", async () => {
  const backend = createFakePaymentProvider({
    createPaymentOutcome: "TIMEOUT_AFTER_ACCEPT",
  });
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const command = JSON.parse(init!.body as string);
    if (command.operation === "CREATE_PAYMENT") {
      await backend.createPayment(command);
      throw new Error("private-transport-details");
    }
    return Response.json(await backend.reconcilePayment(command));
  });
  expect(await setup(fetcher).createPayment(create)).toMatchObject({
    outcome: "FAILURE",
    error: { code: "TIMEOUT_OUTCOME_UNKNOWN", recovery: "RECONCILE_REQUIRED" },
  });
  expect(
    await setup(fetcher).reconcilePayment(
      deterministicPortFixtures.payment.reconcilePayment,
    ),
  ).toMatchObject({
    outcome: "SUCCESS",
    value: {
      event: {
        status: "SUCCEEDED",
        evidence: { kind: "AUTHENTICATED_RECONCILE" },
      },
    },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("malformed, mismatched, redirect and unapproved hosted actions cannot be promoted to success", async () => {
  const success = await createFakePaymentProvider().createPayment(create);
  if (success.outcome !== "SUCCESS") throw new Error("Invalid TEST fixture");
  const fetcher = vi.fn<typeof fetch>();
  for (const response of [
    Response.json({ ...success, extra: "private-canary" }),
    Response.json({
      ...success,
      value: { ...success.value, amountMinor: create.amountMinor + 1 },
    }),
    Response.json({
      ...success,
      value: {
        ...success.value,
        action: {
          schemaVersion: 1,
          type: "REDIRECT",
          url: "https://unapproved.example.invalid/pay",
        },
      },
    }),
    new Response(null, {
      status: 302,
      headers: { location: "https://unapproved.example.invalid" },
    }),
    new Response("x".repeat(1_048_577), {
      headers: { "content-type": "application/json" },
    }),
  ]) {
    fetcher.mockResolvedValueOnce(response);
    const result = await setup(fetcher).createPayment(create);
    expect(result).toMatchObject({
      outcome: "FAILURE",
      error: {
        code: "MALFORMED_PROVIDER_RESPONSE",
        recovery: "RECONCILE_REQUIRED",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-canary");
  }
});
