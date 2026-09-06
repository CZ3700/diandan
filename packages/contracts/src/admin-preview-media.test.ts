import { expect, test } from "vitest";

const modulePath = "./admin-preview-media.js";
test("preview media accepts only a canonical root target and body credential", async () => {
  const exports = await import(modulePath).catch(() => ({}));
  expect(exports.adminPreviewMediaRequestSchema).toBeDefined();
  const input = {
    schemaVersion: 1,
    target: {
      owner: { kind: "HOMEPAGE" },
      revisionId: "10000000-0000-4000-8000-000000000001",
      locale: "ja",
    },
    token: "A".repeat(43),
  };
  expect(exports.adminPreviewMediaRequestSchema.safeParse(input).success).toBe(
    true,
  );
  for (const extra of [
    { objectKey: "private/original" },
    { assetId: "10000000-0000-4000-8000-000000000002" },
    { url: "https://example.test/" },
  ])
    expect(
      exports.adminPreviewMediaRequestSchema.safeParse({ ...input, ...extra })
        .success,
    ).toBe(false);
});
test("preview images reject duplicate references and inconsistent accessible presentation", async () => {
  const { adminPreviewMediaResponseSchema } =
    await import("./admin-preview-media.js");
  const id = "10000000-0000-4000-8000-000000000001";
  const entry = {
    assetId: id,
    metadataRevisionId: id,
    status: "AVAILABLE",
    alt: "Image",
    presentationKind: "INFORMATIVE",
    focalPoint: { x: 0.5, y: 0.5 },
    width: 800,
    height: 1000,
    mimeType: "image/webp",
    download: {
      method: "GET",
      url: "https://media.example.test/image",
      headers: {},
      expiresAt: "2026-09-07T00:05:00Z",
    },
  };
  const value = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PREVIEW_MEDIA",
    target: {
      owner: { kind: "MEDIA_METADATA", mediaAssetId: id },
      revisionId: id,
      locale: "ja",
    },
    expiresAt: "2026-09-07T00:05:00Z",
    images: [entry],
  };
  expect(adminPreviewMediaResponseSchema.safeParse(value).success).toBe(true);
  expect(
    adminPreviewMediaResponseSchema.safeParse({
      ...value,
      images: [entry, entry],
    }).success,
  ).toBe(false);
  expect(
    adminPreviewMediaResponseSchema.safeParse({
      ...value,
      images: [{ ...entry, alt: "" }],
    }).success,
  ).toBe(false);
  expect(
    adminPreviewMediaResponseSchema.safeParse({
      ...value,
      images: [{ ...entry, presentationKind: "DECORATIVE" }],
    }).success,
  ).toBe(false);
});
