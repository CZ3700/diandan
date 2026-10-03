import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const subject = await import("./public-information-pages").catch(
  () => undefined,
);
test("information reads preserve absent versus unavailable and never forward browser credentials", async () => {
  expect(subject?.fetchPublicInformationPage).toBeTypeOf("function");
  const fetcher = vi.fn(async () =>
    Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" },
      { status: 404 },
    ),
  );
  const result = await subject!.fetchPublicInformationPage(
    "https://api.example.invalid",
    "FAQ",
    "ja",
    fetcher,
  );
  expect(result).toMatchObject({ code: "NOT_FOUND" });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(
    "https://api.example.invalid/api/v1/storefront/information-pages/FAQ?locale=ja",
  );
  expect(init).toMatchObject({
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  for (const badFetch of [
    vi.fn(async () => {
      throw new Error("database details");
    }),
    vi.fn(async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "NOT_FOUND",
      }),
    ),
    vi.fn(async () => Response.json({ secret: "do not disclose" })),
  ])
    expect(
      await subject!.fetchPublicInformationPage(
        "https://api.example.invalid",
        "FAQ",
        "ja",
        badFetch,
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
});
