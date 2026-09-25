import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readHeaderSourceManifest } from "./storefront-header-lazy-browser.mjs";

const paths = [
  "apps/storefront/src/storefront/site-header.tsx",
  "apps/storefront/src/storefront/site-header-language.tsx",
  "apps/storefront/src/storefront/site-header-language-menu.tsx",
  "packages/ui/src/menu.tsx",
  "packages/ui/src/selection-controls.tsx",
];

async function fixture(verify) {
  const root = await mkdtemp(path.join(tmpdir(), "header-source-test-"));
  try {
    const files = {};
    for (const file of paths) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), file);
      files[file] = createHash("sha256").update(file).digest("hex");
    }
    const source = {
      files,
      fileCount: paths.length,
      algorithm:
        "sha256(sorted relative path + NUL + content sha256 + newline)",
      sha256: createHash("sha256")
        .update(
          Object.keys(files)
            .sort()
            .map((file) => `${file}\0${files[file]}\n`)
            .join(""),
        )
        .digest("hex"),
    };
    const manifest = path.join(root, "source.json");
    await writeFile(manifest, JSON.stringify(source));
    await verify({ root, manifest, source });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("candidate binding uses the exact sorted NUL-separated aggregate and current product bytes", async () => {
  await fixture(async ({ root, manifest, source }) => {
    const result = await readHeaderSourceManifest(manifest, root);
    assert.equal(result.sourceSha256, source.sha256);
    assert.deepEqual(result.verifiedProductFiles, source.files);
    assert.match(result.sourceManifestSha256, /^[a-f0-9]{64}$/u);
  });
});

test("stale declared source hash is rejected before browser startup", async () => {
  await fixture(async ({ root, manifest, source }) => {
    source.sha256 = "0".repeat(64);
    await writeFile(manifest, JSON.stringify(source));
    await assert.rejects(
      readHeaderSourceManifest(manifest, root),
      /candidate aggregate/u,
    );
  });
});

test("changed Header product bytes cannot reuse the old compiled candidate", async () => {
  await fixture(async ({ root, manifest }) => {
    await writeFile(path.join(root, paths[0]), "changed");
    await assert.rejects(
      readHeaderSourceManifest(manifest, root),
      /Header product bytes/u,
    );
  });
});
