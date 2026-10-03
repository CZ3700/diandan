import Fastify from "fastify";
import { expect, test, vi } from "vitest";
const empty = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  page: { schemaVersion: 1, entries: [], nextCursor: null },
};
test("public gallery reads only the bounded allowlisted query and never caches", async () => {
  const module = await import("./wish-gallery-route.js").catch(() => null);
  expect(module?.registerWishGalleryRoute).toBeTypeOf("function");
  if (!module) return;
  const app = Fastify();
  const read = vi.fn().mockResolvedValue(empty);
  module.registerWishGalleryRoute(app, { read });
  try {
    const result = await app.inject({
      url: "/api/v1/storefront/wish-gallery?locale=en&idol=10000000-0000-4000-8000-000000000001&limit=20&cursor=abc",
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(empty);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(read).toHaveBeenCalledWith({
      schemaVersion: 1,
      locale: "en",
      idolId: "10000000-0000-4000-8000-000000000001",
      limit: 20,
      cursor: "abc",
    });
    for (const query of [
      "",
      "locale=en&locale=ja",
      "locale=en&limit=51",
      "locale=en&limit=01",
      "locale=en&privateName=secret",
      "locale=en&idol=no",
    ]) {
      expect(
        (await app.inject({ url: `/api/v1/storefront/wish-gallery?${query}` }))
          .statusCode,
      ).toBe(400);
    }
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce({ ...empty, privateName: "secret" });
    const invalid = await app.inject({
      url: "/api/v1/storefront/wish-gallery?locale=en",
    });
    expect(invalid.statusCode).toBe(503);
    expect(invalid.body).not.toContain("secret");
  } finally {
    await app.close();
  }
});
