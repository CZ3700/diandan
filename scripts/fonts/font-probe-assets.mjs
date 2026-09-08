import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function createFontProbeAssets(root) {
  const assets = new Map();
  const resources = new Map();
  async function describe(face) {
    if (!resources.has(face.resource)) {
      const body = await readFile(face.resource);
      assert.equal(body.subarray(0, 4).toString("ascii"), "wOF2");
      // Reading may settle concurrently; deduplication and URL allocation are one synchronous step.
      if (!resources.has(face.resource)) {
        const pathname = `/fonts/${resources.size}.woff2`;
        assets.set(pathname, body);
        resources.set(face.resource, {
          pathname,
          sha256: createHash("sha256").update(body).digest("hex"),
          bytes: body.length,
        });
      }
    }
    return {
      ...resources.get(face.resource),
      unicodeRange: face.unicodeRange,
      weight: face.weight,
      style: face.style,
      source: path.relative(root, face.resource),
    };
  }
  return { assets, resources, describe };
}
