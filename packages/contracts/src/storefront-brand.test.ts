import { expect, test } from "vitest";
import * as brand from "./storefront-brand.js";
import * as logo from "./storefront-logo.js";
const id = "abcdefab-0000-4000-8000-000000000001";
test("brand configuration has only two opaque independent slots and rejects caller URLs", () => {
  expect(
    brand.storefrontBrandSchema.parse({
      schemaVersion: 1,
      lightLogoAssetId: null,
      darkLogoAssetId: id,
    }),
  ).toEqual({ schemaVersion: 1, lightLogoAssetId: null, darkLogoAssetId: id });
  expect(
    brand.storefrontBrandSchema.safeParse({
      schemaVersion: 1,
      lightLogoAssetId: "https://example.test/logo.png",
      darkLogoAssetId: null,
    }).success,
  ).toBe(false);
  expect(
    brand.storefrontBrandSchema.safeParse({
      schemaVersion: 1,
      lightLogoAssetId: null,
      darkLogoAssetId: null,
      name: "Changed",
    }).success,
  ).toBe(false);
  expect(brand.createDefaultStorefrontBrandView()).toEqual({
    schemaVersion: 1,
    lightLogo: null,
    darkLogo: null,
  });
});
test("logo processing binds the upload namespace and exact checksum output", () => {
  const source = {
    objectKey: `uploads/v1/${id}`,
    checksumSha256: "a".repeat(64),
    mimeType: "image/png",
    byteSize: 40,
  };
  const command = { schemaVersion: 1, profileVersion: 1, uploadId: id, source };
  expect(
    logo.storefrontLogoProcessingCommandSchema.safeParse(command).success,
  ).toBe(true);
  expect(
    logo.storefrontLogoProcessingCommandSchema.safeParse({
      ...command,
      source: { ...source, objectKey: "uploads/v1/other" },
    }).success,
  ).toBe(false);
  const image = {
    objectKey: logo.storefrontLogoObjectKey(id, "b".repeat(64)),
    checksumSha256: "b".repeat(64),
    mimeType: "image/webp",
    byteSize: 30,
    width: 90,
    height: 20,
  };
  const result = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    profileVersion: 1,
    uploadId: id,
    sourceChecksumSha256: source.checksumSha256,
    metadataPolicy: "STRIP_ALL_SRGB",
    image,
  };
  expect(
    logo.storefrontLogoProcessingSuccessSchema.safeParse(result).success,
  ).toBe(true);
  for (const change of [
    { width: 1025 },
    { objectKey: "processed/v1/other.webp" },
    { byteSize: 4 * 1024 * 1024 + 1 },
  ])
    expect(
      logo.storefrontLogoProcessingSuccessSchema.safeParse({
        ...result,
        image: { ...image, ...change },
      }).success,
    ).toBe(false);
});

test("ready logo previews reject private paths and keep prefixed CDN paths", () => {
  const view = {
    assetId: id,
    width: 100,
    height: 20,
    url: `https://cdn.example.test/prefix/processed/v1/${id}/${"a".repeat(64)}.webp`,
  };
  expect(logo.storefrontLogoViewSchema.safeParse(view).success).toBe(true);
  for (const url of [
    "https://cdn.example.test/uploads/private.png",
    `${view.url}?width=20`,
    `${view.url}#x`,
  ])
    expect(
      logo.storefrontLogoViewSchema.safeParse({ ...view, url }).success,
    ).toBe(false);
  const revision = {
    revisionId: id,
    createdAt: "2026-10-01T00:00:00Z",
    brand: { schemaVersion: 1, lightLogoAssetId: id, darkLogoAssetId: null },
    view: { schemaVersion: 1, lightLogo: view, darkLogo: null },
  };
  expect(brand.storefrontBrandRevisionSchema.safeParse(revision).success).toBe(
    true,
  );
  expect(
    brand.storefrontBrandRevisionSchema.safeParse({
      ...revision,
      view: { ...revision.view, lightLogo: null },
    }).success,
  ).toBe(false);
  expect(
    brand.storefrontBrandRevisionSchema.safeParse({
      ...revision,
      view: {
        ...revision.view,
        lightLogo: { ...view, assetId: "abcdefab-0000-4000-8000-000000000002" },
      },
    }).success,
  ).toBe(false);
});
