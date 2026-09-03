import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const adapterPackageNames = new Set([
  "cache-purge-cdn",
  "identity-oidc",
  "key-management-kms",
  "media-s3",
  "notification-provider",
  "payment-fake",
  "persistence-postgres",
]);
const legacyWebhookCompatibilityRoots = new Set([
  "packages/contracts",
  "packages/payment-fake",
  "packages/payment-port",
  "packages/testing",
]);
const forbiddenLegacyWebhookTokens = new Set([
  "LEGACY_WEBHOOK_PARSER_OPERATIONS",
  "LegacyWebhookParser",
  "VERIFY_AND_PARSE_WEBHOOK",
  "VerifyAndParseWebhookCommand",
  "VerifyAndParseWebhookResponse",
  "verifyAndParseWebhook",
]);

const portableExternalDependencies = new Set([
  "entities",
  "fast-check",
  "fastify",
  "vitest",
  "zod",
]);
const portableScopedDependencies = new Set([
  "@opentelemetry/api",
  "@opentelemetry/core",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-trace-node",
  "@opentelemetry/semantic-conventions",
  "@types/node",
]);
const builtinModuleSpecifiers = new Set(
  builtinModules.flatMap((specifier) => [
    specifier,
    specifier.startsWith("node:") ? specifier : `node:${specifier}`,
  ]),
);

function packageNameFromSpecifier(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

function isKnownAdapterModuleSpecifier(specifier) {
  const packageName = packageNameFromSpecifier(specifier);
  return (
    packageName.startsWith("@fan-support/") &&
    adapterPackageNames.has(packageName.slice("@fan-support/".length))
  );
}

function isReviewedPortableModule(specifier, workspacePackageNames) {
  const packageName = packageNameFromSpecifier(specifier);
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    workspacePackageNames.has(packageName) ||
    portableScopedDependencies.has(packageName) ||
    builtinModuleSpecifiers.has(specifier) ||
    portableExternalDependencies.has(packageName)
  );
}

function isForbiddenProvider(
  specifier,
  workspacePackageNames,
  rejectWorkspaceAdapters,
) {
  return (
    (rejectWorkspaceAdapters && isKnownAdapterModuleSpecifier(specifier)) ||
    !isReviewedPortableModule(specifier, workspacePackageNames)
  );
}

function parseNpmAliasTarget(value) {
  if (typeof value !== "string" || !value.startsWith("npm:")) {
    return { isAlias: false, packageName: undefined };
  }

  const alias = value.slice("npm:".length);
  let packageName;
  let version;
  if (alias.startsWith("@")) {
    const slashIndex = alias.indexOf("/");
    const versionIndex =
      slashIndex < 0 ? -1 : alias.indexOf("@", slashIndex + 1);
    packageName = versionIndex < 0 ? alias : alias.slice(0, versionIndex);
    version = versionIndex < 0 ? undefined : alias.slice(versionIndex + 1);
  } else {
    const versionIndex = alias.indexOf("@");
    packageName = versionIndex < 0 ? alias : alias.slice(0, versionIndex);
    version = versionIndex < 0 ? undefined : alias.slice(versionIndex + 1);
  }

  const packageSegment = /^[a-z0-9][a-z0-9._~-]*$/iu;
  const validPackageName = packageName.startsWith("@")
    ? (() => {
        const [scope, name, ...extra] = packageName.slice(1).split("/");
        return (
          extra.length === 0 &&
          scope !== undefined &&
          name !== undefined &&
          packageSegment.test(scope) &&
          packageSegment.test(name)
        );
      })()
    : packageSegment.test(packageName);
  const validVersion =
    version === undefined || (version.length > 0 && !/\s/u.test(version));

  return {
    isAlias: true,
    packageName: validPackageName && validVersion ? packageName : undefined,
  };
}

function toWorkspacePath(workspaceRoot, absolutePath) {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
}

async function pathExists(absolutePath) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(directory, accepts) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath, accepts)));
    } else if (entry.isFile() && accepts(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

function literalModuleName(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function collectModuleSpecifiers(sourceFile) {
  const specifiers = [];

  for (const reference of sourceFile.referencedFiles) {
    specifiers.push(reference.fileName);
  }
  for (const reference of sourceFile.typeReferenceDirectives) {
    specifiers.push(
      reference.fileName.startsWith("@types/")
        ? reference.fileName
        : `@types/${reference.fileName}`,
    );
  }

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined
    ) {
      const specifier = literalModuleName(node.moduleSpecifier);
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined
    ) {
      const specifier = literalModuleName(node.moduleReference.expression);
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = ts.isLiteralTypeNode(node.argument)
        ? literalModuleName(node.argument.literal)
        : undefined;
      if (argument !== undefined) {
        specifiers.push(argument);
      }
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const specifier = node.arguments[0]
        ? literalModuleName(node.arguments[0])
        : undefined;
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...new Set(specifiers)];
}

function workspaceUnitPath(relativePath) {
  const [parentDirectory, unitName] = relativePath.split("/");
  return parentDirectory === undefined || unitName === undefined
    ? undefined
    : `${parentDirectory}/${unitName}`;
}

function inspectLegacyWebhookSyntax(sourceFile, relativePath, errors) {
  const unitPath = workspaceUnitPath(relativePath);
  if (unitPath !== undefined && legacyWebhookCompatibilityRoots.has(unitPath)) {
    return;
  }

  const reportedTokens = new Set();
  function visit(node) {
    const token =
      ts.isIdentifier(node) ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : undefined;
    if (
      token !== undefined &&
      forbiddenLegacyWebhookTokens.has(token) &&
      !reportedTokens.has(token)
    ) {
      reportedTokens.add(token);
      const location = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      errors.push(
        `${relativePath}:${location.line + 1}:${location.character + 1} uses forbidden legacy webhook surface ${token}`,
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

async function validateLegacyWebhookBoundary(workspaceRoot, errors) {
  for (const parentDirectory of ["apps", "packages"]) {
    const absoluteParent = path.join(workspaceRoot, parentDirectory);
    let entries;
    try {
      entries = await readdir(absoluteParent, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const sourceDirectory = path.join(absoluteParent, entry.name, "src");
      if (!(await pathExists(sourceDirectory))) {
        continue;
      }
      const sourceFiles = await walkFiles(sourceDirectory, (name) =>
        /\.[cm]?[jt]sx?$/u.test(name),
      );
      for (const sourcePath of sourceFiles) {
        const relativePath = toWorkspacePath(workspaceRoot, sourcePath);
        const sourceFile = ts.createSourceFile(
          sourcePath,
          await readFile(sourcePath, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        inspectLegacyWebhookSyntax(sourceFile, relativePath, errors);
      }
    }
  }
}

async function inspectProviderImports(
  workspaceRoot,
  absolutePath,
  errors,
  workspacePackageNames,
  rejectWorkspaceAdapters = false,
) {
  const relativePath = toWorkspacePath(workspaceRoot, absolutePath);
  const sourceFile = ts.createSourceFile(
    absolutePath,
    await readFile(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers = collectModuleSpecifiers(sourceFile);
  for (const specifier of specifiers) {
    if (
      isForbiddenProvider(
        specifier,
        workspacePackageNames,
        rejectWorkspaceAdapters,
      )
    ) {
      errors.push(
        `${relativePath} imports forbidden provider dependency ${specifier}`,
      );
    }
  }
  return specifiers;
}

function inspectInnerLayerFilesystemImports(
  workspaceRoot,
  packageDirectory,
  sourcePath,
  specifiers,
  errors,
) {
  const relativeSourcePath = toWorkspacePath(workspaceRoot, sourcePath);
  for (const specifier of specifiers) {
    const isAbsoluteSpecifier =
      path.isAbsolute(specifier) ||
      /^[a-z]:[\\/]/iu.test(specifier) ||
      specifier.startsWith("\\\\");
    if (isAbsoluteSpecifier) {
      errors.push(
        `${relativeSourcePath} uses forbidden absolute filesystem import ${specifier}`,
      );
      continue;
    }
    if (!specifier.startsWith(".")) {
      continue;
    }

    const resolved = path.resolve(path.dirname(sourcePath), specifier);
    if (!isPathWithinOrEqual(packageDirectory, resolved)) {
      errors.push(
        `${relativeSourcePath} import ${specifier} escapes inner-layer package`,
      );
    }
  }
}

async function validateInnerLayerPackage(
  workspaceRoot,
  packageDirectory,
  workspacePackageNames,
  errors,
) {
  const sourceDirectory = path.join(packageDirectory, "src");
  const declarationDirectory = path.join(packageDirectory, "dist");
  const packagePath = toWorkspacePath(workspaceRoot, packageDirectory);
  const manifestPath = path.join(packageDirectory, "package.json");

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    errors.push(
      `missing or invalid inner-layer manifest: ${packagePath}/package.json`,
    );
  }
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = manifest?.[section];
    if (
      dependencies === undefined ||
      typeof dependencies !== "object" ||
      dependencies === null ||
      Array.isArray(dependencies)
    ) {
      continue;
    }
    for (const [dependency, version] of Object.entries(dependencies)) {
      if (isForbiddenProvider(dependency, workspacePackageNames, true)) {
        errors.push(
          `${packagePath}/package.json declares forbidden provider dependency ${dependency} in ${section}`,
        );
      }
      const aliasTarget = parseNpmAliasTarget(version);
      if (aliasTarget.isAlias && aliasTarget.packageName === undefined) {
        errors.push(
          `${packagePath}/package.json declares malformed npm alias for ${dependency} in ${section}`,
        );
      } else if (
        aliasTarget.packageName !== undefined &&
        isForbiddenProvider(
          aliasTarget.packageName,
          workspacePackageNames,
          true,
        )
      ) {
        errors.push(
          `${packagePath}/package.json declares forbidden provider npm alias target ${aliasTarget.packageName} via ${dependency} in ${section}`,
        );
      }
    }
  }

  if (!(await pathExists(sourceDirectory))) {
    errors.push(`missing inner-layer source directory: ${packagePath}/src`);
  } else {
    const sourceFiles = await walkFiles(sourceDirectory, (name) =>
      /\.[cm]?[jt]sx?$/u.test(name),
    );
    for (const sourceFile of sourceFiles) {
      const specifiers = await inspectProviderImports(
        workspaceRoot,
        sourceFile,
        errors,
        workspacePackageNames,
        true,
      );
      inspectInnerLayerFilesystemImports(
        workspaceRoot,
        packageDirectory,
        sourceFile,
        specifiers,
        errors,
      );
    }
  }

  if (!(await pathExists(declarationDirectory))) {
    errors.push(
      `missing emitted inner-layer declarations: ${packagePath}/dist`,
    );
    return;
  }

  const declarations = await walkFiles(declarationDirectory, (name) =>
    /\.d\.[cm]?ts$/u.test(name),
  );
  if (declarations.length === 0) {
    errors.push(
      `missing emitted inner-layer declarations: ${packagePath}/dist`,
    );
    return;
  }
  for (const declaration of declarations) {
    const specifiers = await inspectProviderImports(
      workspaceRoot,
      declaration,
      errors,
      workspacePackageNames,
      true,
    );
    inspectInnerLayerFilesystemImports(
      workspaceRoot,
      packageDirectory,
      declaration,
      specifiers,
      errors,
    );
  }
}

async function resolveDeclarationImport(sourcePath, specifier) {
  const requested = path.resolve(path.dirname(sourcePath), specifier);
  const candidates = [requested];

  if (/\.mjs$/u.test(requested)) {
    candidates.push(requested.replace(/\.mjs$/u, ".d.mts"));
  } else if (/\.cjs$/u.test(requested)) {
    candidates.push(requested.replace(/\.cjs$/u, ".d.cts"));
  } else if (/\.js$/u.test(requested)) {
    candidates.push(requested.replace(/\.js$/u, ".d.ts"));
  } else if (!path.extname(requested)) {
    candidates.push(`${requested}.d.ts`);
    candidates.push(`${requested}.d.mts`);
    candidates.push(`${requested}.d.cts`);
    candidates.push(path.join(requested, "index.d.ts"));
  }

  for (const candidate of candidates) {
    if ((await pathExists(candidate)) && /\.d\.[cm]?ts$/u.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function resolveWorkspaceDeclarationImport(
  workspacePackageDirectories,
  specifier,
) {
  const packageNames = [...workspacePackageDirectories.keys()].sort(
    (left, right) => right.length - left.length,
  );
  const packageName = packageNames.find(
    (candidate) =>
      specifier === candidate || specifier.startsWith(`${candidate}/`),
  );
  if (packageName === undefined) {
    return { known: false, path: undefined };
  }
  const packageDirectory = workspacePackageDirectories.get(packageName);
  const subpath =
    specifier === packageName
      ? "index"
      : specifier.slice(packageName.length + 1);
  const requested = path.join(packageDirectory, "dist", subpath);
  const candidates = [requested];
  if (/\.mjs$/u.test(requested)) {
    candidates.push(requested.replace(/\.mjs$/u, ".d.mts"));
  } else if (/\.cjs$/u.test(requested)) {
    candidates.push(requested.replace(/\.cjs$/u, ".d.cts"));
  } else if (/\.js$/u.test(requested)) {
    candidates.push(requested.replace(/\.js$/u, ".d.ts"));
  } else {
    candidates.push(`${requested}.d.ts`);
    candidates.push(`${requested}.d.mts`);
    candidates.push(`${requested}.d.cts`);
    candidates.push(path.join(requested, "index.d.ts"));
  }
  for (const candidate of candidates) {
    if ((await pathExists(candidate)) && /\.d\.[cm]?ts$/u.test(candidate)) {
      return { known: true, path: candidate };
    }
  }
  return { known: true, path: undefined };
}

function collectNestedTypeTargets(value, source, targets, errors, packagePath) {
  if (typeof value === "string") {
    targets.push({ source, target: value });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      errors.push(
        `${packagePath}/package.json has malformed public types target at ${source}`,
      );
      return;
    }
    for (const [index, entry] of value.entries()) {
      collectNestedTypeTargets(
        entry,
        `${source}[${index}]`,
        targets,
        errors,
        packagePath,
      );
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      errors.push(
        `${packagePath}/package.json has malformed public types target at ${source}`,
      );
      return;
    }
    for (const [condition, entry] of entries) {
      collectNestedTypeTargets(
        entry,
        `${source}.${condition}`,
        targets,
        errors,
        packagePath,
      );
    }
    return;
  }
  errors.push(
    `${packagePath}/package.json has malformed public types target at ${source}`,
  );
}

function collectExportTypeTargets(value, source, targets, errors, packagePath) {
  if (typeof value === "string") {
    if (/\.d\.[cm]?ts$/u.test(value)) {
      targets.push({ source, target: value });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      collectExportTypeTargets(
        entry,
        `${source}[${index}]`,
        targets,
        errors,
        packagePath,
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [condition, entry] of Object.entries(value)) {
    const entrySource = `${source}.${condition}`;
    if (condition === "types") {
      collectNestedTypeTargets(
        entry,
        entrySource,
        targets,
        errors,
        packagePath,
      );
    } else {
      collectExportTypeTargets(
        entry,
        entrySource,
        targets,
        errors,
        packagePath,
      );
    }
  }
}

function isPathWithinOrEqual(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isPathWithin(directory, candidate) {
  return directory !== candidate && isPathWithinOrEqual(directory, candidate);
}

async function resolvePublicTypeTarget(
  packageDirectory,
  packagePath,
  root,
  errors,
) {
  const { source, target } = root;
  if (
    target.length === 0 ||
    target.trim() !== target ||
    target.includes("\0") ||
    target.includes("\\") ||
    (!target.startsWith("./") && source.startsWith("exports")) ||
    !/\.d\.[cm]?ts$/u.test(target)
  ) {
    errors.push(
      `${packagePath}/package.json has malformed public types target ${JSON.stringify(target)} at ${source}`,
    );
    return undefined;
  }

  const absoluteTarget = path.resolve(packageDirectory, target);
  if (!isPathWithin(packageDirectory, absoluteTarget)) {
    errors.push(
      `${packagePath}/package.json public types target ${JSON.stringify(target)} at ${source} escapes adapter package`,
    );
    return undefined;
  }
  if (!(await pathExists(absoluteTarget))) {
    errors.push(
      `${packagePath}/package.json public types target ${JSON.stringify(target)} at ${source} does not exist`,
    );
    return undefined;
  }

  const [canonicalPackage, canonicalTarget] = await Promise.all([
    realpath(packageDirectory),
    realpath(absoluteTarget),
  ]);
  if (!isPathWithin(canonicalPackage, canonicalTarget)) {
    errors.push(
      `${packagePath}/package.json public types target ${JSON.stringify(target)} at ${source} escapes adapter package`,
    );
    return undefined;
  }
  return canonicalTarget;
}

async function validateAdapterPublicDeclarations(
  workspaceRoot,
  packageDirectory,
  workspacePackageDirectories,
  errors,
) {
  const packagePath = toWorkspacePath(workspaceRoot, packageDirectory);
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    );
  } catch {
    errors.push(
      `missing or invalid adapter manifest: ${packagePath}/package.json`,
    );
    return;
  }

  const publicTypeTargets = [];
  for (const field of ["types", "typings"]) {
    const value = manifest?.[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      errors.push(
        `${packagePath}/package.json has malformed public types target at ${field}`,
      );
    } else {
      publicTypeTargets.push({ source: field, target: value });
    }
  }
  collectExportTypeTargets(
    manifest?.exports,
    "exports",
    publicTypeTargets,
    errors,
    packagePath,
  );
  if (manifest?.typesVersions !== undefined) {
    collectNestedTypeTargets(
      manifest.typesVersions,
      "typesVersions",
      publicTypeTargets,
      errors,
      packagePath,
    );
  }
  if (publicTypeTargets.length === 0) {
    errors.push(
      `${packagePath}/package.json must declare at least one public types target via types, typings, or exports`,
    );
    return;
  }

  const declarationRoots = (
    await Promise.all(
      publicTypeTargets.map((root) =>
        resolvePublicTypeTarget(packageDirectory, packagePath, root, errors),
      ),
    )
  ).filter((root) => root !== undefined);

  const visited = new Set();
  async function visit(declarationPath) {
    if (visited.has(declarationPath)) {
      return;
    }
    visited.add(declarationPath);

    const specifiers = await inspectProviderImports(
      workspaceRoot,
      declarationPath,
      errors,
      new Set(workspacePackageDirectories.keys()),
    );
    for (const specifier of specifiers) {
      const workspaceResolution = specifier.startsWith(".")
        ? {
            known: true,
            path: await resolveDeclarationImport(declarationPath, specifier),
          }
        : await resolveWorkspaceDeclarationImport(
            workspacePackageDirectories,
            specifier,
          );
      if (!workspaceResolution.known) {
        continue;
      }
      const resolved = workspaceResolution.path;
      if (resolved === undefined) {
        errors.push(
          `${toWorkspacePath(workspaceRoot, declarationPath)} has unresolved public declaration import ${specifier}`,
        );
      } else {
        await visit(resolved);
      }
    }
  }

  for (const declarationRoot of declarationRoots) {
    await visit(declarationRoot);
  }
}

async function validateCheckWiring(workspaceRoot, errors) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    );
  } catch {
    errors.push("package.json must exist and contain valid JSON");
    return;
  }

  const check = manifest?.scripts?.check;
  if (typeof check !== "string") {
    errors.push("root package.json must define the check script");
    return;
  }

  const selfTest = "node --test ./scripts/check-adapter-boundaries.test.mjs";
  const validation = "node ./scripts/check-adapter-boundaries.mjs";
  if (!check.includes(selfTest)) {
    errors.push("root check must run the adapter boundary self-test");
  }
  const buildIndex = check.indexOf("turbo run build");
  const validationIndex = check.lastIndexOf(validation);
  if (validationIndex < 0) {
    errors.push("root check must run adapter boundary validation");
  } else if (buildIndex < 0 || validationIndex < buildIndex) {
    errors.push(
      "root check must run adapter declaration validation after the workspace build",
    );
  }
}

export async function validateAdapterBoundaries(
  workspaceRoot = defaultWorkspaceRoot,
) {
  const errors = [];
  await validateCheckWiring(workspaceRoot, errors);
  await validateLegacyWebhookBoundary(workspaceRoot, errors);

  const packagesDirectory = path.join(workspaceRoot, "packages");
  let entries;
  try {
    entries = await readdir(packagesDirectory, { withFileTypes: true });
  } catch {
    errors.push("missing workspace packages directory: packages");
    return errors;
  }

  const workspacePackageDirectories = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageDirectory = path.join(packagesDirectory, entry.name);
    try {
      const manifest = JSON.parse(
        await readFile(path.join(packageDirectory, "package.json"), "utf8"),
      );
      if (typeof manifest?.name === "string") {
        workspacePackageDirectories.set(manifest.name, packageDirectory);
      }
    } catch {
      // Inner-layer validation reports missing or malformed manifests.
    }
  }
  const workspacePackageNames = new Set(workspacePackageDirectories.keys());

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageDirectory = path.join(packagesDirectory, entry.name);
    if (!adapterPackageNames.has(entry.name)) {
      await validateInnerLayerPackage(
        workspaceRoot,
        packageDirectory,
        workspacePackageNames,
        errors,
      );
    }
    if (adapterPackageNames.has(entry.name)) {
      await validateAdapterPublicDeclarations(
        workspaceRoot,
        packageDirectory,
        workspacePackageDirectories,
        errors,
      );
    }
  }

  return [...new Set(errors)].sort();
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  const errors = await validateAdapterBoundaries();
  if (errors.length > 0) {
    console.error("Adapter boundary validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      "Adapter boundary validation passed: inner layers are provider-free, adapter public declarations are portable, and legacy webhook parsing stays in compatibility packages.",
    );
  }
}
