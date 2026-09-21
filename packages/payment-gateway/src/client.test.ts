import { expect, test, vi } from "vitest";
import {
  paymentPortCommandSchema,
  type CancelPaymentCommand,
  type RefundPaymentCommand,
  type PaymentAccountConnection,
} from "@fan-support/contracts";
import { createGatewayPaymentProvider } from "./client.js";
import {
  connection,
  create,
  createResponse,
  get,
  credentials,
  capabilities,
  capability,
} from "./harness.gateway.js";
const setup = (
  fetcher: typeof fetch,
  patch: Partial<PaymentAccountConnection> = {},
) =>
  createGatewayPaymentProvider({
    connection: { ...connection, ...patch },
    credentials,
    fetcher,
  });
test("dispatches exactly the frozen command envelope and mutation key to its fixed HTTPS endpoint", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(createResponse),
  );
  expect(await setup(fetcher).createPayment(create)).toEqual(createResponse);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe(connection.apiOrigin + "/v1/payment-commands");
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  expect(JSON.parse(init!.body as string)).toEqual({
    schemaVersion: 1,
    protocol: "fan-support-gateway-v1",
    merchantAccount: connection.merchantAccount,
    command: create,
    instrument: connection.instruments[0],
  });
  expect(Object.fromEntries(new Headers(init!.headers))).toEqual({
    accept: "application/json",
    "content-type": "application/json",
    authorization: "Bearer test-runtime-bearer",
    "idempotency-key": create.providerIdempotencyKey,
  });
});
test("filters actual capabilities without advertising methods or hosted actions solely from configuration", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      outcome: "SUCCESS",
      value: {
        capabilities: [
          capability,
          {
            ...capability,
            id: "71000000-0000-4000-8000-000000000009",
            paymentMethod: "other",
          },
        ],
      },
    }),
  );
  expect(await setup(fetcher).getCapabilities(capabilities)).toMatchObject({
    outcome: "SUCCESS",
    value: { capabilities: [capability] },
  });
  expect(
    new Headers(fetcher.mock.calls[0]![1]!.headers).has("idempotency-key"),
  ).toBe(false);
  fetcher.mockImplementation(async () =>
    Response.json({
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      outcome: "SUCCESS",
      value: { capabilities: [{ ...capability, paymentMethod: "other" }] },
    }),
  );
  expect(await setup(fetcher).getCapabilities(capabilities)).toMatchObject({
    outcome: "FAILURE",
    error: { code: "CAPABILITY_UNAVAILABLE" },
  });
});
test("an authenticated empty capability list is ordinary unavailability, not a malformed provider response", async () => {
  const response = {
    schemaVersion: 1,
    operation: "GET_CAPABILITIES",
    outcome: "SUCCESS",
    value: { capabilities: [] },
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(response));
  expect(await setup(fetcher).getCapabilities(capabilities)).toEqual(response);
});
test.each([
  { ...capability, available: false },
  { ...capability, minimumAmountMinor: capabilities.amountMinor + 1 },
])(
  "a correlated capability unavailable for this quote is a business result",
  async (entry) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        schemaVersion: 1,
        operation: "GET_CAPABILITIES",
        outcome: "SUCCESS",
        value: { capabilities: [entry] },
      }),
    );
    expect(await setup(fetcher).getCapabilities(capabilities)).toMatchObject({
      outcome: "FAILURE",
      error: { code: "CAPABILITY_UNAVAILABLE" },
    });
  },
);
test("invalid account, origin, method, protocol, stablecoin or credentials fail before network", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const command of [
    { ...create, environment: "LIVE" },
    { ...create, returnUrl: "https://other.example.invalid/" },
    { ...create, paymentMethod: "other" },
  ])
    expect(
      await setup(fetcher).createPayment(command as typeof create),
    ).toMatchObject({ outcome: "FAILURE" });
  for (const patch of [
    { protocol: "vendor-api" },
    { apiOrigin: "http://gateway.example.invalid" },
    {
      instruments: [
        {
          kind: "STABLECOIN",
          paymentMethod: "usdt",
          asset: "USDT",
          network: "TRON",
          tokenReference: "token-test",
          decimals: 6,
          minimumConfirmations: 20,
          exceptionPolicy: "MANUAL_REVIEW",
        },
      ],
    },
  ])
    expect(() =>
      setup(fetcher, patch as Partial<PaymentAccountConnection>),
    ).toThrow(/^Invalid gateway connection$/u);
  const provider = createGatewayPaymentProvider({
    connection,
    fetcher,
    credentials: {
      resolve: async () => {
        throw new Error("PRIVATE_CANARY");
      },
    },
  });
  expect(await provider.createPayment(create)).toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});
test("network failure never retries and differentiates mutation uncertainty from safe read failure", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("PRIVATE_CANARY");
  });
  expect(await setup(fetcher).createPayment(create)).toMatchObject({
    outcome: "FAILURE",
    error: { recovery: "RECONCILE_REQUIRED" },
  });
  expect(await setup(fetcher).getPayment(get)).toMatchObject({
    outcome: "FAILURE",
    error: { recovery: "NONE" },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("timeout covers a stalled response body and cancels it", async () => {
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "application/json" },
      }),
  );
  expect(await setup(fetcher).createPayment(create)).toMatchObject({
    outcome: "FAILURE",
    error: { recovery: "RECONCILE_REQUIRED" },
  });
  expect(cancel).toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("malformed, foreign, nonhosted, wrong locale and oversized responses never become success or leak bodies", async () => {
  if (createResponse.outcome !== "SUCCESS") throw new Error("Invalid fixture");
  for (const response of [
    Response.json({ ...createResponse, private: "PRIVATE_CANARY" }),
    Response.json({
      ...createResponse,
      value: { ...createResponse.value, amountMinor: 1 },
    }),
    Response.json({
      ...createResponse,
      value: { ...createResponse.value, providerLocale: "not-configured" },
    }),
    Response.json({
      ...createResponse,
      value: {
        ...createResponse.value,
        action: {
          schemaVersion: 1,
          type: "REDIRECT",
          url: "https://evil.example.invalid/",
        },
      },
    }),
    Response.json({
      ...createResponse,
      value: {
        ...createResponse.value,
        action: {
          schemaVersion: 1,
          type: "PROVIDER_HOSTED_IFRAME",
          url: "https://payments.example.invalid/",
        },
      },
    }),
    new Response("PRIVATE_CANARY", { status: 503 }),
    new Response(null, { status: 302 }),
    new Response("x".repeat(1048577), {
      headers: { "content-type": "application/json" },
    }),
  ]) {
    const result = await setup(async () => response).createPayment(create);
    expect(result).toMatchObject({
      outcome: "FAILURE",
      error: { recovery: "RECONCILE_REQUIRED" },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
  }
});
test("cancel and refund use their own original idempotency keys", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error();
  });
  const provider = setup(fetcher);
  const cancel = paymentPortCommandSchema.parse({
    ...get,
    operation: "CANCEL_PAYMENT",
    idempotencyKey: create.providerIdempotencyKey,
    reasonCode: "CUSTOMER_CANCELED",
  }) as CancelPaymentCommand;
  const refundId = "71000000-0000-4000-8000-000000000005";
  const refund = paymentPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "REFUND_PAYMENT",
    providerAccountId: create.providerAccountId,
    environment: "TEST",
    paymentAttemptId: create.attemptId,
    externalReference: get.externalReference,
    refundId,
    refundReference: "merchant-refund/test",
    idempotencyKey: refundId,
    amountMinor: 100,
    currency: "USD",
  }) as RefundPaymentCommand;
  await provider.cancelPayment(cancel);
  await provider.refundPayment(refund);
  expect(
    fetcher.mock.calls.map(([, init]) =>
      new Headers(init!.headers).get("idempotency-key"),
    ),
  ).toEqual([cancel.idempotencyKey, refund.idempotencyKey]);
});
test("direct factory cannot claim another deployed provider identity", () => {
  expect(() =>
    setup(vi.fn(), {
      binding: { ...connection.binding, providerCode: "stripe" },
    }),
  ).toThrow(/^Invalid gateway connection$/u);
});
test("credential deadline returns a safe configuration failure and a late resolution cannot dispatch", async () => {
  let finish: (value: unknown) => void = () => undefined;
  const fetcher = vi.fn<typeof fetch>();
  const provider = createGatewayPaymentProvider({
    connection,
    fetcher,
    credentials: {
      resolve: (request) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ ...request, version: "v1", values: ["late-token"] });
        }),
    },
  });
  const outcome = await Promise.race([
    provider.createPayment(create),
    new Promise((resolve) => setTimeout(() => resolve("HUNG"), 300)),
  ]);
  expect(outcome).toMatchObject({
    outcome: "FAILURE",
    error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
  finish(null);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetcher).not.toHaveBeenCalled();
});
test("dispatches account-owned instrument requirements and rejects caller profile overrides", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(createResponse),
  );
  const provider = setup(fetcher);
  await provider.createPayment(create);
  expect(
    JSON.parse(fetcher.mock.calls[0]![1]!.body as string).instrument,
  ).toEqual(connection.instruments[0]);
  await provider.getCapabilities(capabilities);
  expect(
    JSON.parse(fetcher.mock.calls[1]![1]!.body as string).instruments,
  ).toEqual(connection.instruments);
  expect(
    await provider.createPayment({
      ...create,
      instrument: { kind: "CARD", brands: ["OTHER"] },
    } as typeof create),
  ).toMatchObject({ outcome: "FAILURE", error: { code: "INVALID_COMMAND" } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
