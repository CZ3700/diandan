import { expect, it, vi } from "vitest";
import { idolIdSchema } from "@fan-support/contracts";
import { directoryFixturePage } from "./directory-fixture";

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
