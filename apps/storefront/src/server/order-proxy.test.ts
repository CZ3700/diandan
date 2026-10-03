import { afterEach, expect, test, vi } from "vitest";
import {
  cartTestCsrf,
  checkoutTestId,
  orderTestClear,
  orderTestCookie,
  orderTestCsrf,
  orderTestGrant,
  orderTestId,
  orderTestRead,
  orderTestResponse,
  orderTestRevoked,
  orderTestToken,
  otherOrderTestId,
} from "./order-test-support";
vi.mock("server-only", () => ({}));
const load = () => import("./order-proxy").catch(() => null);
const siteOrigin = "https://shop.example.invalid";
const internalApiOrigin = "http://localhost:3002";
const paths = {
  exchange: "/order-access/exchange",
  bootstrap: `/checkout/sessions/${checkoutTestId}/order-access`,
  read: `/orders/${orderTestId}`,
  revoke: "/order-access/revoke",
  locate: "/order-access/locate",
};
function req(
  path: string,
  method = "POST",
  body: unknown = { schemaVersion: 1 },
  headers: Record<string, string> = {},
) {
  return new Request(siteOrigin + "/api/storefront" + path, {
    method,
    headers: {
      origin: siteOrigin,
      "content-type": "application/json",
      cookie: `unrelated=private; __Host-fan-order=${orderTestToken}; __Host-fan-cart=${orderTestToken}`,
      "x-csrf-token": path === paths.bootstrap ? cartTestCsrf : orderTestCsrf,
      ...headers,
    },
    ...(method !== "GET" && method !== "HEAD"
      ? { body: JSON.stringify(body) }
      : {}),
  });
}
async function run(request: Request, fetcher: typeof fetch) {
  const mod = await load();
  expect(mod?.proxyOrderRequest).toBeTypeOf("function");
  return mod!.proxyOrderRequest(request, {
    siteOrigin,
    internalApiOrigin,
    fetcher,
  });
}
const granted = () =>
  orderTestResponse(orderTestGrant, 200, {
    "set-cookie": orderTestCookie,
    "x-csrf-token": orderTestCsrf,
  });
afterEach(() => vi.useRealTimers());

test("the four allowlisted routes isolate credentials and expose only validated private responses", async () => {
  for (const [path, method, body, result, cookie, csrf] of [
    [
      paths.exchange,
      "POST",
      { schemaVersion: 1, token: orderTestToken },
      granted,
      null,
      null,
    ],
    [
      paths.bootstrap,
      "POST",
      { schemaVersion: 1 },
      granted,
      `__Host-fan-cart=${orderTestToken}`,
      cartTestCsrf,
    ],
    [
      paths.read,
      "GET",
      undefined,
      () =>
        orderTestResponse(orderTestRead, 200, {
          "x-csrf-token": orderTestCsrf,
        }),
      `__Host-fan-order=${orderTestToken}`,
      null,
    ],
    [
      paths.revoke,
      "POST",
      { schemaVersion: 1, publicOrderId: orderTestId },
      () =>
        orderTestResponse(orderTestRevoked, 200, {
          "set-cookie": orderTestClear,
        }),
      `__Host-fan-order=${orderTestToken}`,
      orderTestCsrf,
    ],
  ] as const) {
    const fetcher = vi.fn<typeof fetch>(async () => result());
    const response = await run(
      req(path, method, body, {
        authorization: "private",
        "x-forwarded-for": "192.0.2.1, 203.0.113.7",
      }),
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(internalApiOrigin + "/api/v1" + path);
    expect(init).toMatchObject({
      method,
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
    const forwarded = new Headers(init?.headers);
    expect(forwarded.get("cookie")).toBe(cookie);
    expect(forwarded.get("x-csrf-token")).toBe(csrf);
    expect(forwarded.get("authorization")).toBeNull();
    expect(forwarded.get("x-forwarded-for")).toBe("192.0.2.1, 203.0.113.7");
    expect(forwarded.get("origin")).toBe(siteOrigin);
  }
});
test("the edge forwarded chain is kept from the right within 512 bytes, so spoofed prefixes are the only loss", async () => {
  const { forwardedClientChain } = await import("./order-proxy-request");
  const chain = (value?: string) =>
    forwardedClientChain(
      new Headers(value === undefined ? {} : { "x-forwarded-for": value }),
    );
  expect(chain()).toBeUndefined();
  expect(chain(" , ")).toBeUndefined();
  expect(chain(" 203.0.113.7 ")).toBe("203.0.113.7");
  expect(chain("192.0.2.1,, 203.0.113.7")).toBe("192.0.2.1, 203.0.113.7");
  const spoofed = Array.from({ length: 60 }, (_, i) => `198.51.100.${i}`);
  const kept = chain(`${spoofed.join(", ")}, 203.0.113.7, 10.20.0.5`)!;
  expect(new TextEncoder().encode(kept).byteLength).toBeLessThanOrEqual(512);
  expect(kept.endsWith(", 198.51.100.59, 203.0.113.7, 10.20.0.5")).toBe(true);
  expect(spoofed.some((entry) => kept.startsWith(`${entry}, `))).toBe(true);
  expect(chain(`${"x".repeat(600)}, 203.0.113.7`)).toBe("203.0.113.7");
});

test("invalid paths, methods, queries, origin, metadata, schemas and cookie/CSRF ambiguity never dispatch", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => granted());
  const invalid = [
    req(paths.read, "POST"),
    req(paths.read, "HEAD"),
    req(paths.exchange, "GET"),
    req(paths.read + "?locale=en", "GET"),
    req(paths.exchange + "?", "POST", {
      schemaVersion: 1,
      token: orderTestToken,
    }),
    req("/orders/not-an-id", "GET"),
    req(paths.exchange, "POST", {
      schemaVersion: 1,
      token: orderTestToken,
      email: "secret",
    }),
    req(paths.exchange, "POST", { schemaVersion: 1, token: "B".repeat(43) }),
    req(
      paths.exchange,
      "POST",
      { schemaVersion: 1, token: orderTestToken },
      { origin: "https://attacker.invalid" },
    ),
    req(
      paths.exchange,
      "POST",
      { schemaVersion: 1, token: orderTestToken },
      { "sec-fetch-site": "same-site" },
    ),
    req(paths.bootstrap, "POST", undefined, { "x-csrf-token": "" }),
    req(paths.read, "GET", undefined, { cookie: "" }),
    req(paths.read, "GET", undefined, {
      cookie: `__Host-fan-order=${orderTestToken}; __Host-fan-order=${orderTestToken}`,
    }),
    req(
      paths.revoke,
      "POST",
      { schemaVersion: 1, publicOrderId: orderTestId },
      { "x-csrf-token": "B".repeat(43) },
    ),
    req(paths.read, "GET", undefined, { "content-length": "1" }),
    req(paths.bootstrap, "POST", undefined, { "content-type": "text/plain" }),
  ];
  for (const request of invalid)
    expect((await run(request, fetcher)).status).toBeGreaterThanOrEqual(400);
  expect(fetcher).not.toHaveBeenCalled();
});
test("wrong result action, status, scope and hidden data fail closed", async () => {
  for (const [body, status] of [
    [orderTestGrant, 200],
    [orderTestRead, 201],
    [
      {
        ...orderTestRead,
        order: { ...orderTestRead.order, publicOrderId: otherOrderTestId },
      },
      200,
    ],
    [{ ...orderTestRead, email: "never forward" }, 200],
    [{ schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_DENIED" }, 200],
  ] as const) {
    const response = await run(req(paths.read, "GET"), async () =>
      orderTestResponse(body, status, { "x-csrf-token": orderTestCsrf }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    });
    expect(response.headers.has("set-cookie")).toBe(false);
  }
});
test("grant requires an exact Host cookie, matching canonical expiry and canonical CSRF", async () => {
  const cookies = [
    "",
    orderTestCookie.replace("Strict", "Lax"),
    orderTestCookie + "; Domain=shop.example.invalid",
    orderTestCookie + "; Secure",
    orderTestCookie.replace("2099", "2098"),
    orderTestCookie.replace(
      "Expires=Thu, 01 Jan 2099 00:00:00 GMT",
      "Expires=2099-01-01",
    ),
    orderTestCookie.replace(orderTestToken, "B".repeat(43)),
  ];
  for (const cookie of cookies) {
    const response = await run(
      req(paths.exchange, "POST", { schemaVersion: 1, token: orderTestToken }),
      async () =>
        orderTestResponse(orderTestGrant, 200, {
          "set-cookie": cookie,
          "x-csrf-token": orderTestCsrf,
        }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.has("set-cookie")).toBe(false);
  }
  for (const csrf of ["", "B".repeat(43), orderTestCsrf + "," + orderTestCsrf])
    expect(
      (
        await run(req(paths.bootstrap), async () =>
          orderTestResponse(orderTestGrant, 200, {
            "set-cookie": orderTestCookie,
            "x-csrf-token": csrf,
          }),
        )
      ).status,
    ).toBe(503);
  const doubled = granted();
  doubled.headers.append("set-cookie", "unrelated=private");
  expect((await run(req(paths.bootstrap), async () => doubled)).status).toBe(
    503,
  );
});
test("cookies and CSRF cannot cross read, revoke and failure response boundaries", async () => {
  for (const headers of [
    { "x-csrf-token": orderTestCsrf, "set-cookie": orderTestCookie },
    { "x-csrf-token": "" },
  ])
    expect(
      (
        await run(req(paths.read, "GET"), async () =>
          orderTestResponse(orderTestRead, 200, headers),
        )
      ).status,
    ).toBe(503);
  for (const headers of [
    { "set-cookie": orderTestClear + "; Domain=shop.example.invalid" },
    { "set-cookie": orderTestClear, "x-csrf-token": orderTestCsrf },
    { "set-cookie": "" },
  ])
    expect(
      (
        await run(
          req(paths.revoke, "POST", {
            schemaVersion: 1,
            publicOrderId: orderTestId,
          }),
          async () => orderTestResponse(orderTestRevoked, 200, headers),
        )
      ).status,
    ).toBe(503);
  expect(
    (
      await run(req(paths.read, "GET"), async () =>
        orderTestResponse(
          { schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_DENIED" },
          401,
          { "set-cookie": orderTestClear },
        ),
      )
    ).status,
  ).toBe(503);
});
test("rate limiting carries only bounded integer retry metadata and exact failure statuses", async () => {
  for (const retry of [
    "0",
    "3601",
    "2.5",
    "Fri, 01 Jan 2099 00:00:00 GMT",
    "10, 20",
    "",
  ]) {
    const result = await run(req(paths.read, "GET"), async () =>
      orderTestResponse(
        { schemaVersion: 1, outcome: "FAILURE", code: "RATE_LIMITED" },
        429,
        { "retry-after": retry },
      ),
    );
    expect(result.status).toBe(503);
    expect(result.headers.has("retry-after")).toBe(false);
  }
  for (const [code, status] of [
    ["INVALID_REQUEST", 400],
    ["INVALID_REQUEST", 413],
    ["ACCESS_DENIED", 401],
    ["ACCESS_DENIED", 403],
    ["PAYMENT_NOT_CONFIRMED", 409],
    ["RATE_LIMITED", 429],
    ["TEMPORARY_UNAVAILABLE", 503],
  ] as const) {
    const response = await run(req(paths.read, "GET"), async () =>
      orderTestResponse(
        { schemaVersion: 1, outcome: "FAILURE", code },
        status,
        code === "RATE_LIMITED" ? { "retry-after": "12" } : {},
      ),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("retry-after")).toBe(
      code === "RATE_LIMITED" ? "12" : null,
    );
  }
});
test("a single deadline covers an uncooperative fetch and a stalled response body", async () => {
  // Load before fake timers so module loading is outside the transport deadline.
  const mod = await load();
  expect(mod?.proxyOrderRequest).toBeTypeOf("function");
  vi.useFakeTimers();
  for (const fetcher of [
    () => new Promise<Response>(() => {}),
    async () =>
      new Response(new ReadableStream(), {
        headers: {
          "content-type": "application/json",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          "x-robots-tag": "noindex, nofollow",
        },
      }),
  ]) {
    const pending = mod!.proxyOrderRequest(req(paths.read, "GET"), {
      siteOrigin,
      internalApiOrigin,
      fetcher,
    });
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await pending).status).toBe(503);
  }
});
test("request and response byte budgets reject oversize and malformed UTF-8 without leaking text", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => granted());
  const request = req(paths.exchange, "POST", {
    schemaVersion: 1,
    token: orderTestToken,
    padding: "x".repeat(1100),
  });
  expect((await run(request, fetcher)).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
  for (const body of [new Uint8Array([0xc3, 0x28]), "x".repeat(2_097_153)]) {
    const response = await run(
      req(paths.read, "GET"),
      async () =>
        new Response(body, {
          headers: {
            "content-type": "application/json",
            "cache-control": "private, no-store",
            "referrer-policy": "no-referrer",
            "x-robots-tag": "noindex, nofollow",
          },
        }),
    );
    expect(response.status).toBe(503);
  }
});

test("proxy host validation requires the complete fixed public forwarding tuple", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => granted());
  for (const extra of [
    {},
    { host: "attacker.invalid" },
    { "x-forwarded-host": "attacker.invalid" },
    { "x-forwarded-proto": "https, http" },
  ]) {
    const incoming = new Request(
      "http://next.internal:3000/api/storefront" + paths.bootstrap,
      {
        method: "POST",
        headers: {
          host: "shop.example.invalid",
          "x-forwarded-host": "shop.example.invalid",
          "x-forwarded-proto": "https",
          origin: siteOrigin,
          "content-type": "application/json",
          "x-csrf-token": cartTestCsrf,
          cookie: `__Host-fan-cart=${orderTestToken}`,
          ...extra,
        },
        body: '{"schemaVersion":1}',
      },
    );
    expect((await run(incoming, fetcher)).status).toBe(
      Object.keys(extra).length ? 403 : 200,
    );
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("read replies enforce advertised length and grant streams stop immediately after the actual byte cap", async () => {
  expect(
    (
      await run(req(paths.read, "GET"), async () =>
        orderTestResponse(orderTestRead, 200, {
          "x-csrf-token": orderTestCsrf,
          "content-length": "33554433",
        }),
      )
    ).status,
  ).toBe(503);
  let cancelled = false,
    pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(8192).fill(32));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await run(
    req(paths.bootstrap),
    async () =>
      new Response(stream, {
        headers: {
          "content-type": "application/json",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          "x-robots-tag": "noindex, nofollow",
        },
      }),
  );
  expect(response.status).toBe(503);
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThanOrEqual(4);
});

test("an already-aborted inbound request never contacts the upstream", async () => {
  const abort = new AbortController();
  abort.abort();
  const incoming = new Request(req(paths.read, "GET"), {
    signal: abort.signal,
  });
  const fetcher = vi.fn<typeof fetch>(async () =>
    orderTestResponse(orderTestRead, 200, { "x-csrf-token": orderTestCsrf }),
  );
  expect((await run(incoming, fetcher)).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});

test("locate forwards only the order cookie and returns no credential", async () => {
  const located = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "LOCATED",
    publicOrderId: orderTestId,
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    orderTestResponse(located, 200),
  );
  const response = await run(
    req(paths.locate, "POST", { schemaVersion: 1, publicOrderNo: "FS-7K3M9C" }),
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(located);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("x-csrf-token")).toBeNull();
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe(internalApiOrigin + "/api/v1/order-access/locate");
  const headers = new Headers(init?.headers);
  expect(headers.get("cookie")).toBe(`__Host-fan-order=${orderTestToken}`);
  expect(headers.has("x-csrf-token")).toBe(false);
  for (const body of [
    { schemaVersion: 1, publicOrderNo: "fs-7k3m9c" },
    {
      schemaVersion: 1,
      publicOrderNo: "FS-7K3M9C",
      publicOrderId: orderTestId,
    },
  ]) {
    const rejected = vi.fn<typeof fetch>();
    expect((await run(req(paths.locate, "POST", body), rejected)).status).toBe(
      400,
    );
    expect(rejected).not.toHaveBeenCalled();
  }
  for (const forged of [
    orderTestResponse(located, 200, { "x-csrf-token": orderTestCsrf }),
    orderTestResponse(located, 200, { "set-cookie": orderTestCookie }),
    orderTestResponse(orderTestRead, 200, { "x-csrf-token": orderTestCsrf }),
  ])
    expect(
      (
        await run(
          req(paths.locate, "POST", {
            schemaVersion: 1,
            publicOrderNo: "FS-7K3M9C",
          }),
          async () => forged,
        )
      ).status,
    ).toBe(503);
});
