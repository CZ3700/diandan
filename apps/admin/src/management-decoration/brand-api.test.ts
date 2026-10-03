import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
const subject = await import("./brand-api").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const brand = {
  schemaVersion: 1 as const,
  lightLogoAssetId: id,
  darkLogoAssetId: null,
};
const logo = {
  assetId: id,
  url: "https://cdn.example.test/processed/v1/10000000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
  width: 320,
  height: 80,
};
const state = {
  schemaVersion: 1,
  version: 1,
  draft: {
    revisionId: id,
    brand,
    view: { schemaVersion: 1, lightLogo: logo, darkLogo: null },
    createdAt: "2026-10-01T00:00:00Z",
  },
  published: null,
};
test("brand saves validate the logo slots and preserve retry keys on invalid receipts", async () => {
  expect(subject?.createStorefrontBrandApi).toBeTypeOf("function");
  const requests: RequestInit[] = [];
  const api = subject!.createStorefrontBrandApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async (_url, init) => {
        requests.push(init!);
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STATE",
          replayed: false,
          state,
        });
      },
    ),
  );
  await expect(api.save({ ...brand, darkLogoAssetId: id }, 0)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  await expect(api.save({ ...brand, darkLogoAssetId: id }, 0)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  expect(new Headers(requests[0]?.headers).get("idempotency-key")).toBe(
    new Headers(requests[1]?.headers).get("idempotency-key"),
  );
});
test("a replay rereads current brand authority", async () => {
  expect(subject?.createStorefrontBrandApi).toBeTypeOf("function");
  const paths: string[] = [];
  const current = { ...state, version: 2 };
  const api = subject!.createStorefrontBrandApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async (path) => {
        paths.push(String(path));
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STATE",
          replayed: paths.length === 1,
          state: paths.length === 1 ? state : current,
        });
      },
    ),
  );
  expect(await api.save(brand, 0)).toEqual(current);
  expect(paths).toEqual([
    "/api/admin/storefront-brand-draft",
    "/api/admin/storefront-brand-read",
  ]);
});
test("logo preparation retries the same ticket and key after a lost response without repeating PUT", async () => {
  const paths: string[] = [],
    prepareHeaders: Headers[] = [];
  let puts = 0;
  const api = subject!.createStorefrontBrandApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async (path, init) => {
        paths.push(String(path));
        if (String(path).endsWith("media-upload-begin"))
          return Response.json({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "UPLOAD_GRANT",
            replayed: false,
            uploadId: id,
            grant: {
              method: "PUT",
              url: "https://storage.example.invalid/upload",
              headers: {},
              expiresAt: "2099-01-01T00:00:00Z",
            },
          });
        prepareHeaders.push(new Headers(init?.headers));
        if (prepareHeaders.length === 1) throw new Error("lost response");
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "LOGO",
          logo,
          replayed: true,
        });
      },
    ),
    async (_url, init) => {
      puts++;
      expect(init?.credentials).toBe("omit");
      return new Response(null, { status: 200 });
    },
  );
  const file = new File(["logo"], "logo.png", { type: "image/png" });
  await expect(api.upload(file)).rejects.toThrow("NETWORK_ERROR");
  expect(await api.upload(file)).toEqual(logo);
  expect(puts).toBe(1);
  expect(paths).toEqual([
    "/api/admin/media-upload-begin",
    "/api/admin/storefront-brand-prepare",
    "/api/admin/storefront-brand-prepare",
  ]);
  expect(prepareHeaders[0]!.get("idempotency-key")).toBe(
    prepareHeaders[1]!.get("idempotency-key"),
  );
});
