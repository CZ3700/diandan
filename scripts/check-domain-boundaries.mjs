import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const productionImports = new Set(["@fan-support/contracts"]);
const testImports = new Set(["@fan-support/contracts", "fast-check", "vitest"]);

async function readText(workspaceRoot, relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch {
    errors.push(`missing required domain boundary file: ${relativePath}`);
    return undefined;
  }
}

async function readJson(workspaceRoot, relativePath, errors) {
  const text = await readText(workspaceRoot, relativePath, errors);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${relativePath} must be valid JSON`);
    return undefined;
  }
}

async function walkSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(absolutePath)));
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

function isTestPath(relativePath) {
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relativePath) ||
    relativePath.includes("/test-support/")
  );
}

function isProductionPath(relativePath) {
  return !isTestPath(relativePath);
}

function moduleSpecifierFromNode(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression !== undefined &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  return undefined;
}

function constantString(node, stringAliases) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isIdentifier(node)) {
    return stringAliases.get(node.text);
  }
  return undefined;
}

function staticPropertyPath(node, pathAliases, stringAliases) {
  if (ts.isIdentifier(node)) {
    return pathAliases.get(node.text) ?? node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const parent = staticPropertyPath(
      node.expression,
      pathAliases,
      stringAliases,
    );
    if (parent === undefined) {
      return undefined;
    }
    return `${parent}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node)) {
    const property =
      node.argumentExpression === undefined
        ? undefined
        : constantString(node.argumentExpression, stringAliases);
    const parent = staticPropertyPath(
      node.expression,
      pathAliases,
      stringAliases,
    );
    if (property === undefined || parent === undefined) {
      return undefined;
    }
    return `${parent}.${property}`;
  }
  return undefined;
}

function bindingPropertyName(element, stringAliases) {
  const property = element.propertyName ?? element.name;
  if (ts.isIdentifier(property)) {
    return property.text;
  }
  if (ts.isComputedPropertyName(property)) {
    return constantString(property.expression, stringAliases);
  }
  if (
    ts.isStringLiteral(property) ||
    ts.isNoSubstitutionTemplateLiteral(property)
  ) {
    return property.text;
  }
  return undefined;
}

function collectConstAliasCandidates(sourceFile) {
  const candidates = [];

  function visit(node) {
    if (
      ts.isVariableDeclarationList(node) &&
      (node.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const declaration of node.declarations) {
        if (declaration.initializer === undefined) {
          continue;
        }
        if (ts.isIdentifier(declaration.name)) {
          candidates.push({
            kind: "direct",
            name: declaration.name.text,
            initializer: declaration.initializer,
          });
          continue;
        }
        if (ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            if (
              element.dotDotDotToken === undefined &&
              ts.isIdentifier(element.name)
            ) {
              candidates.push({
                kind: "property",
                name: element.name.text,
                initializer: declaration.initializer,
                element,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

function resolveConstAliases(sourceFile) {
  const candidates = collectConstAliasCandidates(sourceFile);
  const nameCounts = new Map();
  for (const candidate of candidates) {
    nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
  }

  const pathAliases = new Map();
  const stringAliases = new Map();
  let changed = true;
  // An acyclic chain with N aliases settles within N passes. The explicit
  // bound also makes malformed cyclic declarations safe to scan.
  for (let pass = 0; changed && pass <= candidates.length; pass += 1) {
    changed = false;
    for (const candidate of candidates) {
      if (nameCounts.get(candidate.name) !== 1) {
        continue;
      }

      if (candidate.kind === "direct") {
        const value = constantString(candidate.initializer, stringAliases);
        if (
          value !== undefined &&
          stringAliases.get(candidate.name) !== value
        ) {
          stringAliases.set(candidate.name, value);
          changed = true;
          continue;
        }
        const propertyPath = staticPropertyPath(
          candidate.initializer,
          pathAliases,
          stringAliases,
        );
        if (
          value === undefined &&
          propertyPath !== undefined &&
          pathAliases.get(candidate.name) !== propertyPath
        ) {
          pathAliases.set(candidate.name, propertyPath);
          changed = true;
        }
        continue;
      }

      const parent = staticPropertyPath(
        candidate.initializer,
        pathAliases,
        stringAliases,
      );
      const property = bindingPropertyName(candidate.element, stringAliases);
      if (parent !== undefined && property !== undefined) {
        const propertyPath = `${parent}.${property}`;
        if (pathAliases.get(candidate.name) !== propertyPath) {
          pathAliases.set(candidate.name, propertyPath);
          changed = true;
        }
      }
    }
  }

  return { pathAliases, stringAliases };
}

function isNonReferenceIdentifier(node, pathAliases) {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node)
  ) {
    return true;
  }
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent)) &&
    parent.name === node
  ) {
    return !pathAliases.has(node.text);
  }
  return false;
}

const forbiddenImplicitSources = new Set([
  "fetch",
  "WebSocket",
  "Date.now",
  "Math.random",
  "crypto.getRandomValues",
  "crypto.randomUUID",
  "globalThis.WebSocket",
  "globalThis.Date.now",
  "globalThis.Math.random",
  "globalThis.crypto.getRandomValues",
  "globalThis.crypto.randomUUID",
  "globalThis.fetch",
  "globalThis.performance.now",
  "performance.now",
  "setInterval",
  "setTimeout",
  "globalThis.setInterval",
  "globalThis.setTimeout",
]);

function inspectSyntax(sourceFile, relativePath, errors) {
  const imports = [];
  const production = isProductionPath(relativePath);
  const { pathAliases, stringAliases } = resolveConstAliases(sourceFile);

  function visit(node) {
    const staticSpecifier = moduleSpecifierFromNode(node);
    if (staticSpecifier !== undefined) {
      imports.push(staticSpecifier);
    }

    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument === undefined || !ts.isStringLiteral(argument)) {
        errors.push(`${relativePath} contains a non-literal dynamic import`);
      } else {
        imports.push(argument.text);
      }
    }

    if (production) {
      const propertyPath =
        ts.isIdentifier(node) && isNonReferenceIdentifier(node, pathAliases)
          ? undefined
          : staticPropertyPath(node, pathAliases, stringAliases);
      if (
        propertyPath !== undefined &&
        forbiddenImplicitSources.has(propertyPath)
      ) {
        errors.push(
          `${relativePath} uses forbidden implicit source ${propertyPath}`,
        );
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Date" &&
        (node.arguments?.length ?? 0) === 0
      ) {
        errors.push(`${relativePath} uses forbidden implicit clock new Date()`);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Date" &&
        node.arguments.length === 0
      ) {
        errors.push(`${relativePath} uses forbidden implicit clock Date()`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function resolveRelativeImport(sourcePath, specifier, sourceFiles) {
  const requested = path.resolve(path.dirname(sourcePath), specifier);
  const candidates = [requested];
  if (/\.m?js$/u.test(requested)) {
    candidates.push(requested.replace(/\.m?js$/u, ".ts"));
    candidates.push(requested.replace(/\.m?js$/u, ".tsx"));
  }
  candidates.push(path.join(requested, "index.ts"));
  return candidates.find((candidate) => sourceFiles.has(candidate));
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      visit(dependency);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }
  return cycles;
}

async function validateSourceBoundary(workspaceRoot, errors) {
  const sourceRoot = path.join(workspaceRoot, "packages/domain/src");
  let sourcePaths;
  try {
    sourcePaths = await walkSourceFiles(sourceRoot);
  } catch {
    errors.push("missing domain source directory: packages/domain/src");
    return;
  }
  const sourceFiles = new Set(sourcePaths);
  const graph = new Map();

  for (const sourcePath of sourcePaths) {
    const relativePath = path
      .relative(workspaceRoot, sourcePath)
      .split(path.sep)
      .join("/");
    const sourceFile = ts.createSourceFile(
      sourcePath,
      await readFile(sourcePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = inspectSyntax(sourceFile, relativePath, errors);
    const dependencies = [];
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) {
        const allowed = isTestPath(relativePath)
          ? testImports
          : productionImports;
        if (!allowed.has(specifier)) {
          errors.push(
            `${relativePath} imports forbidden dependency ${specifier}`,
          );
        }
        continue;
      }

      const requested = path.resolve(path.dirname(sourcePath), specifier);
      const relativeToSource = path.relative(sourceRoot, requested);
      if (
        relativeToSource === ".." ||
        relativeToSource.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToSource)
      ) {
        errors.push(
          `${relativePath} import ${specifier} escapes domain source`,
        );
        continue;
      }

      const resolved = resolveRelativeImport(
        sourcePath,
        specifier,
        sourceFiles,
      );
      if (resolved !== undefined) {
        if (
          isProductionPath(relativePath) &&
          !isProductionPath(
            path.relative(workspaceRoot, resolved).split(path.sep).join("/"),
          )
        ) {
          errors.push(
            `${relativePath} production code imports test-only module ${specifier}`,
          );
        } else if (
          isProductionPath(relativePath) &&
          isProductionPath(
            path.relative(workspaceRoot, resolved).split(path.sep).join("/"),
          )
        ) {
          dependencies.push(resolved);
        }
      }
    }
    if (isProductionPath(relativePath)) {
      graph.set(sourcePath, dependencies);
    }
  }

  for (const cycle of findCycles(graph)) {
    errors.push(
      `domain source dependency cycle: ${cycle
        .map((file) =>
          path.relative(sourceRoot, file).split(path.sep).join("/"),
        )
        .join(" -> ")}`,
    );
  }
}

function validateManifests(rootManifest, domainManifest, errors) {
  if (
    !rootManifest?.scripts?.check?.includes(
      "node --test ./scripts/check-domain-boundaries.test.mjs",
    )
  ) {
    errors.push(
      "root check must run the domain boundary self-test before validation",
    );
  }
  if (
    !rootManifest?.scripts?.check?.includes(
      "node ./scripts/check-domain-boundaries.mjs",
    )
  ) {
    errors.push(
      "root check must run node ./scripts/check-domain-boundaries.mjs",
    );
  }
  if (rootManifest?.devDependencies?.["@vitest/coverage-v8"] !== "4.1.11") {
    errors.push("root must pin @vitest/coverage-v8 to 4.1.11");
  }
  if (!domainManifest?.scripts?.test?.includes("--coverage")) {
    errors.push("domain test script must enable coverage");
  }
  if (
    domainManifest?.dependencies?.["@fan-support/contracts"] !== "workspace:*"
  ) {
    errors.push("domain must depend on @fan-support/contracts via workspace:*");
  }
  const runtimeDependencies = Object.keys(domainManifest?.dependencies ?? {});
  if (
    runtimeDependencies.length !== 1 ||
    runtimeDependencies[0] !== "@fan-support/contracts"
  ) {
    errors.push(
      "domain runtime dependency allowlist permits only @fan-support/contracts",
    );
  }
  if (domainManifest?.devDependencies?.["fast-check"] !== "4.9.0") {
    errors.push("domain must pin fast-check to 4.9.0");
  }
}

function validateCoverageConfig(text, errors) {
  const compact = text.replace(/\s+/gu, "");
  if (!compact.includes('provider:"v8"')) {
    errors.push("Vitest domain coverage provider must be v8");
  }
  if (!compact.includes('include:["src/**/*.ts"]')) {
    errors.push("Vitest domain coverage must include every src/**/*.ts file");
  }
  if (!compact.includes('"src/test-support/**"')) {
    errors.push("Vitest domain coverage must exclude src/test-support/**");
  }
  if (!compact.includes('reporter:["text","json-summary"]')) {
    errors.push(
      "Vitest domain coverage must emit text and json-summary reports",
    );
  }
  const branchThreshold = compact.match(/branches:(\d+(?:\.\d+)?)/u)?.[1];
  if (branchThreshold === undefined || Number(branchThreshold) < 90) {
    errors.push("Vitest domain branch threshold must be at least 90");
  }
}

export async function validateDomainBoundaries(
  workspaceRoot = defaultWorkspaceRoot,
) {
  const errors = [];
  const [rootManifest, domainManifest, vitestConfig] = await Promise.all([
    readJson(workspaceRoot, "package.json", errors),
    readJson(workspaceRoot, "packages/domain/package.json", errors),
    readText(workspaceRoot, "vitest.config.ts", errors),
  ]);
  validateManifests(rootManifest, domainManifest, errors);
  if (vitestConfig !== undefined) {
    validateCoverageConfig(vitestConfig, errors);
  }
  await validateSourceBoundary(workspaceRoot, errors);
  return errors;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  const errors = await validateDomainBoundaries();
  if (errors.length > 0) {
    console.error("Domain boundary validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Domain boundary validation passed");
  }
}
