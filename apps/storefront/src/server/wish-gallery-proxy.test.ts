import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const page = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  page: { schemaVersion: 1, entries: [], nextCursor: null },
} as const;
const read = vi.fn().mockResolvedValue(page);
vi.mock("./public-wish-gallery", () => ({
  readWishGallery: (input: unknown) => read(input),
}));
test("gallery BFF maps only valid bounded public query data and drops request authority", async () => {
  const loaded = await import("./wish-gallery-proxy").catch(() => null);
  expect(loaded?.handleWishGalleryRequest).toBeTypeOf("function");
  if (!loaded) return;
  const response = await loaded.handleWishGalleryRequest(
    new Request(
      "https://shop.invalid/api/storefront/wish-gallery?locale=en&limit=12",
      { headers: { cookie: "private=value", authorization: "hidden" } },
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(page);
  expect(read).toHaveBeenCalledWith({
    schemaVersion: 1,
    locale: "en",
    limit: 12,
  });
  for (const query of [
    "locale=en&locale=ja",
    "locale=en&limit=0",
    "locale=en&limit=01",
    "locale=en&privateName=secret",
  ]) {
    expect(
      (
        await loaded.handleWishGalleryRequest(
          new Request(
            `https://shop.invalid/api/storefront/wish-gallery?${query}`,
          ),
        )
      ).status,
    ).toBe(400);
  }
  expect(read).toHaveBeenCalledTimes(1);
});
