import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

test("information preview shares the restricted frame, no-RUM and no-store boundary", async () => {
  vi.stubEnv("FAN_SUPPORT_ADMIN_ORIGIN", "https://admin.example.invalid");
  try {
    const response = await proxy(
      new NextRequest(
        "https://shop.example.invalid/zh-CN/information-preview?channel=a0000000-0000-4000-8000-000000000001&page=faq",
      ),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors https://admin.example.invalid",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts allow-same-origin",
    );
    expect(
      response.headers.get("x-middleware-request-x-storefront-layout-preview"),
    ).toBe("1");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("invalid information preview queries are rejected before page streaming", async () => {
  vi.stubEnv("FAN_SUPPORT_ADMIN_ORIGIN", "https://admin.example.invalid");
  try {
    const query = "channel=a0000000-0000-4000-8000-000000000001&page=faq";
    for (const suffix of [
      "",
      "?channel=bad&page=faq",
      `?${query}&revisionId=private`,
      `?${query}&page=about`,
      `?${query.replace("page=faq", "page=arbitrary")}`,
    ]) {
      const response = await proxy(
        new NextRequest(
          `https://shop.example.invalid/en/information-preview${suffix}`,
        ),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  } finally {
    vi.unstubAllEnvs();
  }
});
