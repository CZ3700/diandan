import { expect, test, vi } from "vitest";

import {
  STRIPE_API_VERSION,
  StripeTransportError,
  createStripeTransport,
} from "./transport.js";

const key = ["sk", "test", "transport"].join("_");

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

test("POST sends a pinned version, form body, idempotency key and no redirects", async () => {
  const fetcher = vi.fn(async () =>
    json({ id: "cs_test_1" }, { headers: { "idempotent-replayed": "true" } }),
  );
  const transport = createStripeTransport(fetcher as never);
  const response = await transport(
    {
      method: "POST",
      path: "/v1/checkout/sessions",
      parameters: [
        ["mode", "payment"],
        ["line_items[0][quantity]", "1"],
      ],
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
    },
    key,
    1000,
  );
  expect(response).toEqual({
    status: 200,
    replayed: true,
    body: { id: "cs_test_1" },
  });
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("https://api.stripe.com/v1/checkout/sessions");
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    credentials: "omit",
    body: "mode=payment&line_items%5B0%5D%5Bquantity%5D=1",
    headers: {
      authorization: `Bearer ${key}`,
      "stripe-version": STRIPE_API_VERSION,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": "10000000-0000-4000-8000-000000000001",
    },
  });
});

test("GET encodes parameters as a query and reports error bodies with their status", async () => {
  const fetcher = vi.fn(async () =>
    json({ error: { type: "invalid_request_error" } }, { status: 404 }),
  );
  const response = await createStripeTransport(fetcher as never)(
    {
      method: "GET",
      path: "/v1/refunds",
      parameters: [["payment_intent", "pi_1"]],
    },
    key,
    1000,
  );
  expect(response.status).toBe(404);
  expect(response.replayed).toBe(false);
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe(
    "https://api.stripe.com/v1/refunds?payment_intent=pi_1",
  );
  expect(init.body).toBeUndefined();
});

test("network failures, deadlines, non-JSON and oversized replies are an unknown outcome", async () => {
  const cases: (() => Promise<Response>)[] = [
    async () => {
      throw new TypeError("socket hang up");
    },
    () => new Promise<Response>(() => undefined),
    async () =>
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    async () =>
      new Response("x".repeat(1_048_577), {
        headers: { "content-type": "application/json" },
      }),
    async () =>
      new Response("{not json", {
        headers: { "content-type": "application/json" },
      }),
  ];
  for (const reply of cases)
    await expect(
      createStripeTransport(reply as never)(
        { method: "GET", path: "/v1/checkout/sessions/cs_test_1" },
        key,
        50,
      ),
    ).rejects.toBeInstanceOf(StripeTransportError);
});

test("only fixed Stripe API paths are reachable", async () => {
  const fetcher = vi.fn();
  for (const path of [
    "https://evil.example/v1/x",
    "/v2/x",
    "//evil.example/v1",
  ])
    await expect(
      createStripeTransport(fetcher as never)(
        { method: "GET", path },
        key,
        1000,
      ),
    ).rejects.toThrow(TypeError);
  expect(fetcher).not.toHaveBeenCalled();
});
