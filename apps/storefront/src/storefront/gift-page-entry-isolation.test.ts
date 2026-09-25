import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const directImports = new Map<string, readonly string[]>();

function runtimeImports(file: string): readonly string[] {
  const cached = directImports.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  for (const statement of source.statements) {
    if (
      (!ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement)) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const bindings = clause?.namedBindings;
      if (
        clause &&
        !clause.name &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.every((item) => item.isTypeOnly)
      )
        continue;
    } else {
      if (statement.isTypeOnly) continue;
      if (
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.every((item) => item.isTypeOnly)
      )
        continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".") || specifier.endsWith(".css")) continue;
    const base = path.resolve(
      path.dirname(file),
      specifier.replace(/\.js$/u, ""),
    );
    const target = [`${base}.ts`, `${base}.tsx`, base].find((candidate) =>
      existsSync(candidate),
    );
    if (!target) throw new Error(`Unresolved route dependency: ${specifier}`);
    imports.push(target);
  }
  directImports.set(file, imports);
  return imports;
}

/** Includes the route's page and metadata imports; type-only edges are erased. */
function initialRouteDependencies(locale: SupportedLocale, route: string) {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const dependency of runtimeImports(file)) visit(dependency);
  }
  visit(
    path.join(
      sourceRoot,
      "app/(public)",
      `(${FONT_PROFILE_BY_LOCALE[locale].id})`,
      locale,
      route,
      "page.tsx",
    ),
  );
  return visited;
}

const filters = path.join(sourceRoot, "storefront/gift-filters-client.tsx");
test.each(
  SUPPORTED_LOCALES.flatMap((locale) =>
    ["gifts/[handle]", "policies/[handle]", "region"].map((route) => ({
      locale,
      route,
    })),
  ),
)(
  "$locale/$route has no initial gift-directory filter dependency",
  ({ locale, route }) => {
    expect(initialRouteDependencies(locale, route)).not.toContain(filters);
  },
);

test.each(SUPPORTED_LOCALES)(
  "%s/gifts retains its server-rendered filter dependency",
  (locale) => {
    expect(initialRouteDependencies(locale, "gifts")).toContain(filters);
  },
);
