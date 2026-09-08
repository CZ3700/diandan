import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { proxyCheckoutRequest } from "./checkout-proxy";
const siteOrigin = "https://shop.example.invalid",
  internalApiOrigin = "http://localhost:3002",
  providerOrigin = "https://payments.example.invalid";
const id = "10000000-0000-4000-8000-000000000001",
  aid = "10000000-0000-4000-8000-000000000002";
const csrf = "B".repeat(43),
  cookie = `__Host-fan-cart=${"A".repeat(43)}`;
const current = "/checkout/current/status";
const createPath = `/checkout/sessions/${id}/attempts`;
const readPath = createPath + `/${aid}`;
const create = {
  schemaVersion: 1,
  capabilityId: id,
  country: "US",
  configVersion: 1,
  ruleVersion: 1,
  supportedActionTypes: ["REDIRECT"],
};
const attempt = {
  schemaVersion: 1,
  checkoutSessionId: id,
  id: aid,
  version: 2,
  environment: "TEST",
  status: "REQUIRES_ACTION",
  requestedLocale: "ja",
  providerLocale: "en",
  providerLocaleFallbackUsed: true,
  recovery: "NONE",
  canRetry: false,
  action: {
    schemaVersion: 1,
    type: "REDIRECT",
    url: providerOrigin + "/continue/test",
  },
  actionExpiresAt: "2099-01-01T00:00:00Z",
  actionExpired: false,
  updatedAt: "2026-09-09T00:00:00Z",
};
function req(
  path = current,
  method = "GET",
  body: unknown = create,
  headers: Record<string, string> = {},
) {
  return new Request(siteOrigin + "/api/storefront" + path, {
    method,
    headers: {
      origin: siteOrigin,
      cookie: cookie + "; unrelated=private",
      ...(method === "POST"
        ? {
            "content-type": "application/json",
            "x-csrf-token": csrf,
            "idempotency-key": "payment-checkout-proxy-0001",
          }
        : {}),
      ...headers,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
function upstream(
  value: unknown = { schemaVersion: 1, outcome: "SUCCESS", action: "EMPTY" },
  status = 200,
) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store", "x-csrf-token": csrf },
  });
}
const run = (request: Request, fetcher: typeof fetch) =>
  proxyCheckoutRequest(request, {
    siteOrigin,
    internalApiOrigin,
    actionOrigins: [providerOrigin],
    fetcher,
  });
test("fixed proxy origin works for current reads and payment writes while credentials and Origin remain required", async () => {
  const headers = {
    host: "shop.example.invalid",
    "x-forwarded-host": "shop.example.invalid",
    "x-forwarded-proto": "https",
    cookie,
  };
  const fetcher = vi.fn<typeof fetch>(async () => upstream());
  const incoming = (
    path: string,
    method = "GET",
    extra: Record<string, string> = {},
  ) =>
    new Request("https://next.internal:3100/api/storefront" + path, {
      method,
      headers: {
        ...headers,
        ...(method === "POST"
          ? {
              origin: siteOrigin,
              "content-type": "application/json",
              "x-csrf-token": csrf,
              "idempotency-key": "payment-checkout-proxy-0001",
            }
          : {}),
        ...extra,
      },
      ...(method === "POST" ? { body: JSON.stringify(create) } : {}),
    });
  expect((await run(incoming(current), fetcher)).status).toBe(200);
  fetcher.mockImplementation(async () =>
    upstream({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CREATED",
      attempt,
    }),
  );
  expect((await run(incoming(createPath, "POST"), fetcher)).status).toBe(200);
  for (const extra of [
    { host: "attacker.invalid" },
    { "x-forwarded-host": "attacker.invalid" },
    { "x-forwarded-proto": "https, http" },
    { origin: "https://attacker.invalid" },
    { "sec-fetch-site": "cross-site" },
    { "x-csrf-token": "" },
    { cookie: "" },
  ]) {
    expect(
      (await run(incoming(createPath, "POST", extra), fetcher)).status,
    ).toBeGreaterThanOrEqual(400);
  }
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("current recovery read passes only the cart cookie and safe private response", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => upstream());
  const response = await run(
    req(current, "GET", undefined, {
      authorization: "unrelated",
      "x-forwarded-host": "untrusted.invalid",
    }),
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ action: "EMPTY" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-csrf-token")).toBe(csrf);
  expect(String(fetcher.mock.lastCall![0])).toBe(
    internalApiOrigin + "/api/v1" + current,
  );
  const init = fetcher.mock.lastCall![1]!;
  expect(init).toMatchObject({
    method: "GET",
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
  });
  const headers = new Headers(init.headers);
  expect(headers.get("cookie")).toBe(cookie);
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("x-forwarded-host")).toBeNull();
});
test("all P4-03 and P4-04 fixed routes preserve their exact validated wire commands", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    upstream(
      { schemaVersion: 1, outcome: "FAILURE", code: "VERSION_CONFLICT" },
      409,
    ),
  );
  const cases = [
    [
      "/cart/validate",
      "POST",
      { schemaVersion: 1, expectedCartVersion: 2, presentationLocale: "ja" },
    ],
    [
      "/checkout/sessions",
      "POST",
      {
        schemaVersion: 1,
        preflightId: id,
        expectedCartVersion: 2,
        email: ["checkout", "example.test"].join("@"),
        policyAcceptances: [
          {
            policyKey: "terms",
            policyRevisionId: id,
            policyTranslationRevisionId: id,
            accepted: true,
          },
        ],
      },
    ],
    [`/checkout/sessions/${id}/status`, "GET", undefined],
    [
      `/checkout/sessions/${id}/capabilities?presentationLocale=ja&country=US&supportedActionTypes=REDIRECT`,
      "GET",
      undefined,
    ],
    [createPath, "POST", create],
    [readPath, "GET", undefined],
    [readPath + "/recover", "POST", { schemaVersion: 1 }],
  ] as const;
  for (const [path, method, body] of cases) {
    const response = await run(req(path, method, body), fetcher);
    expect(response.status).toBe(409);
    expect(String(fetcher.mock.lastCall![0])).toBe(
      internalApiOrigin + "/api/v1" + path,
    );
    const init = fetcher.mock.lastCall![1]!;
    if (method === "POST") {
      expect(JSON.parse(init.body as string)).toEqual(body);
      expect(new Headers(init.headers).get("idempotency-key")).toBe(
        "payment-checkout-proxy-0001",
      );
    } else expect(init.body).toBeUndefined();
  }
});
test("invalid existing or absent credentials, routes, duplicate query, mutation input and headers never reach API", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => upstream());
  for (const request of [
    req(current, "GET", undefined, { cookie: "" }),
    req(current, "GET", undefined, { cookie: "__Host-fan-cart=invalid" }),
    req(current, "GET", undefined, { cookie: `${cookie}; ${cookie}` }),
    req(current, "GET", undefined, { origin: "https://other.invalid" }),
    req(current, "GET", undefined, { "sec-fetch-site": "cross-site" }),
    req(current + "?session=" + id),
    req("/checkout/anything"),
    req(
      `/checkout/sessions/${id}/capabilities?presentationLocale=ja&supportedActionTypes=REDIRECT&presentationLocale=en`,
    ),
    req(createPath, "POST", create, { "x-csrf-token": "" }),
    req(
      readPath + "/recover",
      "POST",
      { schemaVersion: 1 },
      { "idempotency-key": "" },
    ),
    req(createPath, "POST", { ...create, returnUrl: siteOrigin }),
    req(createPath, "POST", { ...create, amountMinor: 1 }),
  ])
    expect((await run(request, fetcher)).status).toBeGreaterThanOrEqual(400);
  expect(fetcher).not.toHaveBeenCalled();
});
test("mutation dispatch loss is uncertain; reads never create or recover, and failures do not leak", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("private-transport-canary");
  });
  for (const [path, method, body] of [
    [current, "GET", undefined],
    [createPath, "POST", create],
    [readPath + "/recover", "POST", { schemaVersion: 1 }],
  ] as const) {
    const response = await run(req(path, method, body), fetcher);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code:
        method === "POST"
          ? "TRANSACTION_OUTCOME_UNKNOWN"
          : "TEMPORARY_UNAVAILABLE",
    });
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
});
test("response schema, action, session, attempt and precise hosted origin are independently enforced", async () => {
  const fetcher = vi.fn<typeof fetch>();
  fetcher.mockResolvedValueOnce(
    upstream({ schemaVersion: 1, outcome: "SUCCESS", action: "READ", attempt }),
  );
  expect((await run(req(readPath), fetcher)).status).toBe(200);
  for (const change of [
    { id },
    { checkoutSessionId: aid },
    { email: "private-canary" },
    { action: { ...attempt.action, url: "https://evil.example.invalid/test" } },
  ]) {
    fetcher.mockResolvedValueOnce(
      upstream({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "READ",
        attempt: { ...attempt, ...change },
      }),
    );
    const response = await run(req(readPath), fetcher);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-canary");
  }
  for (const response of [
    upstream({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CREATED",
      attempt,
    }),
    new Response(null, { status: 302, headers: { location: providerOrigin } }),
    Response.json(
      { schemaVersion: 1, outcome: "SUCCESS", action: "EMPTY" },
      { headers: { "cache-control": "public,max-age=0" } },
    ),
  ]) {
    fetcher.mockResolvedValueOnce(response);
    expect((await run(req(readPath), fetcher)).status).toBe(503);
  }
});
test("only exact expiry clearing can cross Set-Cookie, never a new session", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const clear =
    "__Host-fan-cart=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  const expired = upstream(
    { schemaVersion: 1, outcome: "FAILURE", code: "CART_EXPIRED" },
    409,
  );
  expired.headers.set("set-cookie", clear);
  fetcher.mockResolvedValueOnce(expired);
  expect((await run(req(), fetcher)).headers.get("set-cookie")).toBe(clear);
  const unsafe = upstream();
  unsafe.headers.set(
    "set-cookie",
    cookie + "; Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  fetcher.mockResolvedValueOnce(unsafe);
  const response = await run(req(), fetcher);
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toBeNull();
});
