import { NextRequest } from "next/server";
import { afterEach, expect, test, vi } from "vitest";
import { proxy } from "./proxy";
afterEach(() => vi.unstubAllEnvs());
test("checkout and return HTML, locale redirects and BFF failures are always private and non-referring", async () => {
  for (const path of [
    "/ja/checkout",
    "/ja/checkout/return?session=test&attempt=test",
    "/ZH-cn/checkout/return?session=test",
    "/api/storefront/checkout/current/status",
    "/api/storefront/cart/validate",
    "/zh-CN/order-access",
    "/en/orders/lookup",
    "/ja/orders/10000000-0000-4000-8000-000000000001",
    "/pt/thank-you/10000000-0000-4000-8000-000000000001",
    "/api/storefront/order-access/exchange",
    "/api/storefront/orders/10000000-0000-4000-8000-000000000001",
  ]) {
    const response = await proxy(
      new NextRequest("https://shop.example.invalid" + path),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  }
  expect(
    (
      await proxy(new NextRequest("https://shop.example.invalid/ja/gifts"))
    ).headers.get("cache-control"),
  ).toBeNull();
});
test("payment frame CSP permits only exact configured HTTPS origins; malformed configuration allows none", async () => {
  vi.stubEnv(
    "FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON",
    JSON.stringify(["https://payments.example.invalid:9443"]),
  );
  const request = new NextRequest("https://shop.example.invalid/en/checkout");
  const policy = (await proxy(request)).headers.get("content-security-policy");
  expect(policy).toContain("frame-src https://payments.example.invalid:9443;");
  expect(policy).toContain("form-action 'self'");
  expect(policy).not.toContain("*");
  for (const value of [
    '["https://payments.example.invalid/path"]',
    '["http://localhost:3000"]',
    '["https://payments.example.invalid; script-src *"]',
    "{}",
  ]) {
    vi.stubEnv("FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON", value);
    expect(
      (await proxy(request)).headers.get("content-security-policy"),
    ).toContain("frame-src 'none';");
  }
});

test("order pages allow no third-party scripts or frames, and strip forged early-entry request headers", async () => {
  const entry = await proxy(
    new NextRequest("https://shop.example.invalid/en/order-access"),
  );
  expect(entry.headers.get("content-security-policy")).toContain(
    "script-src 'self' 'unsafe-inline';",
  );
  expect(entry.headers.get("content-security-policy")).not.toContain(
    "unsafe-eval",
  );
  expect(entry.headers.get("content-security-policy")).toContain(
    "frame-src 'none'",
  );
  expect(
    entry.headers.get("x-middleware-request-x-storefront-order-access"),
  ).toBe("1");
  const other = await proxy(
    new NextRequest("https://shop.example.invalid/en/gifts", {
      headers: { "x-storefront-order-access": "1" },
    }),
  );
  expect(
    other.headers.get("x-middleware-request-x-storefront-order-access"),
  ).toBeNull();
});

test("only a development server lets React's debugging eval() run on order pages", async () => {
  vi.stubEnv("NODE_ENV", "development");
  try {
    const policy = (
      await proxy(new NextRequest("https://shop.example.invalid/en/orders/abc"))
    ).headers.get("content-security-policy");
    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval';",
    );
    expect(policy).toContain("frame-src 'none'");
  } finally {
    vi.unstubAllEnvs();
  }
  expect(
    (
      await proxy(new NextRequest("https://shop.example.invalid/en/orders/abc"))
    ).headers.get("content-security-policy"),
  ).not.toContain("unsafe-eval");
});
