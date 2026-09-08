import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  return { original, current, points, originalImport };
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

  test(`${profile.locale} retains the complete original source-ordered fallback and optional variable family`, async () => {
    const { original, current, points, originalImport } = await load(profile);
    assert.equal(
      current.imports[0]?.specifier,
      originalImport,
      "complete original Fontsource import remains first",
    );
    assert.equal(
      current.imports.filter((item) => item.specifier === originalImport)
        .length,
      1,
    );
    assert.deepEqual(
      current.faces.slice(0, original.faces.length),
      original.faces,
      "every original face/source/range survives unchanged and in order",
    );
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
      const bytes = await readFile(face.resource);
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
        selected.resource,
        selectFace(original.faces, point).resource,
        "non-UI codepoints retain their original face selection",
      );
      nonUiSamples += 1;
    }
    assert.ok(
      nonUiSamples > 1000,
      "fallback test must exercise the complete broad original repertoire",
    );
  });
}
