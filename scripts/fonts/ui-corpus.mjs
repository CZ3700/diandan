import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { readFontCascade, selectFace } from "../font-ui-subset-support.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const config = JSON.parse(
  await readFile(new URL("./sources.json", import.meta.url), "utf8"),
);
assert.equal(config.schemaVersion, 1);
const profiles = [];
for (const profile of config.profiles) {
  const filename = path.join(root, profile.catalog);
  const source = await readFile(filename);
  const copy = (await import(pathToFileURL(filename).href)).default;
  const strings = Object.values(copy);
  assert.ok(
    strings.length > 100 && strings.every((value) => typeof value === "string"),
  );
  const codepoints = [
    ...new Set(
      [...strings.join("")].map((character) => character.codePointAt(0)),
    ),
  ].sort((a, b) => a - b);
  const packageRoot = path.join(root, "packages/design-tokens");
  const installed = JSON.parse(
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
  assert.equal(
    installed.version,
    profile.fontsourceVersion,
    "glyph comparison must use the pinned original package",
  );
  const original = await readFontCascade(
    path.join(
      packageRoot,
      "node_modules",
      profile.fontsourcePackage,
      "wght.css",
    ),
    packageRoot,
  );
  const originals = codepoints.map((point) => {
    const face = selectFace(original.faces, point);
    assert.ok(
      face,
      "every UI character must already be supported by the existing family",
    );
    return { point, resource: face.resource };
  });
  profiles.push({
    id: profile.id,
    corpusSha256: createHash("sha256").update(source).digest("hex"),
    codepoints,
    originals,
  });
}
process.stdout.write(JSON.stringify({ schemaVersion: 1, profiles }));
