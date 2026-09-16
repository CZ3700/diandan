import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildFallbackArtifacts,
  subtractUnicodeRanges,
} from "./generate-fallback-css.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputDir = path.join(
  root,
  "packages/design-tokens/styles/fonts/generated",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("standalone temporary output reproduces canonical bytes without requiring UI input copies", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "font-fallback-output-"),
  );
  try {
    await promisify(execFile)(process.execPath, [
      path.join(root, "scripts/fonts/generate-fallback-css.mjs"),
      "--output-dir",
      directory,
    ]);
    const canonical = await buildFallbackArtifacts();
    for (const [filename, bytes] of Object.entries(canonical)) {
      assert.equal(
        await readFile(path.join(directory, filename), "utf8"),
        bytes,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit UI input uses the new generation directory and rejects its stale manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "font-fallback-ui-"));
  try {
    for (const filename of [
      "manifest.json",
      "japanese-ui.css",
      "japanese-ui.woff2",
      "simplified-chinese-ui.css",
      "simplified-chinese-ui.woff2",
    ]) {
      await cp(path.join(outputDir, filename), path.join(directory, filename));
    }
    await promisify(execFile)(process.execPath, [
      path.join(root, "scripts/fonts/generate-fallback-css.mjs"),
      "--output-dir",
      directory,
      "--ui-dir",
      directory,
    ]);
    assert.deepEqual(
      await buildFallbackArtifacts({ uiDir: directory }),
      await buildFallbackArtifacts(),
    );
    const manifest = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    );
    manifest.profiles[0].corpusSha256 = "0".repeat(64);
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest),
    );
    await assert.rejects(
      buildFallbackArtifacts({ uiDir: directory }),
      /catalog source hash/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("range subtraction splits boundaries and preserves non-UI supplementary characters", () => {
  const ranges = [
    [0x20, 0x25],
    [0x10000, 0x10005],
  ];
  assert.deepEqual(
    subtractUnicodeRanges(
      ranges,
      new Set([0x20, 0x22, 0x25, 0x10002, 0x10ffff]),
    ),
    [
      [0x21, 0x21],
      [0x23, 0x24],
      [0x10000, 0x10001],
      [0x10003, 0x10005],
    ],
  );
  assert.deepEqual(
    ranges,
    [
      [0x20, 0x25],
      [0x10000, 0x10005],
    ],
    "source ranges stay immutable",
  );
  assert.deepEqual(
    subtractUnicodeRanges([[0x20, 0x21]], new Set([0x20, 0x21])),
    [],
  );
  assert.deepEqual(
    subtractUnicodeRanges([[0, 0x10ffff]], new Set([0, 0x10ffff])),
    [[1, 0x10fffe]],
  );
});

test("fallback artifacts reproduce deterministically from the complete pinned catalogs and font bytes", async () => {
  const before = await Promise.all(
    [
      "manifest.json",
      "japanese-ui.css",
      "japanese-ui.woff2",
      "japanese-OFL.txt",
      "simplified-chinese-ui.css",
      "simplified-chinese-ui.woff2",
      "simplified-chinese-OFL.txt",
    ].map(async (name) => [
      name,
      hash(await readFile(path.join(outputDir, name))),
    ]),
  );
  const first = await buildFallbackArtifacts();
  const second = await buildFallbackArtifacts();
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), [
    "fallback-manifest.json",
    "japanese-fallback.css",
    "simplified-chinese-fallback.css",
  ]);
  for (const [name, bytes] of Object.entries(first)) {
    assert.equal(
      bytes,
      await readFile(path.join(outputDir, name), "utf8"),
      `${name} must be up to date`,
    );
    assert.doesNotMatch(
      bytes,
      /\.pnpm|\/Users\/|file:\/\//u,
      "artifacts never contain resolved package-store or machine paths",
    );
  }
  const manifest = JSON.parse(first["fallback-manifest.json"]);
  assert.equal(manifest.schemaVersion, 1);
  for (const profile of manifest.profiles) {
    const css = first[`${profile.profile}-fallback.css`];
    assert.match(
      css,
      /url\("\.\.\/\.\.\/\.\.\/node_modules\/@fontsource-variable\//u,
    );
    assert.equal(profile.cssSha256, hash(css));
    assert.ok(profile.originalCodepoints > profile.uiCodepoints + 1000);
    assert.equal(
      profile.originalCodepoints,
      profile.fallbackCodepoints + profile.uiCodepoints,
    );
    assert.ok(profile.resources.length > 100);
    for (const resource of profile.resources) {
      const actual = await readFile(
        path.join(
          root,
          "packages/design-tokens/node_modules",
          profile.fontsourcePackage,
          resource.path,
        ),
      );
      assert.equal(resource.sha256, hash(actual));
      assert.equal(resource.bytes, actual.byteLength);
    }
  }
  for (const [name, digest] of before) {
    assert.equal(
      hash(await readFile(path.join(outputDir, name))),
      digest,
      `${name} must not be regenerated by CSS generation`,
    );
  }
});

for (const [label, mutate, error] of [
  [
    "stale catalog",
    (profile) => {
      profile.corpusSha256 = "0".repeat(64);
    },
    /catalog source hash/u,
  ],
  [
    "removed UI point",
    (profile) => {
      profile.codepoints.pop();
    },
    /complete current catalog/u,
  ],
  [
    "changed UI bytes",
    (profile) => {
      profile.woff2Sha256 = "0".repeat(64);
    },
    /UI font bytes/u,
  ],
  [
    "changed original shard",
    (profile) => {
      profile.originalShards[0].sha256 = "0".repeat(64);
    },
    /original shard bytes/u,
  ],
]) {
  test(`generation rejects ${label} instead of silently producing incompatible fallback`, async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "font-fallback-test-"),
    );
    try {
      const manifest = JSON.parse(
        await readFile(path.join(outputDir, "manifest.json"), "utf8"),
      );
      mutate(manifest.profiles[0]);
      const manifestPath = path.join(directory, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(buildFallbackArtifacts({ manifestPath }), error);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
