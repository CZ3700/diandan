import { expect, test, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("../../../../server/public-catalog", () => ({
  readPublicCatalog: read,
}));

test("BFF keeps directory error semantics and never caches responses", async () => {
  const { GET } = await import("./route.js");
  const codes = {
    ANCHOR_NOT_FOUND: 404,
    CATALOG_CHANGED: 409,
    CATALOG_UNAVAILABLE: 503,
    INVALID_QUERY: 400,
    INVALID_CURSOR: 400,
  };
  for (const [code, status] of Object.entries(codes)) {
    read.mockResolvedValue({ schemaVersion: 1, outcome: "FAILURE", code });
    const response = await GET(
      new Request(
        "http://localhost/api/storefront/idols?locale=ja&anchorId=test",
      ),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    });
  }
});
