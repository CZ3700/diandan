import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { createMatteFixture } from "../../../apps/api/scripts/storefront-media-fixtures.mjs";
import { createImageMaster } from "../../../packages/media-image/src/image-pipeline.ts";
import { ProcessingBudget } from "../../../packages/media-image/src/failure.ts";
const pathname = new URL(
  "../../../apps/storefront/public/ui-brand/gift-rose-palace.webp",
  import.meta.url,
);
const original = await readFile(pathname);
const matte = await createMatteFixture(pathname, "GIFT_PRIMARY");
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function master(bytes, mimeType, size) {
  return createImageMaster(
    bytes,
    {
      schemaVersion: 1,
      profileVersion: 1,
      source: {
        assetId: "00000000-0000-4000-8000-000000000001",
        metadataRevisionId: "00000000-0000-4000-8000-000000000002",
        objectKey: "original/owned-test",
        checksumSha256: hash(bytes),
        byteSize: bytes.length,
        mimeType,
        ...size,
      },
      role: "GIFT_PRIMARY",
      fit: "CONTAIN",
      focalPoint: { x: 0.5, y: 0.5 },
    },
    new ProcessingBudget(15000, 30),
  );
}
const legacy = await master(
  matte.bytes,
  "image/png",
  matte.provenance.canvasSize,
);
const daily = await master(original, "image/webp", matte.provenance.sourceSize);
assert.equal(legacy.descriptor.checksumSha256, daily.descriptor.checksumSha256);
assert.equal(legacy.descriptor.objectKey, daily.descriptor.objectKey);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    status: "PASS",
    sourceSize: matte.provenance.sourceSize,
    legacyMatteSize: matte.provenance.canvasSize,
    sameProcessedMaster: true,
    sameMasterObjectKey: true,
    actualProductionImagePipeline: true,
    postgresLifecycleEvidence: false,
  }),
);
