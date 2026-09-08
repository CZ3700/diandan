import { expect, it, vi } from "vitest";
import { idolIdSchema } from "@fan-support/contracts";
import { directoryFixturePage } from "./directory-fixture";

it("accepts a declared published original while preserving the requested route locale", async () => {
  const { requestArtistDirectory } = await import("./directory-request");
  const page = directoryFixturePage([1]);
  if (page.outcome !== "SUCCESS") throw new Error("Expected directory fixture");
  const original = {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      localeContext: {
        schemaVersion: 2,
        publicationMode: "DIRECT_OPERATOR_V1",
        sourceLocale: "zh-CN",
        requestedLocale: "en",
        resolvedLocale: "zh-CN",
        fallbackUsed: true,
        translationRevision: "cc000000-0000-4000-8000-000000000001",
      },
    })),
  };
  const response = await requestArtistDirectory(
    { schemaVersion: 1, locale: "en", limit: 12 },
    new AbortController().signal,
    async () => Response.json(original),
  );
  expect(response.outcome).toBe("SUCCESS");
});

it("parses only bounded canonical directory requests and safe failure bodies", async () => {
  const loaded = await import("./directory-request").catch(() => undefined);
  expect(loaded, "public directory transport must exist").toBeDefined();
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CATALOG_CHANGED",
        }),
        { status: 409 },
      ),
  );
  const response = await loaded!.requestArtistDirectory(
    {
      schemaVersion: 1,
      locale: "ja",
      limit: 12,
      anchorId: idolIdSchema.parse("a0000000-0000-4000-8000-000000000100"),
    },
    new AbortController().signal,
    request,
  );
  expect(response).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_CHANGED",
  });
  expect(request.mock.calls[0]?.[0]).toBe(
    "/api/storefront/idols?locale=ja&limit=12&anchorId=a0000000-0000-4000-8000-000000000100",
  );
  expect(request.mock.calls[0]?.[1]).toMatchObject({
    cache: "no-store",
    credentials: "same-origin",
  });
});

it("returns safe unavailable failures for invalid JSON", async () => {
  const loaded = await import("./directory-request").catch(() => undefined);
  expect(loaded, "public directory transport must exist").toBeDefined();
  const response = await loaded!.requestArtistDirectory(
    { schemaVersion: 1, locale: "en", limit: 12 },
    new AbortController().signal,
    async () => new Response("provider stack trace", { status: 503 }),
  );
  expect(response).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
});

it("rejects a different locale and a response exceeding the requested result window", async () => {
  const loaded = await import("./directory-request");
  const foreign = await loaded.requestArtistDirectory(
    { schemaVersion: 1, locale: "ja", limit: 12 },
    new AbortController().signal,
    async () => Response.json(directoryFixturePage([1])),
  );
  expect(foreign).toMatchObject({
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
  const excessive = await loaded.requestArtistDirectory(
    { schemaVersion: 1, locale: "en", limit: 1 },
    new AbortController().signal,
    async () => Response.json(directoryFixturePage([1, 2])),
  );
  expect(excessive).toMatchObject({
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
});

it("keeps full query validation before fetch and supplies the schema's default window", async () => {
  const { requestArtistDirectory } = await import("./directory-request");
  const request = vi.fn<typeof fetch>(async () =>
    Response.json(directoryFixturePage([])),
  );
  const signal = new AbortController().signal;
  for (const query of [
    { schemaVersion: 1, locale: "en", limit: 41 },
    { schemaVersion: 1, locale: "en", limit: 12, q: "a\u200fb" },
    { schemaVersion: 1, locale: "en", limit: 12, anchorId: "not-an-id" },
    {
      schemaVersion: 1,
      locale: "en",
      limit: 12,
      after: "cursor",
      anchorId: "a0000000-0000-4000-8000-000000000001",
    },
    { schemaVersion: 1, locale: "en", limit: 12, unexpected: "private" },
  ]) {
    await expect(
      requestArtistDirectory(
        query as Parameters<typeof requestArtistDirectory>[0],
        signal,
        request,
      ),
    ).resolves.toMatchObject({ outcome: "FAILURE", code: "INVALID_QUERY" });
  }
  expect(request).not.toHaveBeenCalled();
  await expect(
    requestArtistDirectory({ schemaVersion: 1, locale: "en" }, signal, request),
  ).resolves.toMatchObject({ outcome: "SUCCESS" });
  expect(request.mock.calls[0]?.[0]).toBe(
    "/api/storefront/idols?locale=en&limit=12",
  );
});

it("validates both Unicode input and full network DTOs through the deferred search path", async () => {
  const { requestArtistSearch } = await import("./directory-request");
  const request = vi.fn<typeof fetch>(async () =>
    Response.json(directoryFixturePage([1])),
  );
  const signal = new AbortController().signal;
  for (const raw of ["a".repeat(81), "a\u200fb"])
    await expect(
      requestArtistSearch(raw, "en", signal, request),
    ).resolves.toEqual({ kind: "invalid" });
  expect(request).not.toHaveBeenCalled();
  const result = await requestArtistSearch(
    "  Điện 日本  ",
    "en",
    signal,
    request,
  );
  expect(result).toMatchObject({
    kind: "response",
    response: { outcome: "SUCCESS" },
  });
  expect(request.mock.calls[0]?.[0]).toBe(
    "/api/storefront/idols?locale=en&limit=6&q=%C4%90i%E1%BB%87n+%E6%97%A5%E6%9C%AC",
  );
  const original = directoryFixturePage([1]);
  if (original.outcome !== "SUCCESS") throw new Error("Invalid fixture");
  for (const item of [
    { ...original.items[0], id: "not-an-id" },
    { ...original.items[0], privateNote: "must not cross this boundary" },
    {
      ...original.items[0],
      portrait: { ...original.items[0]!.portrait, width: 0 },
    },
    {
      ...original.items[0],
      localeContext: {
        schemaVersion: 1,
        requestedLocale: "ja",
        resolvedLocale: "ja",
        fallbackUsed: false,
      },
    },
  ]) {
    await expect(
      requestArtistSearch("artist", "en", signal, async () =>
        Response.json({ ...original, items: [item] }),
      ),
    ).resolves.toMatchObject({
      kind: "response",
      response: { outcome: "FAILURE", code: "CATALOG_UNAVAILABLE" },
    });
  }
});
