import { expect, test, vi } from "vitest";
import { slugSchema } from "@fan-support/contracts";
vi.mock("server-only", () => ({}));
import { fetchStorefrontSeo } from "./storefront-seo";

test("SEO read sends only the canonical command to a fixed internal path", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" },
      { status: 404 },
    ),
  );
  expect(
    await fetchStorefrontSeo(
      "https://api.test",
      {
        schemaVersion: 1,
        operation: "ENTITY",
        locator: { kind: "IDOL", handle: slugSchema.parse("artist") },
      },
      fetcher,
    ),
  ).toMatchObject({ code: "NOT_FOUND" });
  const [url, options] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe(
    "https://api.test/api/v1/storefront-seo/entity?kind=IDOL&handle=artist",
  );
  expect(options).toMatchObject({
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  expect(options?.headers).toEqual({ accept: "application/json" });
});
test("malformed command, redirect, wrong operation and infrastructure failure never become an empty sitemap", async () => {
  const command = { schemaVersion: 1, operation: "CATALOG" } as const;
  const invalid = vi.fn<typeof fetch>();
  expect(
    await fetchStorefrontSeo(
      "https://api.test",
      { ...command, locale: "en-XA" } as typeof command,
      invalid,
    ),
  ).toMatchObject({ outcome: "FAILURE" });
  expect(invalid).not.toHaveBeenCalled();
  for (const fetcher of [
    vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: "https://other.test" },
        }),
    ),
    vi.fn<typeof fetch>(async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_INDEX",
        catalogVersion: "a".repeat(64),
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    ),
    vi.fn<typeof fetch>(async () => {
      throw new Error("PRIVATE_CONFIGURATION_CANARY");
    }),
  ])
    expect(
      await fetchStorefrontSeo("https://api.test", command, fetcher),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
});
test("bounded traversals reject empty continuation and a response for another cursor version", async () => {
  const cursor = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      operation: "CATALOG",
      catalogVersion: "a".repeat(64),
      afterKey: null,
    }),
  ).toString("base64url");
  for (const result of [
    {
      catalogVersion: "a".repeat(64),
      shards: [],
      pageInfo: { hasNextPage: true, endCursor: cursor },
    },
    {
      catalogVersion: "b".repeat(64),
      shards: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  ]) {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STOREFRONT_SEO_CATALOG",
        ...result,
      }),
    );
    expect(
      await fetchStorefrontSeo(
        "https://api.test",
        { schemaVersion: 1, operation: "CATALOG", cursor },
        fetcher,
      ),
    ).toMatchObject({ outcome: "FAILURE", code: "CONTENT_UNAVAILABLE" });
  }
});
