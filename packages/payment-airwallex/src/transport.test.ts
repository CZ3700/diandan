import { expect, test, vi } from "vitest";

import {
  AIRWALLEX_API_VERSION,
  AirwallexTransportError,
  createAirwallexTransport,
} from "./transport.js";

const sandbox = "https://api.sandbox.airwallex.com" as const;
const token = { kind: "token", token: "fixture-access-token-0001" } as const;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

test("POST sends a pinned version, a JSON body, the bearer token and no redirects", async () => {
  const fetcher = vi.fn(async () => json({ id: "int_1" }, { status: 201 }));
  const response = await createAirwallexTransport(fetcher as never)(
    sandbox,
    {
      method: "POST",
      path: "/api/v1/pa/payment_intents/create",
      body: { request_id: "r-1", amount: 19.99 },
    },
    token,
    1000,
  );
  expect(response).toEqual({ status: 201, body: { id: "int_1" } });
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe(
    "https://api.sandbox.airwallex.com/api/v1/pa/payment_intents/create",
  );
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    credentials: "omit",
    body: '{"request_id":"r-1","amount":19.99}',
    headers: {
      authorization: "Bearer fixture-access-token-0001",
      "x-api-version": AIRWALLEX_API_VERSION,
      "content-type": "application/json",
    },
  });
});

test("login sends the client pair instead of a bearer token, and GET encodes a query", async () => {
  const fetcher = vi.fn(async () => json({ ok: true }));
  const transport = createAirwallexTransport(fetcher as never);
  await transport(
    "https://api.airwallex.com",
    { method: "POST", path: "/api/v1/authentication/login" },
    { kind: "login", clientId: "client-1", apiKey: "key-1" },
    1000,
  );
  const [, login] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(login.headers).toMatchObject({
    "x-client-id": "client-1",
    "x-api-key": "key-1",
  });
  expect(login.headers).not.toHaveProperty("authorization");
  expect(login.body).toBeUndefined();
  await transport(
    sandbox,
    {
      method: "GET",
      path: "/api/v1/pa/refunds",
      query: [
        ["payment_intent_id", "int_1"],
        ["page_num", "0"],
      ],
    },
    token,
    1000,
  );
  const [url] = fetcher.mock.calls[1] as unknown as [URL];
  expect(url.href).toBe(
    "https://api.sandbox.airwallex.com/api/v1/pa/refunds?payment_intent_id=int_1&page_num=0",
  );
});

test("a client error without JSON is still a definite answer; anything else unreadable is unknown", async () => {
  const text = (status: number) => async () =>
    new Response("<html>denied</html>", {
      status,
      headers: { "content-type": "text/html" },
    });
  expect(
    await createAirwallexTransport(text(401) as never)(
      sandbox,
      { method: "GET", path: "/api/v1/pa/payment_intents/int_1" },
      token,
      1000,
    ),
  ).toEqual({ status: 401, body: undefined });
  const unknown: (() => Promise<Response>)[] = [
    text(502),
    text(200),
    async () => {
      throw new TypeError("socket hang up");
    },
    () => new Promise<Response>(() => undefined),
    async () =>
      new Response("x".repeat(1_048_577), {
        headers: { "content-type": "application/json" },
      }),
    async () =>
      new Response("{not json", {
        headers: { "content-type": "application/json" },
      }),
  ];
  for (const reply of unknown)
    await expect(
      createAirwallexTransport(reply as never)(
        sandbox,
        { method: "GET", path: "/api/v1/pa/payment_intents/int_1" },
        token,
        50,
      ),
    ).rejects.toBeInstanceOf(AirwallexTransportError);
});

test("only the fixed Airwallex origins and API paths are reachable", async () => {
  const fetcher = vi.fn();
  const transport = createAirwallexTransport(fetcher as never);
  for (const [origin, path] of [
    ["https://evil.example", "/api/v1/pa/refunds"],
    [sandbox, "https://evil.example/api/v1/x"],
    [sandbox, "//evil.example/api/v1/x"],
    [sandbox, "/api/v2/x"],
  ] as const)
    await expect(
      transport(origin as never, { method: "GET", path }, token, 1000),
    ).rejects.toThrow(TypeError);
  expect(fetcher).not.toHaveBeenCalled();
});
