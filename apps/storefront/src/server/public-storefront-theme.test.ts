import { expect, test, vi } from "vitest";
import { createDefaultStorefrontTheme } from "@fan-support/contracts";
vi.mock("server-only", () => ({}));

test("theme reader accepts authoritative provenance without cookies and bounds decorative latency", async () => {
  const { fetchPublicStorefrontTheme } =
    await import("./public-storefront-theme");
  const timeout = vi.spyOn(AbortSignal, "timeout");
  try {
    const value = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STOREFRONT_THEME",
      source: "PUBLISHED",
      theme: createDefaultStorefrontTheme(),
      version: 4,
      publicationId: "731f5679-3b4d-4985-8cb2-266720ba8848",
    };
    const fetcher = vi.fn(async () => Response.json(value));
    expect(
      await fetchPublicStorefrontTheme("https://api.example.invalid", fetcher),
    ).toEqual(value);
    expect(fetcher.mock.calls[0]).toEqual([
      "https://api.example.invalid/api/v1/storefront/storefront-theme",
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      }),
    ]);
    expect(timeout).toHaveBeenCalledWith(1_000);
  } finally {
    timeout.mockRestore();
  }
});
test("unavailable, malformed and inconsistent theme reads are failures, never invented publications", async () => {
  const { fetchPublicStorefrontTheme } =
    await import("./public-storefront-theme");
  for (const fetcher of [
    async () => {
      throw new Error("offline");
    },
    async () => Response.json({ schemaVersion: 1, outcome: "SUCCESS" }),
    async () => new Response(null, { status: 404 }),
    async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_THEME",
        source: "DEFAULT",
        theme: createDefaultStorefrontTheme(),
        version: 7,
        publicationId: null,
      }),
  ])
    expect(
      await fetchPublicStorefrontTheme("https://api.example.invalid", fetcher),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
});
