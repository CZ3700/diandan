import { NextRequest } from "next/server";
import { expect, test } from "vitest";

import { isCanonicalRequestId } from "@fan-support/observability";

type ProxyModule = Readonly<{
  proxy: (request: NextRequest) => Response;
}>;

async function loadProxyModule(): Promise<ProxyModule> {
  let loaded: unknown;
  try {
    loaded = await import("./proxy.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "storefront request ID proxy must exist").toBeDefined();
  return loaded as ProxyModule;
}

test("preserves a canonical request ID for the route and response", async () => {
  const { proxy } = await loadProxyModule();
  const requestId = "018f47a4-7b7c-4f27-8b35-25c984619a11";
  const response = proxy(
    new NextRequest("https://storefront.example.invalid/healthz", {
      headers: { "x-request-id": requestId },
    }),
  );

  expect(response.headers.get("x-request-id")).toBe(requestId);
  expect(response.headers.get("x-middleware-request-x-request-id")).toBe(
    requestId,
  );
});

test.each([
  undefined,
  "",
  "018F47A4-7B7C-4F27-8B35-25C984619A11",
  "018f47a4-7b7c-4f27-8b35-25c984619a11,other",
  "private-message-canary@example.invalid",
  "x".repeat(512),
])("replaces an untrusted proxy request ID %#", async (candidate) => {
  const { proxy } = await loadProxyModule();
  const headers = new Headers();
  if (candidate !== undefined) {
    headers.set("x-request-id", candidate);
  }

  const response = proxy(
    new NextRequest("https://storefront.example.invalid/healthz", { headers }),
  );
  const responseRequestId = response.headers.get("x-request-id");
  const forwardedRequestId = response.headers.get(
    "x-middleware-request-x-request-id",
  );

  expect(isCanonicalRequestId(responseRequestId)).toBe(true);
  expect(responseRequestId).toBe(forwardedRequestId);
  expect(responseRequestId).not.toBe(candidate);
});

test("redirects the root using only a validated site locale cookie and preserves query", async () => {
  const { proxy } = await loadProxyModule();
  const response = proxy(
    new NextRequest(
      "https://storefront.example.invalid/?market=TEST&currency=USD",
      { headers: { cookie: "site_locale=ja", "accept-language": "th" } },
    ),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://storefront.example.invalid/ja?market=TEST&currency=USD",
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
});
test("normalizes locale case only, and overwrites client-supplied locale headers", async () => {
  const { proxy } = await loadProxyModule();
  const normalized = proxy(
    new NextRequest(
      "https://storefront.example.invalid/ZH-cn/idols/someone?currency=USD",
    ),
  );
  expect(normalized.status).toBe(308);
  expect(normalized.headers.get("location")).toBe(
    "https://storefront.example.invalid/zh-CN/idols/someone?currency=USD",
  );
  const page = proxy(
    new NextRequest("https://storefront.example.invalid/vi/idols/someone", {
      headers: { "x-storefront-locale": "ja" },
    }),
  );
  expect(page.headers.get("x-middleware-request-x-storefront-locale")).toBe(
    "vi",
  );
  expect(page.headers.get("content-language")).toBe("vi");
});
