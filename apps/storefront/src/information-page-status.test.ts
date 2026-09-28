import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("./server/public-information-pages", () => ({
  readPublicInformationPage: read,
}));
vi.mock("./server/storefront-copy", () => ({
  loadStorefrontCopy: async () => ({
    notFound: "Missing",
    contentError: "Unavailable",
    contentErrorBody: "Try again later",
    navHome: "Home",
    artistRetry: "Try again",
  }),
}));
import { proxy } from "./proxy";
test("public information absence and read failures terminate before streaming with real HTTP status", async () => {
  for (const [code, status] of [
    ["NOT_FOUND", 404],
    ["CONTENT_UNAVAILABLE", 503],
  ] as const) {
    read.mockResolvedValueOnce({ schemaVersion: 1, outcome: "FAILURE", code });
    const response = await proxy(
      new NextRequest("https://shop.example.invalid/en/about"),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-language")).toBe("en");
    if (status === 503)
      expect(await response.text()).toContain('href="/en/about">Try again</a>');
  }
  read.mockResolvedValueOnce({
    outcome: "SUCCESS",
    fallbackUsed: true,
    resolvedLocale: "en",
  });
  const fallback = await proxy(
    new NextRequest("https://shop.example.invalid/ja/about"),
  );
  expect(fallback.status).toBe(200);
  expect(fallback.headers.get("x-robots-tag")).toBe("noindex, nofollow");
});
