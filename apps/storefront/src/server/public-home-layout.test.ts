import { expect, test, vi } from "vitest";
import { createDefaultHomeLayout } from "@fan-support/contracts";
vi.mock("server-only", () => ({}));

test("layout read accepts only an explicit default and omits browser credentials", async () => {
  const { fetchPublicHomeLayout } = await import("./public-home-layout");
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "HOME_LAYOUT",
    source: "DEFAULT",
    layout: createDefaultHomeLayout(),
    version: 0,
    publicationId: null,
  };
  const fetcher = vi.fn(async () => Response.json(value));
  expect(
    await fetchPublicHomeLayout("https://api.example.invalid", fetcher),
  ).toEqual(value);
  expect(fetcher.mock.calls[0]).toEqual([
    "https://api.example.invalid/api/v1/storefront/home-layout",
    expect.objectContaining({
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    }),
  ]);
});

test("layout transport failure never invents a default that replaces the published page", async () => {
  const { fetchPublicHomeLayout } = await import("./public-home-layout");
  for (const fetcher of [
    async () => {
      throw new Error("offline");
    },
    async () => Response.json({ schemaVersion: 1, outcome: "SUCCESS" }),
    async () => new Response(null, { status: 404 }),
  ]) {
    expect(
      await fetchPublicHomeLayout("https://api.example.invalid", fetcher),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
  }
});
