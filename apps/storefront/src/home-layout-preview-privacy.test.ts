import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

test("layout preview is no-store, noindex, embedded only by the configured operator origin and cannot submit forms", () => {
  vi.stubEnv("FAN_SUPPORT_ADMIN_ORIGIN", "https://admin.example.invalid");
  const response = proxy(
    new NextRequest("https://shop.example.invalid/en/layout-preview"),
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("content-security-policy")).toContain(
    "frame-ancestors https://admin.example.invalid",
  );
  expect(response.headers.get("content-security-policy")).toContain(
    "form-action 'none'",
  );
  expect(
    response.headers.get("x-middleware-request-x-storefront-layout-preview"),
  ).toBe("1");
  const publicPage = proxy(
    new NextRequest("https://shop.example.invalid/en", {
      headers: { "x-storefront-layout-preview": "1" },
    }),
  );
  expect(
    publicPage.headers.get("x-middleware-request-x-storefront-layout-preview"),
  ).toBeNull();
  vi.unstubAllEnvs();
});
