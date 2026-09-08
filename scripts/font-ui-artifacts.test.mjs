import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  codepointsInFaces,
  readFontCascade,
} from "./font-ui-subset-support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages/design-tokens");
const generated = path.join(packageRoot, "styles/fonts/generated");
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("committed UI font artifacts match their real current corpus, pinned sources and binary integrity", async () => {
  const sources = JSON.parse(
    await readFile(path.join(root, "scripts/fonts/sources.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(path.join(generated, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(
    manifest.profiles.map((item) => item.profile),
    sources.profiles.map((item) => item.id),
  );
  for (const profile of sources.profiles) {
    const record = manifest.profiles.find(
      (item) => item.profile === profile.id,
    );
    assert.ok(
      Array.isArray(record.layoutFeatureSelection),
      "UI subsets must inherit the actual original webfont feature inventory, not add full-TTF alternates",
    );
    assert.deepEqual(
      record.layoutFeatureSelection,
      [...new Set(Object.values(record.originalLayoutFeatures).flat())].sort(),
    );
    for (const table of ["GSUB", "GPOS"]) {
      assert.ok(record.originalLayoutFeatures[table].length > 0);
      for (const feature of record.subsetLayoutFeatures[table]) {
        assert.ok(
          record.originalLayoutFeatures[table].includes(feature),
          `${table}: generated UI subset must not introduce unsupported original webfont features`,
        );
      }
    }
    assert.deepEqual(record.source, profile.source);
    const catalog = path.join(root, profile.catalog);
    assert.equal(
      sha(await readFile(catalog)),
      record.corpusSha256,
      "UI copy changed: regenerate the font subsets using scripts/fonts/README.md",
    );
    const copy = (await import(pathToFileURL(catalog).href)).default;
    const points = [
      ...new Set(
        [...Object.values(copy).join("")].map((character) =>
          character.codePointAt(0),
        ),
      ),
    ].sort((a, b) => a - b);
    assert.deepEqual(record.codepoints, points);
    const { faces } = await readFontCascade(
      path.join(generated, `${profile.id}-ui.css`),
      packageRoot,
    );
    assert.equal(faces.length, 1);
    assert.deepEqual(
      [...codepointsInFaces(faces)].sort((a, b) => a - b),
      points,
    );
    const binary = await readFile(
      path.join(generated, `${profile.id}-ui.woff2`),
    );
    assert.equal(binary.subarray(0, 4).toString("ascii"), "wOF2");
    assert.equal(
      binary.readUInt32BE(8),
      binary.length,
      "WOFF2 header retains the actual full binary length",
    );
    assert.equal(binary.length, record.woff2Bytes);
    assert.equal(
      sha(binary),
      record.woff2Sha256,
      "committed font bytes must match the validated generation record",
    );
    assert.equal(
      sha(await readFile(path.join(generated, `${profile.id}-OFL.txt`))),
      profile.source.licenseSha256,
    );
    const dependency = JSON.parse(
      await readFile(
        path.join(
          packageRoot,
          "node_modules",
          profile.fontsourcePackage,
          "package.json",
        ),
        "utf8",
      ),
    );
    assert.equal(dependency.version, profile.fontsourceVersion);
    for (const shard of record.originalShards) {
      assert.equal(
        sha(
          await readFile(
            path.join(
              packageRoot,
              "node_modules",
              profile.fontsourcePackage,
              shard.path,
            ),
          ),
        ),
        shard.sha256,
        "installed source font must match the verified original shard",
      );
    }
  }
});
