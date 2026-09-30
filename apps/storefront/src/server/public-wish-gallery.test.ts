import { describe, expect, it, vi } from "vitest";
import { wishGalleryReadResponseSchema } from "@fan-support/contracts";
import { fetchWishGallery } from "./public-wish-gallery";
vi.mock("server-only", () => ({}));
const command = { schemaVersion: 1, locale: "en", limit: 20 };
const success = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  page: { schemaVersion: 1, entries: [], nextCursor: null },
};
describe("public wish gallery read", () => {
  it("reads without cookies or caches so a withdrawn entry disappears immediately", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(success, { headers: { "cache-control": "no-store" } }),
      );
    expect(
      await fetchWishGallery("https://api.example.test", command, fetcher),
    ).toEqual(success);
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/storefront/wish-gallery?locale=en&limit=20",
    );
  });
  it("rejects invalid input before network access", async () => {
    const fetcher = vi.fn();
    expect(
      await fetchWishGallery(
        "https://api.example.test",
        { ...command, idolId: "not-an-id" },
        fetcher,
      ),
    ).toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [200, { ...success, secret: "private" }],
    [503, success],
    [200, { schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_DENIED" }],
  ])(
    "fails closed for an unsafe or mismatched response (%s)",
    async (status, body) => {
      const fetcher = vi.fn().mockResolvedValue(
        Response.json(body, {
          status,
          headers: { "cache-control": "no-store" },
        }),
      );
      expect(
        await fetchWishGallery("https://api.example.test", command, fetcher),
      ).toMatchObject({ outcome: "FAILURE", code: "TEMPORARY_UNAVAILABLE" });
    },
  );
});
it("rejects cacheable gallery responses because withdrawn consent must take effect", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(success));
  expect(
    await fetchWishGallery("https://api.example.test", command, fetcher),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
});
it("bounds unexpected gallery bodies", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(success) + " ".repeat(2 * 1024 * 1024), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }),
  );
  expect(
    await fetchWishGallery("https://api.example.test", command, fetcher),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
});
it("preserves an explicitly rate limited response", async () => {
  const result = { schemaVersion: 1, outcome: "FAILURE", code: "RATE_LIMITED" };
  const fetcher = vi.fn().mockResolvedValue(
    Response.json(result, {
      status: 429,
      headers: { "cache-control": "no-store" },
    }),
  );
  expect(
    await fetchWishGallery("https://api.example.test", command, fetcher),
  ).toEqual(result);
});

it("accepts a full legal page with long localized media snapshots", async () => {
  const longUrl =
    "https://cdn.example.test/" +
    "a".repeat(8192 - "https://cdn.example.test/".length);
  const page = wishGalleryReadResponseSchema.parse({
    ...success,
    page: {
      schemaVersion: 1,
      nextCursor: null,
      entries: Array.from({ length: 50 }, (_, index) => ({
        entryId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        idol: {
          handle: "artist",
          displayName: "星".repeat(80),
          locale: "zh-CN",
          portrait: { url: longUrl, alt: "星".repeat(500), locale: "zh-CN" },
        },
        gift: {
          title: "願".repeat(320),
          locale: "ja",
          image: { url: longUrl, alt: "願".repeat(500), locale: "ja" },
        },
        supportedAt: "2026-10-01T00:00:00.000Z",
        supporter: { kind: "NAMED", alias: "星".repeat(40) },
      })),
    },
  });
  expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeGreaterThan(
    1024 * 1024,
  );
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json(page, { headers: { "cache-control": "no-store" } }),
    );
  expect(
    await fetchWishGallery(
      "https://api.example.test",
      { ...command, limit: 50 },
      fetcher,
    ),
  ).toEqual(page);
});
