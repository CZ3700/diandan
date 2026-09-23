import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { createMatteFixture } from "./storefront-media-fixtures.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Local TEST-only artwork has an explicit separate matte; the source photograph is never enlarged or changed. */
export async function createLocalHomepageOriginal({ workspaceRoot, key }) {
  assert.ok(["desktop", "mobile"].includes(key));
  const sourcePath =
    "apps/storefront/public/ui-brand/performer-daylight-" + key + ".webp";
  const matte = await createMatteFixture(
    path.join(workspaceRoot, sourcePath),
    key === "desktop" ? "HERO_DESKTOP" : "HERO_MOBILE",
  );
  const border = 24;
  const bytes = await sharp(matte.bytes)
    .extend({
      top: border,
      bottom: border,
      left: border,
      right: border,
      background: { r: 34, g: 31, b: 27 },
    })
    .png()
    .toBuffer();
  const originalPixels = await sharp(matte.bytes)
    .removeAlpha()
    .raw()
    .toBuffer();
  const embeddedPixels = await sharp(bytes)
    .extract({ left: border, top: border, ...matte.provenance.canvasSize })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.equal(digest(originalPixels), digest(embeddedPixels));
  return {
    bytes,
    sourceChecksum: digest(bytes),
    legacyChecksum: digest(matte.bytes),
    provenance: {
      ...matte.provenance,
      kind: "LOCAL_TEST_INDEPENDENT_POSTER",
      sourcePath,
      composedSha256: digest(bytes),
      canvasSize: {
        width: matte.provenance.canvasSize.width + border * 2,
        height: matte.provenance.canvasSize.height + border * 2,
      },
      placement: {
        ...matte.provenance.placement,
        left: matte.provenance.placement.left + border,
        top: matte.provenance.placement.top + border,
      },
    },
  };
}

/** Retain the incomplete v1 TEST plan as history; never replace an unrelated source or published homepage. */
export async function prepareLocalHomepagePosterPlan(plan, originals, save) {
  if (plan.posterAssetVersion === 2) return;
  const previous = plan.posterAssets;
  for (const [key, item] of Object.entries(previous ?? {}))
    assert.equal(
      item.sourceChecksum,
      originals[key].legacyChecksum,
      "Unrecognized TEST source is preserved",
    );
  if (previous && Object.keys(previous).length)
    plan.retiredPosterAssets = [previous];
  plan.posterAssets = {};
  plan.posterAssetVersion = 2;
  await save();
}
