import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import postcss from "postcss";

import {
  codepointsInFaces,
  readFontCascade,
  requiredFontResources,
  selectFace,
  unicodeRanges,
} from "./font-ui-subset-support.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageRoot = path.join(workspaceRoot, "packages/design-tokens");
const profiles = [
  {
    locale: "ja",
    profile: "japanese",
    package: "noto-sans-jp",
    family: "Noto Sans JP Variable",
  },
  {
    locale: "zh-CN",
    profile: "simplified-chinese",
    package: "noto-sans-sc",
    family: "Noto Sans SC Variable",
  },
];

async function load(profile) {
  const copy = (
    await import(
      pathToFileURL(
        path.join(
          workspaceRoot,
          "packages/i18n/src/storefront",
          `${profile.locale}.ts`,
        ),
      ).href
    )
  ).default;
  const strings = Object.values(copy);
  assert.ok(
    strings.length > 100 && strings.every((value) => typeof value === "string"),
    "test uses every current default copy string without selected-page filtering",
  );
  const points = new Set();
  for (const string of strings)
    for (const character of string) points.add(character.codePointAt(0));
  const originalImport = `@fontsource-variable/${profile.package}/wght.css`;
  const original = await readFontCascade(
    path.join(packageRoot, "node_modules", originalImport),
    packageRoot,
  );
  const current = await readFontCascade(
    path.join(packageRoot, "styles/fonts", `${profile.profile}.css`),
    packageRoot,
  );
  return { original, current, points };
}

function faceDescriptors(face) {
  const result = {};
  postcss.parse(face.css).first.each((declaration) => {
    if (declaration.type !== "decl") return;
    if (declaration.prop === "unicode-range") return;
    // CSS serialization may switch quote style without changing the value.
    if (declaration.prop === "src") {
      const match = /format\(["']([^"']+)["']\)$/u.exec(declaration.value);
      assert.ok(match, "one explicit font source format remains required");
      result[declaration.prop] = match[1];
    } else if (declaration.prop === "font-family") {
      result[declaration.prop] = declaration.value.replace(/^["']|["']$/gu, "");
    } else result[declaration.prop] = declaration.value;
  });
  return result;
}

async function resourceIdentity(faces) {
  const identities = new Map();
  for (const resource of new Set(faces.map((face) => face.resource))) {
    identities.set(resource, {
      realpath: await realpath(resource),
      bytes: await readFile(resource),
    });
  }
  return identities;
}

test("request model honors later overlap, wildcard ranges and non-UI fallback", () => {
  const faces = [
    {
      resource: "original.woff2",
      ranges: unicodeRanges("U+4E00-4EFF,U+1F600"),
    },
    { resource: "ui.woff2", ranges: unicodeRanges("U+4E01") },
  ];
  assert.equal(selectFace(faces, 0x4e01).resource, "ui.woff2");
  assert.equal(selectFace(faces, 0x4e02).resource, "original.woff2");
  assert.equal(selectFace(faces, 0x1f600).resource, "original.woff2");
  assert.deepEqual(unicodeRanges("U+4E??"), [[0x4e00, 0x4eff]]);
  assert.deepEqual(
    requiredFontResources(faces, new Set([0x4e01, 0x4e02, 0x1234])).missing,
    [0x1234],
  );
});

for (const profile of profiles) {
  test(`${profile.locale} actual storefront default copy requires at most two CSS-selected font resources`, async () => {
    const { current, points } = await load(profile);
    const selected = requiredFontResources(current.faces, points);
    assert.deepEqual(
      selected.missing,
      [],
      "the model must not reduce requests by dropping UI characters",
    );
    assert.ok(
      selected.resources.size <= 2,
      `${profile.locale}: ${points.size} actual default-copy codepoints require ${selected.resources.size} resources; target <= 2. This is a CSS request model, not measured browser bytes or LCP.`,
    );
  });

  test(`${profile.locale} makes UI coverage exclusive without changing any original non-UI face or bytes`, async () => {
    const { original, current, points } = await load(profile);
    const ui = current.faces.at(-1);
    const fallback = current.faces.slice(0, -1);
    // Chrome 152 cold optional-display evidence in the P3-06 overlap probe
    // disproves the old model's assumption that later overlap avoids requests.
    // Replace literal original-range preservation with the stronger invariant:
    // exactly UI moves to the existing subset; all other glyph coverage and
    // source-ordered original font identities remain unchanged.
    for (const face of fallback) {
      assert.equal(
        [...codepointsInFaces([face])].some((point) => points.has(point)),
        false,
        "no fallback face may also advertise a UI point",
      );
    }
    assert.equal(
      current.imports[0]?.specifier,
      `./generated/${profile.profile}-fallback.css`,
      "the generated complete non-UI cascade remains first",
    );
    assert.equal(
      current.imports.length,
      2,
      "only the disjoint fallback and UI cascade are imported",
    );
    assert.deepEqual(
      codepointsInFaces([ui]),
      points,
      "only the existing UI face covers every current catalog point",
    );
    assert.equal(
      await realpath(ui.resource),
      await realpath(
        path.join(
          packageRoot,
          "styles/fonts/generated",
          `${profile.profile}-ui.woff2`,
        ),
      ),
    );
    const expectedFallback = original.faces.filter((face) =>
      [...codepointsInFaces([face])].some((point) => !points.has(point)),
    );
    assert.equal(fallback.length, expectedFallback.length);
    const identities = await resourceIdentity([
      ...original.faces,
      ...current.faces,
    ]);
    for (const [index, face] of fallback.entries()) {
      const expected = expectedFallback[index];
      const actualIdentity = identities.get(face.resource);
      const expectedIdentity = identities.get(expected.resource);
      assert.equal(
        actualIdentity.realpath,
        expectedIdentity.realpath,
        "every surviving original face keeps its source position and real font file",
      );
      assert.ok(
        actualIdentity.bytes.equals(expectedIdentity.bytes),
        "referenced original WOFF2 bytes remain identical",
      );
      assert.deepEqual(
        faceDescriptors(face),
        faceDescriptors(expected),
        "family, weight, style, display and all other non-range descriptors remain unchanged",
      );
      assert.deepEqual(
        codepointsInFaces([face]),
        new Set(
          [...codepointsInFaces([expected])].filter(
            (point) => !points.has(point),
          ),
        ),
        "each individual original face removes exactly the complete UI set and nothing else",
      );
    }
    const originalCoverage = codepointsInFaces(original.faces);
    const currentCoverage = codepointsInFaces(current.faces);
    assert.deepEqual(
      currentCoverage,
      originalCoverage,
      "the full declared codepoint coverage must neither shrink nor invent glyph coverage",
    );
    const { default: fontDisplayOptional } = await import(
      pathToFileURL(
        path.join(
          workspaceRoot,
          "apps/storefront/postcss-font-display-optional/index.cjs",
        ),
      ).href
    );
    const resolved = await postcss([fontDisplayOptional()]).process(
      current.faces.map((face) => face.css).join("\n"),
      { from: undefined },
    );
    assert.equal(
      resolved.css.match(/font-display:\s*optional/gu)?.length,
      current.faces.length,
    );
    for (const face of current.faces) {
      assert.equal(face.family, profile.family);
      assert.equal(face.weight, "100 900");
      assert.equal(face.style, "normal");
      const bytes = identities.get(face.resource).bytes;
      assert.equal(
        bytes.subarray(0, 4).toString("ascii"),
        "wOF2",
        "selected resources must exist as actual WOFF2 files",
      );
    }
    let nonUiSamples = 0;
    for (const point of originalCoverage) {
      if (points.has(point)) continue;
      const selected = selectFace(current.faces, point);
      assert.ok(
        selected,
        "arbitrary previously supported text keeps a font face",
      );
      assert.equal(
        identities.get(selected.resource).realpath,
        identities.get(selectFace(original.faces, point).resource).realpath,
        "every non-UI codepoint retains selection of the identical real original font file",
      );
      nonUiSamples += 1;
    }
    assert.ok(
      nonUiSamples > 1000,
      "fallback test must exercise the complete broad original repertoire",
    );
  });
}
