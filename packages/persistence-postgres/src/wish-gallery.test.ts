import { expect, test } from "vitest";
import type { WishGalleryEntry } from "@fan-support/contracts";
const path = "./wish-gallery-data.js";
const module = (await import(path)) as {
  galleryEntry?: (
    row: Record<string, unknown>,
    base: string,
  ) => WishGalleryEntry;
  parseGalleryCursor?: (cursor?: string) => unknown;
  galleryCursor?: (at: string, id: string) => string;
};
const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-10-01T00:00:00.000Z";
const row = {
  entry_id: id,
  supported_at: at,
  idol_handle: "artist",
  idol_display_name: "Artist",
  idol_translation_resolved_locale: "en",
  gift_translation_resolved_locale: "zh-CN",
  idol_portrait_alt: "Portrait",
  idol_portrait_alt_resolved_locale: "ja",
  idol_portrait_public_object_key: "processed/v1/portrait.webp",
  gift_title: "A wish",
  gift_image_alt: "Gift",
  gift_image_alt_resolved_locale: "th",
  gift_image_public_object_key: "processed/v1/gift.webp",
  visibility: "PUBLIC_ANONYMOUS",
  public_alias: null,
  private_name: "secret",
  fan_message: "secret",
  order_id: id,
};
test("gallery projection allows public consent only and does not expose private references", () => {
  expect(module.galleryEntry).toBeTypeOf("function");
  const entry = module.galleryEntry!(row, "https://cdn.example.test/assets/");
  expect(entry.supporter).toEqual({ kind: "ANONYMOUS" });
  expect([
    entry.idol.locale,
    entry.gift.locale,
    entry.idol.portrait.locale,
    entry.gift.image.locale,
  ]).toEqual(["en", "zh-CN", "ja", "th"]);
  expect(entry.idol.portrait.url).toBe(
    "https://cdn.example.test/assets/processed/v1/portrait.webp",
  );
  expect(JSON.stringify(entry)).not.toMatch(
    /secret|order_id|private_name|fan_message/u,
  );
  expect(
    module.galleryEntry!(
      { ...row, visibility: "PUBLIC_NAMED", public_alias: "Moon" },
      "https://cdn.example.test/",
    ).supporter,
  ).toEqual({ kind: "NAMED", alias: "Moon" });
  expect(() =>
    module.galleryEntry!(
      { ...row, visibility: "PRIVATE" },
      "https://cdn.example.test/",
    ),
  ).toThrow();
  for (const objectKey of [
    null,
    "../private",
    "//other.test/x",
    "https://other.test/x",
  ])
    expect(() =>
      module.galleryEntry!(
        { ...row, gift_image_public_object_key: objectKey },
        "https://cdn.example.test/",
      ),
    ).toThrow();
});
test("cursor accepts only exact bounded date and independent entry identity", () => {
  expect(module.parseGalleryCursor).toBeTypeOf("function");
  expect(module.galleryCursor).toBeTypeOf("function");
  expect(module.parseGalleryCursor!()).toBeNull();
  expect(module.parseGalleryCursor!(module.galleryCursor!(at, id))).toEqual({
    supportedAt: at,
    entryId: id,
  });
  for (const value of [
    "garbage",
    Buffer.from(
      JSON.stringify({ supportedAt: at, entryId: id, orderId: id }),
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({ supportedAt: "infinity", entryId: id }),
    ).toString("base64url"),
  ])
    expect(() => module.parseGalleryCursor!(value)).toThrow();
});
