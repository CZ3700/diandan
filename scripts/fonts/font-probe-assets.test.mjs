import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFontProbeAssets } from "./font-probe-assets.mjs";

test("concurrent distinct font reads get distinct exact-byte HTTP assets while repeated files deduplicate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "font-probe-assets-"));
  try {
    const a = path.join(root, "a.woff2");
    const b = path.join(root, "b.woff2");
    await writeFile(a, "wOF2TEST_A_BYTES");
    await writeFile(b, "wOF2TEST_B_DIFFERENT_BYTES");
    const probe = createFontProbeAssets(root);
    const inputs = [a, b, a].map((resource) => ({
      resource,
      unicodeRange: "U+0041",
      weight: "100 900",
      style: "normal",
    }));
    const descriptions = await Promise.all(inputs.map(probe.describe));
    assert.equal(
      new Set(descriptions.map((item) => item.pathname)).size,
      2,
      "two different files must never overwrite one HTTP pathname",
    );
    assert.equal(
      descriptions[0].pathname,
      descriptions[2].pathname,
      "one source file has one stable URL",
    );
    assert.equal(probe.assets.size, 2);
    for (const [index, item] of descriptions.entries()) {
      const actualHttpBody = probe.assets.get(item.pathname);
      assert.deepEqual(
        actualHttpBody,
        await readFile(inputs[index].resource),
        "HTTP asset bytes match the specific original source",
      );
      assert.equal(
        createHash("sha256").update(actualHttpBody).digest("hex"),
        item.sha256,
        "descriptor SHA agrees with the bytes actually served",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
