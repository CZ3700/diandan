import { expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { managementCopy } from "./copy";
import { imageSizeHint, measureImage, smallImageWarning } from "./image-size";

const en = managementCopy("en");

it("tells operators the best size and framing for each daily image", () => {
  expect(imageSizeHint(en, "SAVE_ARTIST")).toContain("2400 × 2000");
  expect(imageSizeHint(en, "SAVE_ARTIST")).toContain(en.imageTipArtist);
  expect(imageSizeHint(en, "SAVE_GIFT")).toContain("1200 × 1200");
  expect(imageSizeHint(en, "SAVE_GIFT")).toContain(en.imageTipGift);
  expect(imageSizeHint(en, "REPLACE_POSTER")).toContain("2400 × 1350");
  expect(imageSizeHint(en, "REPLACE_POSTER")).toContain(en.imageTipPoster);
  // Daily images are cropped to fill now; the hint must not promise kept proportions.
  expect(en.imageHint).not.toMatch(/proportion/iu);
});

it.each(SUPPORTED_LOCALES)("fills every size placeholder in %s", (locale) => {
  const copy = managementCopy(locale);
  for (const kind of ["SAVE_ARTIST", "SAVE_GIFT", "REPLACE_POSTER"] as const)
    expect(imageSizeHint(copy, kind)).not.toMatch(/[{}]/u);
  expect(
    smallImageWarning(copy, "SAVE_GIFT", { width: 800, height: 600 }),
  ).toMatch(/800 × 600/u);
});

it("warns only when a side is below the recommended size", () => {
  expect(
    smallImageWarning(en, "SAVE_ARTIST", { width: 1080, height: 1350 }),
  ).toContain("1080 × 1350");
  // A tall phone photo is wide enough for the desktop banner too.
  expect(
    smallImageWarning(en, "SAVE_ARTIST", { width: 3024, height: 4032 }),
  ).toBeNull();
  expect(
    smallImageWarning(en, "SAVE_ARTIST", { width: 4032, height: 1800 }),
  ).not.toBeNull();
  expect(smallImageWarning(en, "SAVE_GIFT", null)).toBeNull();
});

it("measures a chosen image without failing where decoding is unavailable", async () => {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1200, height: 900, close })),
  );
  expect(await measureImage(new Blob(["x"]))).toEqual({
    width: 1200,
    height: 900,
  });
  expect(close).toHaveBeenCalledOnce();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      throw new Error("undecodable");
    }),
  );
  expect(await measureImage(new Blob(["x"]))).toBeNull();
  vi.unstubAllGlobals();
});
