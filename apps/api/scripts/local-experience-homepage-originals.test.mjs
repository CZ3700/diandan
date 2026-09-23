import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import sharp from "sharp";
import {
  createLocalHomepageOriginal,
  prepareLocalHomepagePosterPlan,
} from "./local-experience-homepage-originals.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
test("independent TEST homepage originals preserve matte pixels and cannot deduplicate into daily masters", async () => {
  const originals = [];
  for (const key of ["desktop", "mobile"]) {
    const value = await createLocalHomepageOriginal({ workspaceRoot, key });
    const metadata = await sharp(value.bytes).metadata();
    assert.notEqual(value.sourceChecksum, value.legacyChecksum);
    assert.equal(metadata.width, value.provenance.canvasSize.width);
    assert.equal(metadata.height, value.provenance.canvasSize.height);
    assert.equal(
      value.provenance.sourcePixelSha256,
      value.provenance.embeddedPixelSha256,
    );
    assert.equal(value.provenance.formalAssetApproval, false);
    assert.equal(path.extname(value.provenance.sourcePath), ".webp");
    originals.push(value);
  }
  assert.notEqual(originals[0].sourceChecksum, originals[1].sourceChecksum);
});

test("one-time TEST poster upgrade preserves earlier identities and refuses unrecognized sources", async () => {
  const originals = Object.fromEntries(
    ["desktop", "mobile"].map((key, index) => [
      key,
      { legacyChecksum: String(index).repeat(64) },
    ]),
  );
  const oldAssets = { desktop: { sourceChecksum: "0".repeat(64) } };
  const plan = { posterAssets: globalThis.structuredClone(oldAssets) };
  let saves = 0;
  await prepareLocalHomepagePosterPlan(plan, originals, async () => {
    saves++;
  });
  assert.equal(plan.posterAssetVersion, 2);
  assert.deepEqual(plan.retiredPosterAssets, [oldAssets]);
  assert.deepEqual(plan.posterAssets, {});
  await prepareLocalHomepagePosterPlan(plan, originals, async () => {
    saves++;
  });
  assert.equal(saves, 1);
  const foreign = {
    posterAssets: { desktop: { sourceChecksum: "f".repeat(64) } },
  };
  await assert.rejects(
    prepareLocalHomepagePosterPlan(foreign, originals, async () => {}),
    /Unrecognized/,
  );
  assert.equal(foreign.posterAssetVersion, undefined);
  assert.equal(foreign.posterAssets.desktop.sourceChecksum, "f".repeat(64));
});
