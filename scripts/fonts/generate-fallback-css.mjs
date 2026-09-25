import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import postcss from "postcss";
import { format } from "prettier";

import {
  codepointsInFaces,
  readFontCascade,
  selectFace,
} from "../font-ui-subset-support.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const packageRoot = path.join(root, "packages/design-tokens");
const canonicalOutput = path.join(packageRoot, "styles/fonts/generated");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const portable = (filename) => filename.split(path.sep).join("/");

/** Remove excluded points from each source interval without moving the rest. */
export function subtractUnicodeRanges(ranges, excluded) {
  const points = [...excluded].sort((a, b) => a - b);
  const result = [];
  for (const [start, end] of ranges) {
    let cursor = start;
    for (const point of points) {
      if (point < cursor) continue;
      if (point > end) break;
      if (cursor < point) result.push([cursor, point - 1]);
      cursor = point + 1;
    }
    if (cursor <= end) result.push([cursor, end]);
  }
  return result;
}

function cssRanges(ranges) {
  return ranges
    .map(
      ([start, end]) =>
        `U+${start.toString(16).toUpperCase()}${start === end ? "" : `-${end.toString(16).toUpperCase()}`}`,
    )
    .join(",");
}

async function validateUi(profile, manifest, directory) {
  assert.equal(manifest.catalog, profile.catalog);
  assert.equal(manifest.fontsourcePackage, profile.fontsourcePackage);
  assert.equal(manifest.fontsourceVersion, profile.fontsourceVersion);
  const catalog = path.join(root, profile.catalog);
  assert.equal(
    sha256(await readFile(catalog)),
    manifest.corpusSha256,
    "catalog source hash must match the UI manifest",
  );
  const copy = (await import(pathToFileURL(catalog).href)).default;
  const values = Object.values(copy);
  assert.ok(
    values.length > 100 && values.every((value) => typeof value === "string"),
  );
  const points = [
    ...new Set(
      [...values.join("")].map((character) => character.codePointAt(0)),
    ),
  ].sort((a, b) => a - b);
  assert.deepEqual(
    manifest.codepoints,
    points,
    "UI manifest must contain the complete current catalog",
  );
  const uiCss = path.join(directory, `${profile.id}-ui.css`);
  const ui = await readFontCascade(uiCss, packageRoot);
  assert.equal(ui.imports.length, 0);
  assert.equal(ui.faces.length, 1);
  assert.equal(ui.faces[0].family, profile.family);
  assert.deepEqual(
    codepointsInFaces(ui.faces),
    new Set(points),
    "UI CSS must advertise exactly the current catalog",
  );
  assert.equal(
    await realpath(ui.faces[0].resource),
    await realpath(path.join(directory, `${profile.id}-ui.woff2`)),
  );
  const bytes = await readFile(ui.faces[0].resource);
  assert.equal(
    sha256(bytes),
    manifest.woff2Sha256,
    "UI font bytes must match the existing manifest",
  );
  assert.equal(bytes.byteLength, manifest.woff2Bytes);
  return { points: new Set(points), cssSha256: sha256(await readFile(uiCss)) };
}

async function buildProfile(
  profile,
  manifest,
  directory,
  declaredDependencies,
) {
  const ui = await validateUi(profile, manifest, directory);
  assert.equal(
    declaredDependencies[profile.fontsourcePackage],
    profile.fontsourceVersion,
    "original font must remain a pinned package dependency",
  );
  const fontRoot = path.join(
    packageRoot,
    "node_modules",
    profile.fontsourcePackage,
  );
  assert.equal(
    (await json(path.join(fontRoot, "package.json"))).version,
    profile.fontsourceVersion,
  );
  const realFontRoot = await realpath(fontRoot);
  const sourceFile = path.join(fontRoot, "wght.css");
  const original = await readFontCascade(sourceFile, packageRoot);
  const originalPoints = codepointsInFaces(original.faces);
  assert.ok(
    [...ui.points].every((point) => originalPoints.has(point)),
    "UI characters must already be supported by the original font",
  );
  const resources = new Map();
  const faces = [];
  const fallbackFaces = [];
  // The pinned original fonts contain every printable ASCII glyph in its
  // source-ordered owner. Broader advertised ranges can exceed actual cmap
  // coverage, so preserve all non-ASCII fallback advertisements unchanged.
  const asciiOwners = new Map();
  for (let point = 0x20; point <= 0x7e; point += 1) {
    const owner = selectFace(original.faces, point);
    if (owner) asciiOwners.set(point, owner);
  }
  for (const face of original.faces) {
    assert.equal(face.family, profile.family);
    const resourcePath = portable(
      path.relative(realFontRoot, await realpath(face.resource)),
    );
    assert.match(
      resourcePath,
      /^files\/[^/]+\.woff2$/u,
      "source resource must stay inside the declared package",
    );
    const declaredResource = path.join(fontRoot, resourcePath);
    assert.equal(
      await realpath(declaredResource),
      await realpath(face.resource),
      "stable package reference must resolve to the identical original resource",
    );
    const bytes = await readFile(declaredResource);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2");
    resources.set(resourcePath, {
      path: resourcePath,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
    });
    const excluded = new Set(ui.points);
    for (const [point, owner] of asciiOwners)
      if (owner !== face) excluded.add(point);
    const ranges = subtractUnicodeRanges(face.ranges, excluded);
    if (ranges.length === 0) continue;
    // Always encode the installed stylesheet's location, even for temporary
    // reproduction output. Never serialize a symlink's .pnpm store location.
    const url = portable(path.relative(canonicalOutput, declaredResource));
    assert.ok(
      url.startsWith("../../../node_modules/") && !url.includes(".pnpm"),
    );
    const parsed = postcss.parse(face.css);
    parsed.walkDecls("unicode-range", (declaration) => {
      declaration.value = cssRanges(ranges);
    });
    parsed.walkDecls("src", (declaration) => {
      declaration.value = declaration.value.replace(
        /^url\([^)]+\)/u,
        `url("${url}")`,
      );
    });
    faces.push(parsed.toString());
    fallbackFaces.push({ ranges });
  }
  for (const resource of manifest.originalShards) {
    assert.equal(
      resources.get(resource.path)?.sha256,
      resource.sha256,
      "original shard bytes must match the pinned UI comparison",
    );
  }
  const fallbackPoints = codepointsInFaces(fallbackFaces);
  assert.ok([...fallbackPoints].every((point) => !ui.points.has(point)));
  assert.deepEqual(
    new Set([...fallbackPoints, ...ui.points]),
    originalPoints,
    "combined fallback and UI coverage must preserve the entire original repertoire",
  );
  const css = await format(
    `/* Generated from the original Fontsource repertoire minus the UI catalog and earlier duplicate printable ASCII ranges. See scripts/fonts/README.md. */\n${faces.join("\n")}\n`,
    { parser: "css" },
  );
  return {
    css,
    manifest: {
      profile: profile.id,
      catalog: profile.catalog,
      corpusSha256: manifest.corpusSha256,
      fontsourcePackage: profile.fontsourcePackage,
      fontsourceVersion: profile.fontsourceVersion,
      sourceCssSha256: sha256(await readFile(sourceFile)),
      uiCssSha256: ui.cssSha256,
      uiWoff2Sha256: manifest.woff2Sha256,
      cssSha256: sha256(css),
      originalFaces: original.faces.length,
      fallbackFaces: faces.length,
      originalCodepoints: originalPoints.size,
      uiCodepoints: ui.points.size,
      fallbackCodepoints: fallbackPoints.size,
      resources: [...resources.values()],
    },
  };
}

/** Validate all inputs and return deterministic CSS/provenance without writing. */
export async function buildFallbackArtifacts({
  uiDir = canonicalOutput,
  manifestPath = path.join(uiDir, "manifest.json"),
} = {}) {
  const config = await json(path.join(root, "scripts/fonts/sources.json"));
  const uiManifest = await json(manifestPath);
  const declared = await json(path.join(packageRoot, "package.json"));
  assert.equal(config.schemaVersion, 1);
  assert.equal(uiManifest.schemaVersion, 1);
  assert.deepEqual(
    uiManifest.profiles.map((profile) => profile.profile),
    config.profiles.map((profile) => profile.id),
  );
  const artifacts = {};
  const profiles = [];
  for (const [index, profile] of config.profiles.entries()) {
    const result = await buildProfile(
      profile,
      uiManifest.profiles[index],
      uiDir,
      declared.dependencies,
    );
    artifacts[`${profile.id}-fallback.css`] = result.css;
    profiles.push(result.manifest);
  }
  artifacts["fallback-manifest.json"] = await format(
    JSON.stringify({ schemaVersion: 1, profiles }),
    { parser: "json" },
  );
  return artifacts;
}

async function main() {
  const args = process.argv.slice(2);
  const options = new Map();
  assert.equal(args.length % 2, 0, "every option requires a directory");
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    assert.ok(
      ["--output-dir", "--ui-dir"].includes(key) && !options.has(key),
      "usage: node scripts/fonts/generate-fallback-css.mjs [--output-dir DIRECTORY] [--ui-dir DIRECTORY]",
    );
    options.set(key, path.resolve(args[index + 1]));
  }
  const outputDir = options.get("--output-dir") ?? canonicalOutput;
  const artifacts = await buildFallbackArtifacts({
    uiDir: options.get("--ui-dir") ?? canonicalOutput,
  });
  await mkdir(outputDir, { recursive: true });
  for (const [filename, content] of Object.entries(artifacts)) {
    await writeFile(path.join(outputDir, filename), content);
  }
  process.stdout.write(
    `${JSON.stringify({ files: Object.keys(artifacts) })}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
