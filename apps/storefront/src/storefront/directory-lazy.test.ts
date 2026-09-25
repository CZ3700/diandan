import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test, vi } from "vitest";

const directory = fileURLToPath(new URL("./", import.meta.url));

function initialDirectoryDependencies(entry: string): readonly string[] {
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join(directory, file), "utf8"),
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
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        if (
          clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly)
        )
          continue;
      } else if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      // This boundary owns directory code, not the independently audited shared UI/navigation.
      if (
        /^\.\/(artist-|directory-)/u.test(specifier) &&
        !specifier.endsWith(".css")
      ) {
        const base = specifier.replace(/^\.\//u, "").replace(/\.js$/u, "");
        const target = [base + ".ts", base + ".tsx"].find((name) =>
          existsSync(path.join(directory, name)),
        );
        if (!target)
          throw new Error(`Missing directory dependency: ${specifier}`);
        visit(target);
      } else visited.add(specifier);
    }
  }
  visit(entry);
  return [...visited].sort();
}

test.each([
  "artist-directory.tsx",
  "artist-search.tsx",
  "directory-model.ts",
  "directory-request.ts",
])(
  "%s does not synchronously initialize directory schemas before interaction",
  (entry) => {
    const dependencies = initialDirectoryDependencies(entry);
    expect(dependencies).not.toContain("@fan-support/contracts");
    expect(dependencies).not.toContain("zod");
    expect(dependencies).not.toContain("directory-validation.ts");
  },
);

test("an already cancelled interaction does not fetch even when fetch ignores AbortSignal", async () => {
  const { requestArtistDirectory } = await import("./directory-request");
  const cancellation = new AbortController();
  cancellation.abort();
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_CHANGED",
    }),
  );
  await expect(
    requestArtistDirectory(
      { schemaVersion: 1, locale: "en", limit: 12 },
      cancellation.signal,
      request,
    ),
  ).resolves.toMatchObject({ outcome: "FAILURE", code: "CATALOG_UNAVAILABLE" });
  expect(request).not.toHaveBeenCalled();
});

test("cancellation while a response body is pending cannot deliver a successful result", async () => {
  const { requestArtistDirectory } = await import("./directory-request");
  const cancellation = new AbortController();
  const result = requestArtistDirectory(
    { schemaVersion: 1, locale: "en", limit: 12 },
    cancellation.signal,
    async () => {
      cancellation.abort();
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        catalogVersion: "a".repeat(64),
        items: [],
        pageInfo: { schemaVersion: 1, hasNextPage: false, endCursor: null },
      });
    },
  );
  await expect(result).resolves.toMatchObject({
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
});
