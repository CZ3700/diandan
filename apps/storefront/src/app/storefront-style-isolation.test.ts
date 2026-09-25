import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const uiStyles = fileURLToPath(
  new URL("../../../../packages/ui/styles/", import.meta.url),
);

function importedUiStyles(file: string): string[] {
  const source = readFileSync(file, "utf8");
  if (file.endsWith(".css")) {
    return [...source.matchAll(/@import\s+["']([^"']+)["']/gu)].map(
      (match) => match[1]!,
    );
  }
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  return parsed.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) &&
    !statement.importClause &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

function cssRules(files: readonly string[]): string {
  const visited = new Set<string>();
  const rules: string[] = [];
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    if (file.endsWith(".css")) rules.push(readFileSync(file, "utf8"));
    for (const specifier of importedUiStyles(file)) {
      if (/^@fan-support\/ui\/[^/]+\.css$/u.test(specifier)) {
        visit(path.join(uiStyles, path.basename(specifier)));
      } else if (specifier.startsWith(".") && specifier.endsWith(".css")) {
        visit(path.resolve(path.dirname(file), specifier));
      }
    }
  }
  for (const file of files) visit(file);
  return rules.join("\n");
}

const publicEntries = [
  path.join(appRoot, "layout.tsx"),
  ...globSync("**/*.tsx", { cwd: path.join(appRoot, "(public)") })
    .filter((file) => !file.endsWith(".test.tsx"))
    .map((file) => path.join(appRoot, "(public)", file)),
];
const publicStyles = cssRules(publicEntries);
const specimenStyles = cssRules([
  path.join(appRoot, "%5Finternal/design-foundations/layout.tsx"),
]);
const specimenSelectors = [
  ".fs-composite-state",
  ".fs-hero",
  ".fs-idol-portrait",
  ".fs-gift-tile",
  ".fs-cart-line",
  ".fs-order-timeline",
];

test("public root and route styles do not include internal composite specimens", () => {
  const rules = publicStyles;
  for (const selector of specimenSelectors) {
    expect(rules, selector).not.toMatch(
      new RegExp(`^\\${selector}(?:\\s*\\{|,)`, "mu"),
    );
  }
});

test("the internal layout retains the complete composite styles", () => {
  const rules = specimenStyles;
  for (const selector of specimenSelectors) {
    expect(rules, selector).toContain(selector);
  }
  expect(rules).toContain("prefers-reduced-motion: reduce");
});

test("public root retains primitive, media, interaction and motion styles", () => {
  const rules = publicStyles;
  for (const selector of [
    ".fs-button",
    ".fs-media",
    ".fs-overlay",
    ".fs-motion-idol",
  ]) {
    expect(rules, selector).toContain(selector);
  }
});

test("public interaction, motion and primitive precedence stays unchanged", () => {
  const imports = importedUiStyles(path.join(appRoot, "globals.css"));
  expect(
    imports.filter((specifier) =>
      [
        "@fan-support/ui/interactions.css",
        "@fan-support/ui/motion.css",
        "@fan-support/ui/primitives.css",
      ].includes(specifier),
    ),
  ).toEqual([
    "@fan-support/ui/interactions.css",
    "@fan-support/ui/motion.css",
    "@fan-support/ui/primitives.css",
  ]);
});
