import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { createMediaSourceInspector } from "../../../packages/media-image/dist/index.js";
import { createS3MediaStorageAdapterForTesting } from "../../../packages/media-s3/dist/adapter.js";

const require = createRequire(
  new URL("../../../packages/media-image/package.json", import.meta.url),
);
const sharp = require("sharp");
const bytes = await sharp({
  create: { width: 30, height: 20, channels: 3, background: "#345678" },
})
  .png()
  .toBuffer();
const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
const callerNow = new Date("2026-09-06T10:00:00.000Z");
let signed = 0;
const storage = createS3MediaStorageAdapterForTesting(
  {
    schemaVersion: 1,
    sourceBucket: "private-source",
    derivativeBucket: "private-derivative",
    publicMediaOrigin: "https://media.example.invalid",
    maxUploadBytes: 25 * 1024 * 1024,
  },
  {
    now: () => new Date(callerNow.getTime() + 1),
    send: async () => ({
      ChecksumSHA256: Buffer.from(checksumSha256, "hex").toString("base64"),
      ContentLength: bytes.length,
      ContentType: "image/png",
      ETag: '"fixture-etag"',
    }),
    presign: async () => {
      signed++;
      return "https://storage.example.invalid/private";
    },
  },
);
const inspector = createMediaSourceInspector({
  storage,
  now: () => callerNow,
  fetch: async (_url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    return new globalThis.Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  },
});
const result = await inspector.inspect({
  schemaVersion: 1,
  profileVersion: 1,
  source: {
    objectKey: "uploads/v1/fixture",
    checksumSha256,
    byteSize: bytes.length,
    mimeType: "image/png",
  },
});
assert.equal(
  result.outcome,
  "SUCCESS",
  `real S3 boundary after 1ms: ${result.outcome === "FAILURE" ? result.error.code : "SUCCESS"}`,
);
assert.equal(signed, 1);
assert.equal(result.receipt.width, 30);
assert.equal(result.receipt.height, 20);
process.stdout.write(
  "Source inspection with real S3 boundary and 1ms clock advance: 6 assertions PASS.\n",
);
