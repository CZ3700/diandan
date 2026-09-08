import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import postcss from "postcss";

export function unicodeRanges(value) {
  return value.split(",").map((part) => {
    const match = /^U\+([0-9A-F?]{1,6})(?:-([0-9A-F]{1,6}))?$/iu.exec(
      part.trim(),
    );
    assert.ok(match, "font unicode-range must be explicit and parseable");
    assert.ok(
      !(match[1].includes("?") && match[2]),
      "wildcard ranges cannot also specify an end",
    );
    const start = Number.parseInt(match[1].replaceAll("?", "0"), 16);
    const end = Number.parseInt(match[2] ?? match[1].replaceAll("?", "F"), 16);
    assert.ok(
      start <= end && end <= 0x10ffff,
      "unicode-range is outside Unicode",
    );
    return [start, end];
  });
}

export function codepointsInFaces(faces) {
  const points = new Set();
  for (const face of faces) {
    for (const [start, end] of face.ranges) {
      for (let point = start; point <= end; point += 1) points.add(point);
    }
  }
  return points;
}

export function selectFace(faces, point) {
  return faces.findLast((face) =>
    face.ranges.some(([start, end]) => point >= start && point <= end),
  );
}

export function requiredFontResources(faces, points) {
  const resources = new Set();
  const missing = [];
  for (const point of points) {
    const face = selectFace(faces, point);
    if (face) resources.add(face.resource);
    else missing.push(point);
  }
  return { resources, missing };
}

/** Strict source-order model for this repository's plain font imports, not a browser engine. */
export async function readFontCascade(
  filename,
  packageRoot,
  ancestors = new Set(),
) {
  const absolute = await realpath(filename);
  assert.ok(!ancestors.has(absolute), "font import cycle");
  const nextAncestors = new Set([...ancestors, absolute]);
  const require = createRequire(path.join(packageRoot, "package.json"));
  const css = await readFile(absolute, "utf8");
  const parsed = postcss.parse(css, { from: absolute });
  const faces = [];
  const imports = [];
  for (const node of parsed.nodes) {
    if (node.type === "comment") continue;
    assert.equal(
      node.type,
      "atrule",
      "font profiles may contain only imports and font faces",
    );
    if (node.name === "import") {
      const match = /^["']([^"']+)["']$/u.exec(node.params);
      assert.ok(
        match,
        "model does not silently ignore conditional or remote imports",
      );
      const specifier = match[1];
      const importedPath = specifier.startsWith(".")
        ? path.resolve(path.dirname(absolute), specifier)
        : require.resolve(specifier);
      const imported = await readFontCascade(
        importedPath,
        packageRoot,
        nextAncestors,
      );
      imports.push(
        { source: absolute, specifier, resolved: importedPath },
        ...imported.imports,
      );
      faces.push(...imported.faces);
      continue;
    }
    assert.equal(node.name, "font-face", "unsupported font profile at-rule");
    const descriptors = {};
    node.each((child) => {
      if (child.type === "comment") return;
      assert.equal(child.type, "decl");
      assert.ok(!(child.prop in descriptors), "duplicate font descriptor");
      descriptors[child.prop] = child.value;
    });
    const sourceMatch =
      /^url\(["']?([^)'"\s]+)["']?\)\s+format\(["'](?:woff2|woff2-variations)["']\)$/u.exec(
        descriptors.src ?? "",
      );
    assert.ok(sourceMatch, "one local WOFF2 source is required by this model");
    assert.ok(sourceMatch[1].startsWith("."), "font source must remain local");
    faces.push({
      source: absolute,
      css: node.toString(),
      family: descriptors["font-family"]?.replace(/^["']|["']$/gu, ""),
      weight: descriptors["font-weight"],
      style: descriptors["font-style"],
      display: descriptors["font-display"],
      unicodeRange: descriptors["unicode-range"],
      ranges: unicodeRanges(descriptors["unicode-range"] ?? ""),
      resource: path.resolve(path.dirname(absolute), sourceMatch[1]),
    });
  }
  return { imports, faces };
}
