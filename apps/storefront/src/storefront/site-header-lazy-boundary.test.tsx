import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { LanguageControl } from "@fan-support/ui/interactions";
import { SiteHeader } from "./site-header";

const directory = fileURLToPath(new URL("./", import.meta.url));

/** Selected static imports only; the UI barrel's other exports are not presumed bundled. */
function initialMenuImports(entry: string): readonly string[] {
  const visited = new Set<string>();
  const menuImports = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (
        (!ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      let names: readonly string[];
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          names = bindings.elements
            .filter((element) => !element.isTypeOnly)
            .map((element) => (element.propertyName ?? element.name).text);
          if (!clause?.name && names.length === 0) continue;
          if (clause?.name) names = [...names, "default"];
        } else names = ["*"];
      } else {
        if (statement.isTypeOnly) continue;
        names =
          statement.exportClause && ts.isNamedExports(statement.exportClause)
            ? statement.exportClause.elements
                .filter((element) => !element.isTypeOnly)
                .map((element) => (element.propertyName ?? element.name).text)
            : ["*"];
        if (names.length === 0) continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (specifier === "@fan-support/ui/interactions") {
        for (const name of names)
          if (["LanguageControl", "RegionControl", "Menu", "*"].includes(name))
            menuImports.add(`${specifier}#${name}`);
      } else if (specifier.startsWith(".") && !specifier.endsWith(".css")) {
        const base = path.resolve(
          path.dirname(file),
          specifier.replace(/\.js$/u, ""),
        );
        const target = [base, `${base}.ts`, `${base}.tsx`].find((name) =>
          existsSync(name),
        );
        if (!target)
          throw new Error(`Unresolved header dependency: ${specifier}`);
        visit(target);
      }
    }
  }
  visit(path.join(directory, entry));
  return [...menuImports].sort();
}

test("the initial header has no static menu implementation before a language interaction", () => {
  expect(initialMenuImports("site-header.tsx")).toEqual([]);
});

function languageButton(markup: string) {
  const match = markup.match(
    /<button\b[^>]*class="[^"]*fs-menu__trigger[^"]*"[^>]*>([\s\S]*?)<\/button>/u,
  );
  if (!match) throw new Error("Missing server-rendered language trigger");
  return {
    opening: match[0].slice(0, match[0].indexOf(">") + 1),
    content: match[1],
  };
}

test.each(SUPPORTED_LOCALES)(
  "%s preserves the existing language trigger's SSR appearance and ARIA",
  async (locale) => {
    const copy = await loadStorefrontCopy(locale);
    const expected = languageButton(
      renderToStaticMarkup(
        <LanguageControl
          label={copy.language}
          value={locale}
          onValueChange={() => undefined}
        />,
      ),
    );
    const html = renderToStaticMarkup(
      <SiteHeader
        locale={locale}
        copy={copy}
        name="Fixture"
        contextQuery="market=GLOBAL&currency=USD"
        active="home"
      />,
    );
    const actual = languageButton(html);
    expect(actual.content).toBe(expected.content);
    expect(actual.opening).toContain('type="button"');
    expect(actual.opening).toContain('aria-haspopup="menu"');
    // Base UI omits aria-expanded until its trigger registers on the client.
    expect(actual.opening.match(/aria-expanded="[^"]*"/u)?.[0]).toBe(
      expected.opening.match(/aria-expanded="[^"]*"/u)?.[0],
    );
    expect(actual.opening).not.toMatch(/\bdisabled(?:=|\s|>)/u);
    expect(html).toContain(
      `href="/${locale}/idols?market=GLOBAL&amp;currency=USD"`,
    );
  },
);
