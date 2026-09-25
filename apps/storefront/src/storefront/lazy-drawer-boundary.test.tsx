import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import ts from "typescript";

test.each(["site-header.tsx", "gift-recipient.tsx", "gift-filters-client.tsx"])(
  "%s has no eager Drawer runtime import",
  (filename) => {
    const source = ts.createSourceFile(
      filename,
      readFileSync(new URL(filename, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const eager = source.statements
      .filter(ts.isImportDeclaration)
      .filter((statement) => {
        const clause = statement.importClause;
        if (
          !clause ||
          clause.isTypeOnly ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== "@fan-support/ui/interactions"
        )
          return false;
        return (
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.some(
            (element) =>
              !element.isTypeOnly &&
              (element.propertyName ?? element.name).text === "Drawer",
          )
        );
      });
    expect(eager).toEqual([]);
  },
);

test("the initial native Drawer trigger preserves the existing SSR content and ARIA", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Drawer } = await import("@fan-support/ui/interactions");
  const { LazyDrawer } = await import("./lazy-drawer");
  const props = {
    open: false,
    onOpenChange: () => undefined,
    title: "Fixture",
    description: "Description",
    closeLabel: "Close",
    triggerLabel: "Open fixture",
  };
  const original = renderToStaticMarkup(<Drawer {...props} />);
  const actual = renderToStaticMarkup(
    <LazyDrawer
      {...props}
      loadingLabel="Loading"
      errorLabel="Error"
      retryLabel="Retry"
    />,
  );
  const originalButton = original.match(
    /<button\b[^>]*>([\s\S]*?)<\/button>/u,
  )!;
  const actualButton = actual.match(/<button\b[^>]*>([\s\S]*?)<\/button>/u)!;
  expect(actualButton[1]).toBe(originalButton[1]);
  for (const attribute of [
    "class",
    "type",
    "tabindex",
    "aria-haspopup",
    "aria-expanded",
    "data-overlay-trigger",
  ]) {
    const pattern = new RegExp(`${attribute}="[^"]*"`, "u");
    expect(actualButton[0].match(pattern)?.[0]).toBe(
      originalButton[0].match(pattern)?.[0],
    );
  }
});
