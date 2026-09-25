import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contractsDirectory = path.join(workspaceRoot, "packages", "contracts");
const generatedDirectory = path.join(contractsDirectory, "generated");
const expectedArtifacts = ["contracts.schema.json", "openapi.json"];
const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
]);

async function collectSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(absolutePath)));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

function scriptKindFor(file) {
  const extension = path.extname(file);
  if (extension === ".tsx") {
    return ts.ScriptKind.TSX;
  }
  if (extension === ".jsx") {
    return ts.ScriptKind.JSX;
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function literalText(node) {
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

function propertyNameText(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node)
    ? node.text
    : undefined;
}

function isExactLocaleSet(values, supportedLocales) {
  return (
    values.length === supportedLocales.length &&
    new Set(values).size === supportedLocales.length &&
    supportedLocales.every((locale) => values.includes(locale))
  );
}

function duplicateLocaleOwnershipLocations(file, source, supportedLocales) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const locations = [];
  const reservedNames = new Set([
    "SUPPORTED_LOCALES",
    "DEFAULT_LOCALE",
    "LOCALE_NATIVE_NAMES",
    "SupportedLocale",
  ]);

  function record(node, reason) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    locations.push(`${reason} at line ${line + 1}`);
  }

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      reservedNames.has(node.name.text)
    ) {
      record(node, `redeclares contracts-owned ${node.name.text}`);
    }
    if (
      (ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      reservedNames.has(node.name.text)
    ) {
      record(node, `redeclares contracts-owned ${node.name.text}`);
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map(literalText);
      if (
        values.every((value) => value !== undefined) &&
        isExactLocaleSet(values, supportedLocales)
      ) {
        record(node, "duplicates the complete SupportedLocale array");
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const keys = node.properties
        .map((property) =>
          "name" in property ? propertyNameText(property.name) : undefined,
        )
        .filter((value) => value !== undefined);
      if (isExactLocaleSet(keys, supportedLocales)) {
        record(node, "duplicates the complete locale-keyed map");
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return locations;
}

const rendererUrl = pathToFileURL(
  path.join(contractsDirectory, "dist", "artifact-documents.js"),
);
const contractsUrl = pathToFileURL(
  path.join(contractsDirectory, "dist", "index.js"),
);
const [{ renderContractArtifactDocuments }, contracts] = await Promise.all([
  import(rendererUrl.href),
  import(contractsUrl.href),
]);
const rendered = renderContractArtifactDocuments();
const errors = [];

let actualArtifactNames = [];
try {
  actualArtifactNames = (await readdir(generatedDirectory)).sort();
} catch (error) {
  errors.push(
    `missing generated contract directory: ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (actualArtifactNames.join("\n") !== expectedArtifacts.join("\n")) {
  errors.push(
    `generated contract files must be exactly: ${expectedArtifacts.join(", ")}`,
  );
}

for (const [fileName, expected] of [
  ["contracts.schema.json", rendered.jsonSchema],
  ["openapi.json", rendered.openapi],
]) {
  let actual;
  try {
    actual = await readFile(path.join(generatedDirectory, fileName), "utf8");
  } catch (error) {
    errors.push(
      `${fileName} is missing: ${error instanceof Error ? error.message : String(error)}`,
    );
    continue;
  }
  if (actual !== expected) {
    errors.push(`${fileName} is stale; run pnpm contracts:generate`);
  }
}

for (const sourceRoot of ["apps", "packages"]) {
  const absoluteRoot = path.join(workspaceRoot, sourceRoot);
  for (const file of await collectSourceFiles(absoluteRoot)) {
    if (file.startsWith(contractsDirectory + path.sep)) {
      continue;
    }
    const source = await readFile(file, "utf8");
    const duplicates = duplicateLocaleOwnershipLocations(
      file,
      source,
      contracts.SUPPORTED_LOCALES,
    );
    for (const duplicate of duplicates) {
      errors.push(`${path.relative(workspaceRoot, file)} ${duplicate}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Contract artifacts are fresh: 2 documents, canonical locale ownership preserved.",
  );
}
