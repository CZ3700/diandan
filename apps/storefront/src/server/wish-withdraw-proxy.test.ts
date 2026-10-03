import { expect, test, vi } from "vitest";
import {
  orderTestId,
  otherOrderTestId,
  orderTestToken,
  orderTestCsrf,
  orderTestResponse,
} from "./order-test-support";
vi.mock("server-only", () => ({}));
const siteOrigin = "https://shop.example.invalid";
const internalApiOrigin = "http://localhost:3002";
const path = `/api/storefront/orders/${orderTestId}/wish-gallery/${otherOrderTestId}/withdraw`;
const value = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  withdrawn: { schemaVersion: 1, entryId: otherOrderTestId, withdrawn: true },
};
const request = (
  headers: Record<string, string> = {},
  body: unknown = { schemaVersion: 1 },
) =>
  new Request(siteOrigin + path, {
    method: "POST",
    headers: {
      origin: siteOrigin,
      "content-type": "application/json",
      cookie: `private=hidden; __Host-fan-order=${orderTestToken}`,
      "x-csrf-token": orderTestCsrf,
      ...headers,
    },
    body: JSON.stringify(body),
  });
test("wish withdrawal BFF uses the guarded order proxy and only forwards order authority", async () => {
  const loaded = await import("./wish-withdraw-proxy").catch(() => null);
  expect(loaded?.proxyWishWithdrawRequest).toBeTypeOf("function");
  if (!loaded) return;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => orderTestResponse(value));
  const result = await loaded.proxyWishWithdrawRequest(
    request({ authorization: "private" }),
    { siteOrigin, internalApiOrigin, fetcher },
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(value);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe(
    internalApiOrigin + path.replace("/api/storefront/", "/api/v1/"),
  );
  expect(new Headers(init?.headers).get("cookie")).toBe(
    `__Host-fan-order=${orderTestToken}`,
  );
  expect(new Headers(init?.headers).get("x-csrf-token")).toBe(orderTestCsrf);
  expect(new Headers(init?.headers).has("authorization")).toBe(false);
  for (const headers of [
    { origin: "https://other.invalid" },
    { cookie: "" },
    { "x-csrf-token": "" },
    { "sec-fetch-site": "same-site" },
    {
      cookie: `__Host-fan-order=${orderTestToken}; __Host-fan-order=${orderTestToken}`,
    },
  ]) {
    expect(
      (
        await loaded.proxyWishWithdrawRequest(request(headers), {
          siteOrigin,
          internalApiOrigin,
          fetcher,
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await loaded.proxyWishWithdrawRequest(
        request({}, { schemaVersion: 1, secret: "private" }),
        { siteOrigin, internalApiOrigin, fetcher },
      )
    ).status,
  ).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(
    orderTestResponse(value, 200, { "set-cookie": "secret=anything" }),
  );
  expect(
    (
      await loaded.proxyWishWithdrawRequest(request(), {
        siteOrigin,
        internalApiOrigin,
        fetcher,
      })
    ).status,
  ).toBe(503);
});
