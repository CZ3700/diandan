import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { proxyCartRequest } from "./cart-proxy";

const siteOrigin = "https://shop.example.invalid";
const internalApiOrigin = "http://localhost:3002";
const token = "A".repeat(43);
const csrf = "B".repeat(43);
const cookie = `__Host-fan-cart=${token}`;
const body = {
  schemaVersion: 1,
  presentationLocale: "en",
  market: "TEST",
  currency: "USD",
};
const cart = {
  schemaVersion: 1,
  kind: "CART_RUNTIME",
  version: 1,
  status: "ACTIVE",
  presentationLocale: "en",
  market: "TEST",
  currency: "USD",
  expiresAt: "2099-01-01T00:00:00Z",
  items: [],
};
test("fixed public proxy headers allow a Next internal URL without bypassing first-visit or Origin checks", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => upstream());
  const headers = {
    host: "shop.example.invalid",
    "x-forwarded-host": "shop.example.invalid",
    "x-forwarded-proto": "https",
  };
  const incoming = (extra: Record<string, string> = {}) =>
    new Request(
      "https://next.internal:3100/api/storefront/cart?presentationLocale=en",
      {
        headers: { ...headers, ...extra },
      },
    );
  const absent = await run(incoming(), fetcher);
  expect(absent.status).toBe(404);
  expect(await absent.json()).toMatchObject({ code: "CART_NOT_FOUND" });
  expect(fetcher).not.toHaveBeenCalled();
  expect((await run(incoming({ cookie }), fetcher)).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (const extra of [
    { host: "attacker.invalid" },
    { "x-forwarded-host": "shop.example.invalid, attacker.invalid" },
    { "x-forwarded-proto": "http" },
    { origin: "https://attacker.invalid" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    const response = await run(incoming({ cookie, ...extra }), fetcher);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "INVALID_ACCESS" });
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("only an absent cookie on first read is a missing cart; an invalid existing cookie is never reset", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => upstream());
  const first = await run(
    request("GET", "?presentationLocale=en", { cookie: "unrelated=private" }),
    fetcher,
  );
  expect(first.status).toBe(404);
  expect(await first.json()).toMatchObject({ code: "CART_NOT_FOUND" });
  const malformed = await run(
    request("GET", "?presentationLocale=en", {
      cookie: "__Host-fan-cart=invalid",
    }),
    fetcher,
  );
  expect(malformed.status).toBe(401);
  expect(await malformed.json()).toMatchObject({ code: "INVALID_ACCESS" });
  expect(fetcher).not.toHaveBeenCalled();
});
test("after dispatch a mutation transport failure is explicitly uncertain, while editor read failure is temporary", async () => {
  const itemId = "10000000-0000-4000-8000-000000000001";
  const body = {
    schemaVersion: 1,
    presentationLocale: "en",
    expectedCartVersion: 2,
    expectedItemVersion: 1,
  };
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("do-not-log-private-data");
  });
  for (const method of ["PATCH", "DELETE", "POST"]) {
    const response = await run(
      request(
        method,
        `/items/${itemId}${method === "POST" ? "/editor" : ""}`,
        { "x-csrf-token": csrf, "idempotency-key": "proxy-uncertain-edit-001" },
        method === "PATCH"
          ? {
              ...body,
              change: {
                kind: "QUANTITY",
                quantity: 2,
                observedPriceId: itemId,
              },
            }
          : body,
      ),
      fetcher,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code:
        method === "POST"
          ? "TEMPORARY_UNAVAILABLE"
          : "TRANSACTION_OUTCOME_UNKNOWN",
    });
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
});
function upstream(action = "READ", overrides: Record<string, unknown> = {}) {
  return Response.json(
    { schemaVersion: 1, outcome: "SUCCESS", action, cart, ...overrides },
    { headers: { "cache-control": "private, no-store", "x-csrf-token": csrf } },
  );
}
function request(
  method = "GET",
  suffix = "?presentationLocale=en",
  headers: Record<string, string> = {},
  payload: unknown = body,
) {
  return new Request(`${siteOrigin}/api/storefront/cart${suffix}`, {
    method,
    headers: {
      origin: siteOrigin,
      cookie: `${cookie}; unrelated=private`,
      ...(method !== "GET" ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(method !== "GET" ? { body: JSON.stringify(payload) } : {}),
  });
}
function run(req: Request, fetcher: typeof fetch) {
  return proxyCartRequest(req, { siteOrigin, internalApiOrigin, fetcher });
}
test("same-origin cart read forwards only the cart session and returns a strictly private safe view", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => upstream());
  const response = await run(
    request("GET", "?presentationLocale=en", {
      authorization: "Bearer unrelated",
      "x-forwarded-host": "untrusted.invalid",
    }),
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ action: "READ", cart });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("x-csrf-token")).toBe(csrf);
  expect(String(fetcher.mock.calls[0]![0])).toBe(
    `${internalApiOrigin}/api/v1/cart?presentationLocale=en`,
  );
  const init = fetcher.mock.calls[0]![1]!;
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
test("initialization relays the validated host-only cookie without exposing credentials in JSON", async () => {
  const setCookie = `${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 2099 00:00:00 GMT`;
  const fetcher = vi.fn<typeof fetch>(async () => {
    const result = upstream("INITIALIZED");
    result.headers.set("set-cookie", setCookie);
    return result;
  });
  const response = await run(
    request("POST", "", { cookie: "unrelated=private" }),
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBe(setCookie);
  expect(await response.text()).not.toContain(token);
  expect(String(fetcher.mock.calls[0]![0])).toBe(
    `${internalApiOrigin}/api/v1/carts`,
  );
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(body);
});
test("invalid Origin, path, duplicate cookie/query, CSRF and body are rejected before upstream", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => upstream());
  for (const req of [
    request("POST", "", { origin: "https://other.example.invalid" }),
    request("POST", "", { origin: "" }),
    request("GET", "?presentationLocale=en", {
      "sec-fetch-site": "cross-site",
    }),
    request("GET", "?presentationLocale=en", {
      cookie: `${cookie}; ${cookie}`,
    }),
    request("GET", "?presentationLocale=en&presentationLocale=ja"),
    request("GET", "?presentationLocale=en&cartId=private"),
    request("POST", "/items", {}, { ...body, operation: "ADD_CART_ITEM" }),
    request("POST", "", {}, { ...body, csrfToken: "untrusted" }),
    new Request(`${siteOrigin}/api/storefront/cart/../../anything`),
  ])
    expect((await run(req, fetcher)).status).toBeGreaterThanOrEqual(400);
  expect(fetcher).not.toHaveBeenCalled();
});
test("unvalidated private fields, redirect/error status, public caching and unsafe cookie cannot cross the proxy", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const response of [
    upstream("READ", { fanMessage: "private-canary" }),
    upstream("INITIALIZED"),
    new Response(null, {
      status: 302,
      headers: { location: "https://untrusted.invalid" },
    }),
    Response.json(
      { schemaVersion: 1, outcome: "SUCCESS", action: "READ", cart },
      { status: 409 },
    ),
    Response.json(
      { schemaVersion: 1, outcome: "SUCCESS", action: "READ", cart },
      {
        headers: {
          "cache-control": "public, max-age=60",
          "x-csrf-token": csrf,
        },
      },
    ),
  ]) {
    fetcher.mockResolvedValueOnce(response);
    const result = await run(request(), fetcher);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private-canary");
    expect(result.headers.get("set-cookie")).toBeNull();
  }
  const unsafe = upstream("INITIALIZED");
  unsafe.headers.set(
    "set-cookie",
    `${cookie}; Path=/; Domain=example.invalid; HttpOnly; Secure; SameSite=Lax`,
  );
  fetcher.mockResolvedValueOnce(unsafe);
  expect((await run(request("POST", ""), fetcher)).status).toBe(503);
  fetcher.mockRejectedValueOnce(new Error("private-canary"));
  expect(await (await run(request(), fetcher)).text()).not.toContain(
    "private-canary",
  );
});
test("expired cart clears only the host cart cookie and preserves typed failure without a retry", async () => {
  const clear =
    "__Host-fan-cart=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "CART_EXPIRED" },
      {
        status: 409,
        headers: { "cache-control": "private, no-store", "set-cookie": clear },
      },
    ),
  );
  const response = await run(request(), fetcher);
  expect(response.status).toBe(409);
  expect(response.headers.get("set-cookie")).toBe(clear);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("explicit private editor is cookie-bound and cannot escape into ordinary cart or mutation responses", async () => {
  const itemId = "10000000-0000-4000-8000-000000000001";
  const edit = {
    schemaVersion: 1,
    expectedCartVersion: 2,
    expectedItemVersion: 1,
    presentationLocale: "en",
  };
  const content = {
    displayMode: "nickname",
    fanMessageLocale: "ja",
    displayName: String.fromCodePoint(0x540d),
    fanMessage: String.fromCodePoint(0x79c1),
  };
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "EDITOR_READ",
    cartItemId: itemId,
    cartVersion: 2,
    itemVersion: 1,
    content,
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(value, {
      headers: { "cache-control": "private, no-store", "x-csrf-token": csrf },
    }),
  );
  const response = await run(
    request("POST", `/items/${itemId}/editor`, { "x-csrf-token": csrf }, edit),
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(value);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(String(fetcher.mock.calls[0]![0])).toBe(
    `${internalApiOrigin}/api/v1/cart/items/${itemId}/editor`,
  );
  expect(
    new Headers(fetcher.mock.calls[0]![1]!.headers).get("x-csrf-token"),
  ).toBe(csrf);
  expect((await run(request(), fetcher)).status).toBe(503);
  expect(
    (await run(request("POST", `/items/${itemId}/editor`, {}, edit), fetcher))
      .status,
  ).toBe(403);
  expect(
    (
      await run(
        request(
          "POST",
          `/items/${itemId}/editor`,
          { "x-csrf-token": csrf },
          { ...edit, itemId },
        ),
        fetcher,
      )
    ).status,
  ).toBe(400);
  for (const override of [
    { cartItemId: "10000000-0000-4000-8000-000000000002" },
    { cartVersion: 3 },
    { itemVersion: 2 },
  ]) {
    fetcher.mockResolvedValueOnce(
      Response.json(
        { ...value, ...override },
        {
          headers: {
            "cache-control": "private, no-store",
            "x-csrf-token": csrf,
          },
        },
      ),
    );
    expect(
      (
        await run(
          request(
            "POST",
            `/items/${itemId}/editor`,
            { "x-csrf-token": csrf },
            edit,
          ),
          fetcher,
        )
      ).status,
    ).toBe(503);
  }
});
test("mutation paths keep optimistic versions and idempotency, and removed-add replay stays a permanent conflict", async () => {
  const itemId = "10000000-0000-4000-8000-000000000001";
  const edit = {
    schemaVersion: 1,
    expectedCartVersion: 2,
    expectedItemVersion: 1,
    presentationLocale: "en",
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "VERSION_CONFLICT" },
      { status: 409, headers: { "cache-control": "private, no-store" } },
    ),
  );
  for (const method of ["PATCH", "DELETE"]) {
    const payload =
      method === "PATCH"
        ? {
            ...edit,
            change: { kind: "QUANTITY", quantity: 3, observedPriceId: itemId },
          }
        : edit;
    const headers = {
      "x-csrf-token": csrf,
      "idempotency-key": "cart-proxy-edit-0001",
    };
    const response = await run(
      request(method, `/items/${itemId}`, headers, payload),
      fetcher,
    );
    expect(response.status).toBe(409);
    expect(fetcher.mock.lastCall?.[1]?.method).toBe(method);
    expect(JSON.parse(fetcher.mock.lastCall![1]!.body as string)).toEqual(
      payload,
    );
    expect(
      new Headers(fetcher.mock.lastCall![1]!.headers).get("idempotency-key"),
    ).toBe(headers["idempotency-key"]);
    expect(
      (
        await run(
          request(
            method,
            `/items/${itemId}`,
            { "x-csrf-token": csrf },
            payload,
          ),
          fetcher,
        )
      ).status,
    ).toBe(400);
  }
  fetcher.mockResolvedValueOnce(
    Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "CART_ITEM_REMOVED" },
      { status: 409, headers: { "cache-control": "private, no-store" } },
    ),
  );
  expect((await run(request(), fetcher)).status).toBe(409);
});
test("failure responses cannot set a new session, and oversized or malformed bodies cannot leak upstream", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "TEMPORARY_UNAVAILABLE" },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store",
          "set-cookie": `${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 2099 00:00:00 GMT`,
        },
      },
    ),
  );
  const response = await run(request("POST", ""), fetcher);
  expect(response.headers.get("set-cookie")).toBeNull();
  fetcher.mockClear();
  expect(
    (
      await run(
        request("POST", "", {}, { ...body, extra: "x".repeat(8192) }),
        fetcher,
      )
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
