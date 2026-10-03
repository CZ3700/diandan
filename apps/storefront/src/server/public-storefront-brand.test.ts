import { expect, test, vi } from "vitest";
import type * as Reader from "./public-storefront-brand";
vi.mock("server-only", () => ({}));

async function implementation() {
  let subject: typeof Reader | undefined;
  try {
    subject = await import("./public-storefront-brand");
  } catch {
    /* Initial red case. */
  }
  expect(subject?.fetchPublicStorefrontBrand).toBeTypeOf("function");
  return subject!.fetchPublicStorefrontBrand;
}
const value = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_BRAND",
  source: "DEFAULT",
  brand: { schemaVersion: 1, lightLogo: null, darkLogo: null },
  version: 0,
  publicationId: null,
};
const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
};
test("branding is a bounded credential-free optional read with authoritative provenance", async () => {
  const read = await implementation();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  try {
    const fetcher = vi.fn(async () => Response.json(value));
    expect(await read("https://api.example.invalid", fetcher)).toEqual(value);
    expect(fetcher.mock.calls[0]).toEqual([
      "https://api.example.invalid/api/v1/storefront/storefront-brand",
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      }),
    ]);
    expect(timeout).toHaveBeenCalledWith(1000);
  } finally {
    timeout.mockRestore();
  }
});
test("branding refuses malformed provenance, unsafe media, cookies, oversized bodies and wrong statuses", async () => {
  const read = await implementation();
  for (const fetcher of [
    async () => {
      throw new Error("offline");
    },
    async () => Response.json({ ...value, version: 2 }),
    async () => Response.json(value, { status: 503 }),
    async () =>
      Response.json(value, { headers: { "set-cookie": "unexpected=value" } }),
    async () =>
      Response.json({
        ...value,
        brand: {
          ...value.brand,
          lightLogo: {
            assetId: "8c7cc797-c5fa-4a11-b0eb-6d282b9c4019",
            url: "https://media.example.invalid/uploads/private.png",
            width: 400,
            height: 100,
          },
        },
      }),
    async () =>
      new Response(" ".repeat(64 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
  ])
    expect(await read("https://api.example.invalid", fetcher)).toEqual(
      unavailable,
    );
});
