import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceDirectory = fileURLToPath(new URL("../src/", import.meta.url));

function readModule(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(sourceDirectory, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function localModule(file: string, specifier: string): string {
  return path.join(path.dirname(file), specifier).replace(/\.js$/u, ".ts");
}

/** Follow an existing named export, so RED observes the old module's real dependency. */
export function declarationModule(file: string, name: string): string {
  for (const statement of readModule(file).statements) {
    if (
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) && declaration.name.text === name,
        )) ||
      (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
    )
      return file;
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const exported = statement.exportClause.elements.find(
        (element) => element.name.text === name,
      );
      if (exported)
        return declarationModule(
          localModule(file, statement.moduleSpecifier.text),
          exported.propertyName?.text ?? exported.name.text,
        );
    }
  }
  throw new Error(`No declaration found for ${file}:${name}`);
}

/** Model module evaluation edges, excluding types erased before JavaScript execution. */
export function runtimeDependencies(entry: string): readonly string[] {
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    if (!file.endsWith(".ts")) return;
    for (const statement of readModule(file).statements) {
      if (
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement)
      )
        continue;
      if (
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
          clause.namedBindings.elements.every((element) => element.isTypeOnly)
        )
          continue;
      } else if (
        statement.isTypeOnly ||
        (statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.every(
            (element) => element.isTypeOnly,
          ))
      )
        continue;
      const specifier = statement.moduleSpecifier.text;
      visit(
        specifier.startsWith(".") ? localModule(file, specifier) : specifier,
      );
    }
  }
  visit(entry);
  return [...visited].sort();
}
