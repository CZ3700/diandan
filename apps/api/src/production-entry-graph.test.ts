import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
// Static, dynamic, side-effect and re-export specifiers, including type-only edges.
const specifierPattern = /(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/gu;
const forbiddenPackages = [
  "@fan-support/payment-fake",
  "@fan-support/testing",
  "vitest",
];

function sourceGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(
      specifierPattern,
    )) {
      if (specifier === undefined) continue;
      if (specifier.startsWith("."))
        visit(
          path.resolve(path.dirname(file), specifier.replace(/\.js$/u, ".ts")),
        );
      else packages.add(specifier);
    }
  };
  visit(path.join(sourceRoot, entry));
  return {
    files: [...files].map((file) =>
      path.relative(sourceRoot, file).split(path.sep).join("/"),
    ),
    packages: [...packages],
  };
}

test("deployed entry points never reach TEST compositions, fixtures or fake adapters", () => {
  for (const entry of ["main.ts", "index.ts"]) {
    const graph = sourceGraph(entry);
    expect(
      graph.files.filter(
        (file) =>
          file.startsWith("testing/") ||
          file.startsWith("test-support/") ||
          file.endsWith(".test.ts"),
      ),
      entry,
    ).toEqual([]);
    expect(
      graph.packages.filter((name) =>
        forbiddenPackages.some(
          (forbidden) => name === forbidden || name.startsWith(`${forbidden}/`),
        ),
      ),
      entry,
    ).toEqual([]);
  }
  // Guard against a vacuous pass: the walk must reach the composition root.
  expect(sourceGraph("main.ts").files).toContain("production-application.ts");
});
