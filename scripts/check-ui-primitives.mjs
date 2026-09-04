import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");

const UI_MANIFEST_PATH = "packages/ui/package.json";
const ROOT_MANIFEST_PATH = "package.json";
const UI_ROOT_PATH = "packages/ui/src/index.ts";
const UI_CLIENT_PATH = "packages/ui/src/client.ts";
const UI_CSS_PATH = "packages/ui/styles/primitives.css";
const TOKEN_SOURCE_PATH = "packages/design-tokens/src/tokens.ts";
const STOREFRONT_MANIFEST_PATH = "apps/storefront/package.json";
const STOREFRONT_GLOBAL_CSS_PATH = "apps/storefront/src/app/globals.css";
const ADMIN_MANIFEST_PATH = "apps/admin/package.json";
const ADMIN_GLOBAL_CSS_PATH = "apps/admin/src/app/globals.css";
const STOREFRONT_POSTCSS_PATH = "apps/storefront/postcss.config.mjs";
const ADMIN_POSTCSS_PATH = "apps/admin/postcss.config.mjs";
const SPECIMEN_PATH = "apps/storefront/src/app/ui-primitives-specimen.tsx";
const INTERACTIONS_PATH =
  "apps/storefront/src/app/ui-primitives-interactions.tsx";
const SPECIMEN_CSS_PATH =
  "apps/storefront/src/app/ui-primitives-specimen.module.css";
const PREVIEW_LAYOUT_PATH =
  "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx";
const PREVIEW_HELPER_PATH = "apps/storefront/src/design-foundations.ts";
const TAILWIND_VERSION = "4.3.3";

const ROOT_PRIMITIVES = Object.freeze([
  "Button",
  "Field",
  "Icon",
  "Link",
  "Price",
  "Status",
]);
const CLIENT_PRIMITIVES = Object.freeze(["Media", "Quantity"]);
const CLIENT_MODULES = new Set(["client", "media", "quantity"]);

const PACKAGE_EXPORTS = Object.freeze({
  ".": Object.freeze({
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  }),
  "./client": Object.freeze({
    types: "./dist/client.d.ts",
    import: "./dist/client.js",
  }),
  "./primitives.css": "./styles/primitives.css",
});

const DEPENDENCY_ALLOWLIST = Object.freeze({
  dependencies: Object.freeze({
    "@fan-support/contracts": "workspace:*",
    "class-variance-authority": "0.7.1",
  }),
  peerDependencies: Object.freeze({ react: "19.2.8" }),
  devDependencies: Object.freeze({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    react: "19.2.8",
    "react-dom": "19.2.8",
  }),
});

const PREVIEW_LOCALE_PROFILES = Object.freeze({
  en: "latin",
  es: "latin",
  ja: "japanese",
  pt: "latin",
  th: "thai",
  vi: "vietnamese",
  "zh-CN": "simplified-chinese",
  "en-XA": "latin",
});

const CRITICAL_TEXT_CLASSES = Object.freeze([
  "fs-button__label",
  "fs-field__description",
  "fs-field__error",
  "fs-field__hint",
  "fs-field__label",
  "fs-link",
  "fs-link__label",
  "fs-media__fallback",
  "fs-price",
  "fs-quantity__label",
  "fs-status",
]);
const PREVIEW_CRITICAL_TEXT_CLASSES = Object.freeze(["eyebrow"]);
const CRITICAL_TEXT_PROPERTIES = new Set([
  "-webkit-line-clamp",
  "block-size",
  "height",
  "line-clamp",
  "max-block-size",
  "max-height",
  "text-overflow",
  "white-space",
]);
const PHYSICAL_DIRECTION_PROPERTIES =
  /^(?:border-(?:bottom-left|bottom-right|left|right|top-left|top-right)(?:-radius|-color|-style|-width)?|inset-left|inset-right|left|margin-left|margin-right|padding-left|padding-right|right)$/u;
const MOTION_DECLARATION_PROPERTIES =
  /^(?:animation|animation-delay|animation-duration|transition|transition-delay|transition-duration)$/u;
const BASE_MOTION_TOKEN =
  /var\(--motion-(?:control|fast|hero|layout)\s*(?:,|\))/u;

const FOCUS_TARGETS = Object.freeze({
  Button: Object.freeze([".fs-button"]),
  Field: Object.freeze([".fs-field__input"]),
  Link: Object.freeze([".fs-link"]),
  Quantity: Object.freeze([".fs-quantity__button", ".fs-quantity__input"]),
});

async function readText(workspaceRoot, relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`missing UI primitive file ${relativePath}: ${detail}`);
    return undefined;
  }
}

async function readJson(workspaceRoot, relativePath, errors) {
  const source = await readText(workspaceRoot, relativePath, errors);
  if (source === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${relativePath} must be valid JSON: ${detail}`);
    return undefined;
  }
}

function sameKeys(actual, expected) {
  const actualKeys = Object.keys(actual ?? {}).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function validatePackageExports(manifest, errors) {
  const exports = manifest?.exports;
  if (
    exports === null ||
    typeof exports !== "object" ||
    Array.isArray(exports)
  ) {
    errors.push("@fan-support/ui must declare explicit package exports");
    return;
  }

  for (const [subpath, expected] of Object.entries(PACKAGE_EXPORTS)) {
    const actual = exports[subpath];
    if (typeof expected === "string") {
      if (actual !== expected) {
        errors.push(
          `@fan-support/ui must declare exact package export ${subpath} -> ${expected}`,
        );
      }
      continue;
    }
    if (
      actual === null ||
      typeof actual !== "object" ||
      Array.isArray(actual) ||
      !sameKeys(actual, expected) ||
      Object.entries(expected).some(([key, value]) => actual[key] !== value)
    ) {
      errors.push(
        `@fan-support/ui must declare exact package export ${subpath}`,
      );
    }
  }

  for (const subpath of Object.keys(exports)) {
    if (!(subpath in PACKAGE_EXPORTS)) {
      errors.push(`@fan-support/ui has unexpected public export ${subpath}`);
    }
  }
}

function validateDependencySection(manifest, section, expected, errors) {
  const actual = manifest?.[section];
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    errors.push(
      `@fan-support/ui ${section} must contain only ${Object.keys(expected).join(", ")}`,
    );
    return;
  }

  const names = Object.keys(actual);
  if (!sameKeys(actual, expected)) {
    errors.push(
      `@fan-support/ui ${section} may contain only ${Object.keys(expected).join(", ")}`,
    );
  }
  for (const [name, expectedVersion] of Object.entries(expected)) {
    if (actual[name] !== expectedVersion) {
      const expectedLabel =
        name === "@fan-support/contracts"
          ? "@fan-support/contracts must be workspace:*"
          : `@fan-support/ui ${section}.${name} must be ${expectedVersion}`;
      errors.push(expectedLabel);
    }
  }
  for (const name of names) {
    const version = actual[name];
    if (
      typeof version === "string" &&
      /^(?:file:|git(?:\+|:)|github:|https?:|link:|npm:|portal:)/u.test(version)
    ) {
      errors.push(
        `@fan-support/ui ${section}.${name}: npm aliases and non-registry protocols are forbidden`,
      );
    }
  }
}

function validateManifest(uiManifest, appManifests, errors) {
  validatePackageExports(uiManifest, errors);
  for (const [section, expected] of Object.entries(DEPENDENCY_ALLOWLIST)) {
    validateDependencySection(uiManifest, section, expected, errors);
  }

  const sideEffects = uiManifest?.sideEffects;
  if (
    !Array.isArray(sideEffects) ||
    sideEffects.length !== 1 ||
    sideEffects[0] !== "./styles/primitives.css"
  ) {
    errors.push(
      "@fan-support/ui sideEffects must explicitly list ./styles/primitives.css",
    );
  }

  for (const [appName, manifest] of Object.entries(appManifests)) {
    if (manifest?.dependencies?.["@fan-support/ui"] !== "workspace:*") {
      errors.push(`${appName} must depend on @fan-support/ui via workspace:*`);
    }
  }
}

function parseSource(source, relativePath) {
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function hasUseClientDirective(sourceFile) {
  const first = sourceFile.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

function valueExports(sourceFile, errors, label) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) {
        continue;
      }
      if (statement.exportClause === undefined) {
        errors.push(`${label} must use explicit named exports`);
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        errors.push(`${label} must not use namespace exports`);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) {
          names.add(element.name.text);
        }
      }
      continue;
    }

    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) {
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name !== undefined) {
        names.add(statement.name.text);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.add(declaration.name.text);
        }
      }
    }
  }
  return names;
}

function validateEntrypointExports(rootSource, clientSource, errors) {
  if (rootSource !== undefined) {
    const rootFile = parseSource(rootSource, UI_ROOT_PATH);
    if (hasUseClientDirective(rootFile)) {
      errors.push(
        "@fan-support/ui server-compatible root must not contain use client",
      );
    }
    const rootExports = valueExports(rootFile, errors, "@fan-support/ui root");
    for (const primitive of ROOT_PRIMITIVES) {
      if (!rootExports.has(primitive)) {
        errors.push(`@fan-support/ui root must value-export ${primitive}`);
      }
    }
    for (const primitive of CLIENT_PRIMITIVES) {
      if (rootExports.has(primitive)) {
        errors.push(`@fan-support/ui root must not value-export ${primitive}`);
      }
    }
    for (const name of rootExports) {
      if (/^[A-Z]/u.test(name) && !ROOT_PRIMITIVES.includes(name)) {
        errors.push(`@fan-support/ui root has unexpected public value ${name}`);
      }
    }
  }

  if (clientSource !== undefined) {
    const clientFile = parseSource(clientSource, UI_CLIENT_PATH);
    if (!hasUseClientDirective(clientFile)) {
      errors.push("@fan-support/ui client entry must begin with use client");
    }
    const clientExports = valueExports(
      clientFile,
      errors,
      "@fan-support/ui client entry",
    );
    for (const primitive of CLIENT_PRIMITIVES) {
      if (!clientExports.has(primitive)) {
        errors.push(
          `@fan-support/ui client entry must value-export ${primitive}`,
        );
      }
    }
    for (const primitive of ROOT_PRIMITIVES) {
      if (clientExports.has(primitive)) {
        errors.push(
          `@fan-support/ui client entry must not value-export ${primitive}`,
        );
      }
    }
    for (const name of clientExports) {
      if (/^[A-Z]/u.test(name) && !CLIENT_PRIMITIVES.includes(name)) {
        errors.push(
          `@fan-support/ui client entry has unexpected public value ${name}`,
        );
      }
    }
  }
}

function namedBindingsAreTypeOnly(importClause) {
  return (
    importClause !== undefined &&
    importClause.name === undefined &&
    importClause.namedBindings !== undefined &&
    ts.isNamedImports(importClause.namedBindings) &&
    importClause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function runtimeRelativeModuleSpecifiers(sourceFile) {
  const specifiers = new Set();
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (
        !node.importClause?.isTypeOnly &&
        !namedBindingsAreTypeOnly(node.importClause) &&
        node.moduleSpecifier.text.startsWith(".")
      ) {
        specifiers.add(node.moduleSpecifier.text);
      }
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const namedExportsAreTypeOnly =
        node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.every((element) => element.isTypeOnly);
      if (
        !node.isTypeOnly &&
        !namedExportsAreTypeOnly &&
        node.moduleSpecifier.text.startsWith(".")
      ) {
        specifiers.add(node.moduleSpecifier.text);
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text.startsWith(".") &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

async function resolveUiSource(workspaceRoot, importer, specifier) {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  );
  const extensionless = base.replace(/\.(?:c|m)?js$/u, "");
  for (const candidate of [
    `${extensionless}.ts`,
    `${extensionless}.tsx`,
    path.join(extensionless, "index.ts"),
    path.join(extensionless, "index.tsx"),
  ]) {
    try {
      await readFile(path.join(workspaceRoot, candidate));
      return candidate;
    } catch {
      // Try the next source extension.
    }
  }
  return undefined;
}

async function validateServerExportGraph(workspaceRoot, errors) {
  const queue = [UI_ROOT_PATH];
  const visited = new Set();
  while (queue.length > 0) {
    const relativePath = queue.shift();
    if (relativePath === undefined || visited.has(relativePath)) {
      continue;
    }
    visited.add(relativePath);
    let source;
    try {
      source = await readFile(path.join(workspaceRoot, relativePath), "utf8");
    } catch {
      continue;
    }
    const sourceFile = parseSource(source, relativePath);
    if (relativePath !== UI_ROOT_PATH && hasUseClientDirective(sourceFile)) {
      errors.push(
        `@fan-support/ui server export graph reaches client module ${relativePath}`,
      );
    }
    for (const specifier of runtimeRelativeModuleSpecifiers(sourceFile)) {
      const resolved = await resolveUiSource(
        workspaceRoot,
        relativePath,
        specifier,
      );
      if (resolved === undefined) {
        errors.push(
          `@fan-support/ui server export graph has unresolved module ${specifier} from ${relativePath}`,
        );
        continue;
      }
      const moduleName = path.basename(resolved).replace(/\.tsx?$/u, "");
      if (CLIENT_MODULES.has(moduleName)) {
        errors.push(
          `@fan-support/ui server export graph reaches client-only module ${moduleName}`,
        );
        continue;
      }
      queue.push(resolved);
    }
  }
}

function dependencyName(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

function externalModuleSpecifiers(sourceFile) {
  const specifiers = new Set();
  function add(value) {
    if (!value.startsWith(".")) {
      specifiers.add(value);
    }
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      add(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

async function listUiProductionSources(workspaceRoot) {
  const sourceRoot = path.join(workspaceRoot, "packages/ui/src");
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (
        entry.isFile() &&
        /\.tsx?$/u.test(entry.name) &&
        !/\.(?:spec|test)\.tsx?$/u.test(entry.name)
      ) {
        files.push(absolutePath);
      }
    }
  }
  await visit(sourceRoot);
  return files.sort();
}

async function validateProductionDependencies(workspaceRoot, errors) {
  const allowed = new Set(
    Object.values(DEPENDENCY_ALLOWLIST).flatMap((section) =>
      Object.keys(section),
    ),
  );
  for (const absolutePath of await listUiProductionSources(workspaceRoot)) {
    const relativePath = path.relative(workspaceRoot, absolutePath);
    const source = await readFile(absolutePath, "utf8");
    const sourceFile = parseSource(source, relativePath);
    for (const specifier of externalModuleSpecifiers(sourceFile)) {
      const dependency = dependencyName(specifier);
      if (!allowed.has(dependency)) {
        errors.push(
          `${relativePath}: production source dependency ${dependency} is outside the UI allowlist`,
        );
      }
    }
  }
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//gu, "");
}

function findMatchingBrace(source, openingIndex) {
  let depth = 0;
  let quote;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function cssStyleRules(css) {
  const rules = [];
  function parseRange(start, end) {
    let cursor = start;
    while (cursor < end) {
      const opening = css.indexOf("{", cursor);
      if (opening === -1 || opening >= end) {
        return;
      }
      const closing = findMatchingBrace(css, opening);
      if (closing === -1 || closing > end) {
        return;
      }
      let header = css.slice(cursor, opening).trim();
      const lastSemicolon = header.lastIndexOf(";");
      if (lastSemicolon !== -1) {
        header = header.slice(lastSemicolon + 1).trim();
      }
      const body = css.slice(opening + 1, closing);
      if (/^@(media|supports|container|layer)\b/u.test(header)) {
        parseRange(opening + 1, closing);
      } else if (!/^@/u.test(header) && header !== "") {
        rules.push({ declarations: declarations(body), selector: header });
      }
      cursor = closing + 1;
    }
  }
  parseRange(0, css.length);
  return rules;
}

function declarations(body) {
  const parsed = [];
  const pattern = /(?:^|;)\s*(--?[\w-]+|[a-z][\w-]*)\s*:\s*([^;{}]*)/giu;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    parsed.push({ property: match[1].toLowerCase(), value: match[2].trim() });
  }
  return parsed;
}

function tokenNames(tokenSource) {
  const names = new Set();
  const pattern = /["'](--[a-z][\w-]*)["']\s*:/giu;
  let match;
  while ((match = pattern.exec(tokenSource)) !== null) {
    names.add(match[1]);
  }
  return names;
}

function locallyDeclaredVariables(rules) {
  const names = new Set();
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      if (declaration.property.startsWith("--")) {
        names.add(declaration.property);
      }
    }
  }
  return names;
}

function cssVariableReferences(css) {
  const names = new Set();
  const pattern = /var\(\s*(--[a-z][\w-]*)/giu;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    names.add(match[1]);
  }
  return names;
}

function selectorSubject(branch) {
  return branch
    .trim()
    .split(/\s+|[>+~]/u)
    .filter(Boolean)
    .at(-1);
}

function selectorTargetsCriticalText(
  selector,
  classNames,
  includeTextElements = false,
) {
  return selectorBranches(selector).some((branch) => {
    const subject = selectorSubject(branch);
    if (subject === undefined || subject.includes("::")) {
      return false;
    }
    if (
      includeTextElements &&
      /^(?:a|button|h[1-6]|label|p)(?:$|[:.#[])/u.test(subject)
    ) {
      return true;
    }
    return classNames.some((className) =>
      new RegExp(`\\.${className}(?![\\w-])`, "u").test(subject),
    );
  });
}

function isForbiddenCriticalTextDeclaration(property, value) {
  if (property === "text-overflow") {
    return value.includes("ellipsis");
  }
  if (property === "white-space") {
    return value.includes("nowrap");
  }
  return true;
}

function validateCriticalText(
  rules,
  relativePath,
  classNames,
  includeTextElements,
  errors,
) {
  for (const rule of rules) {
    const targetsCriticalText = selectorTargetsCriticalText(
      rule.selector,
      classNames,
      includeTextElements,
    );
    for (const declaration of rule.declarations) {
      if (!CRITICAL_TEXT_PROPERTIES.has(declaration.property)) {
        continue;
      }
      const value = declaration.value.toLowerCase();
      const forbidden = isForbiddenCriticalTextDeclaration(
        declaration.property,
        value,
      );
      const truncatesText =
        declaration.property === "text-overflow" ||
        declaration.property === "white-space" ||
        declaration.property.endsWith("line-clamp");
      if (forbidden && (targetsCriticalText || truncatesText)) {
        errors.push(
          `${relativePath}: critical translated text must not use ${declaration.property} in ${rule.selector}`,
        );
      }
    }
  }
}

function validateRtlCss(rules, relativePath, errors) {
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      if (
        PHYSICAL_DIRECTION_PROPERTIES.test(declaration.property) ||
        ((declaration.property === "float" ||
          declaration.property === "clear" ||
          declaration.property === "text-align") &&
          /^(?:left|right)$/u.test(declaration.value.toLowerCase()))
      ) {
        errors.push(
          `${relativePath}: physical-direction property is forbidden (${declaration.property}: ${declaration.value})`,
        );
      }
    }
  }
}

function validateCssVariables(
  css,
  rules,
  tokenSource,
  additionalKnown,
  relativePath,
  errors,
) {
  const known = tokenNames(tokenSource);
  for (const name of additionalKnown) {
    known.add(name);
  }
  const local = locallyDeclaredVariables(rules);
  for (const name of cssVariableReferences(css)) {
    if (!known.has(name) && !local.has(name)) {
      errors.push(`${relativePath}: unknown CSS variable ${name}`);
    }
  }
}

function selectorBranches(selector) {
  return selector.split(",").map((branch) => branch.trim());
}

function selectorTargets(branch, target) {
  const index = branch.indexOf(target);
  if (index === -1) {
    return false;
  }
  const next = branch[index + target.length];
  return next === undefined || /[:\s.#[>+~]/u.test(next);
}

function hasVisibleIndicator(declarations) {
  return declarations.some(({ property, value }) => {
    const normalized = value.toLowerCase().replace(/\s+/gu, " ").trim();
    if (property === "outline") {
      return normalized !== "none" && normalized !== "0";
    }
    if (property === "box-shadow") {
      return normalized !== "none" && normalized !== "0";
    }
    return false;
  });
}

function validateFocusVisible(rules, errors) {
  for (const [primitive, targets] of Object.entries(FOCUS_TARGETS)) {
    for (const target of targets) {
      const focusRules = rules.filter((rule) =>
        selectorBranches(rule.selector).some(
          (branch) =>
            selectorTargets(branch, target) &&
            branch.includes(":focus-visible"),
        ),
      );
      if (focusRules.length === 0) {
        errors.push(
          `${primitive} must have a :focus-visible rule for ${target}`,
        );
      } else if (
        !focusRules.some((rule) => hasVisibleIndicator(rule.declarations))
      ) {
        errors.push(
          `${primitive} focus-visible rule must provide a visible outline or box-shadow`,
        );
      }
    }
  }
}

function boundaryColor(declarations) {
  for (const property of ["border-color", "border"]) {
    const declaration = declarations.find(
      (candidate) => candidate.property === property,
    );
    if (declaration === undefined) {
      continue;
    }
    const colorTokens = [
      ...declaration.value.matchAll(/var\(\s*(--color-[\w-]+)/giu),
    ];
    return colorTokens.at(-1)?.[1] ?? declaration.value.toLowerCase();
  }
  return undefined;
}

function validateFieldHoverFeedback(rules, errors) {
  const target = ".fs-field__input";
  const baseRule = rules.find((rule) =>
    selectorBranches(rule.selector).some((branch) => branch === target),
  );
  const hoverRule = rules.find((rule) =>
    selectorBranches(rule.selector).some(
      (branch) => selectorTargets(branch, target) && branch.includes(":hover"),
    ),
  );
  const baseBoundary = boundaryColor(baseRule?.declarations ?? []);
  const hoverBoundary = boundaryColor(hoverRule?.declarations ?? []);

  if (
    baseBoundary === undefined ||
    hoverBoundary === undefined ||
    baseBoundary === hoverBoundary
  ) {
    errors.push("Field hover boundary must differ from its default boundary");
  }
}

function atRuleBody(css, headerPattern) {
  const match = headerPattern.exec(css);
  if (match === null) {
    return undefined;
  }
  const opening = css.indexOf("{", match.index);
  if (opening === -1) {
    return undefined;
  }
  const closing = findMatchingBrace(css, opening);
  return closing === -1 ? undefined : css.slice(opening + 1, closing);
}

function validateMotionTokens(rules, relativePath, errors) {
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      if (
        MOTION_DECLARATION_PROPERTIES.test(declaration.property) &&
        BASE_MOTION_TOKEN.test(declaration.value)
      ) {
        errors.push(
          `${relativePath}: motion declarations must use effective motion tokens`,
        );
      }
    }
  }
}

function validateReducedMotion(css, rules, errors) {
  const reducedBody = atRuleBody(
    css,
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/giu,
  );
  if (reducedBody === undefined) {
    errors.push(
      `${UI_CSS_PATH} must include a prefers-reduced-motion: reduce override`,
    );
  } else {
    const reducedRules = cssStyleRules(reducedBody);
    const activeRule = reducedRules.find((rule) =>
      selectorBranches(rule.selector).some(
        (branch) =>
          selectorTargets(branch, ".fs-button") && branch.includes(":active"),
      ),
    );
    const spinnerRule = reducedRules.find((rule) =>
      selectorBranches(rule.selector).some((branch) =>
        selectorTargets(branch, ".fs-button__spinner"),
      ),
    );
    if (
      !activeRule?.declarations.some(
        ({ property, value }) =>
          property === "transform" && value.toLowerCase() === "none",
      )
    ) {
      errors.push("reduced motion must remove Button active movement");
    }
    if (
      !spinnerRule?.declarations.some(
        ({ property, value }) =>
          property === "animation" && value.toLowerCase() === "none",
      )
    ) {
      errors.push("reduced motion must stop the Button loading animation");
    }
  }

  validateMotionTokens(rules, UI_CSS_PATH, errors);
}

function validateAppStyleConsumption(appStyles, errors) {
  for (const [appName, css] of Object.entries(appStyles)) {
    if (!/@import\s+["']@fan-support\/ui\/primitives\.css["']\s*;/u.test(css)) {
      errors.push(
        `${appName} must import @fan-support/ui/primitives.css through the package export`,
      );
    }
    if (!/@import\s+["']tailwindcss["']\s+source\(none\)\s*;/u.test(css)) {
      errors.push(
        `${appName} globals.css must explicitly import tailwindcss with source(none)`,
      );
    }
  }
}

function hasTailwindPostcssPlugin(source) {
  const sourceFile = parseSource(source, "postcss.config.mjs");
  const variables = new Map();
  let exported;

  function propertyName(name) {
    return ts.isIdentifier(name) || ts.isStringLiteral(name)
      ? name.text
      : undefined;
  }
  function unwrap(expression) {
    let current = expression;
    while (
      ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }
  function property(object, name) {
    return object.properties.find(
      (candidate) =>
        ts.isPropertyAssignment(candidate) &&
        propertyName(candidate.name) === name,
    );
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer !== undefined
        ) {
          variables.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      exported = statement.expression;
    }
  }

  let config = exported === undefined ? undefined : unwrap(exported);
  if (config !== undefined && ts.isIdentifier(config)) {
    const initializer = variables.get(config.text);
    config = initializer === undefined ? undefined : unwrap(initializer);
  }
  if (config === undefined || !ts.isObjectLiteralExpression(config)) {
    return false;
  }
  const pluginsProperty = property(config, "plugins");
  if (pluginsProperty === undefined) {
    return false;
  }
  const plugins = unwrap(pluginsProperty.initializer);
  if (!ts.isObjectLiteralExpression(plugins)) {
    return false;
  }
  const tailwindProperty = property(plugins, "@tailwindcss/postcss");
  if (tailwindProperty === undefined) {
    return false;
  }
  const options = unwrap(tailwindProperty.initializer);
  return (
    ts.isObjectLiteralExpression(options) && options.properties.length === 0
  );
}

function hasStructuralApply(css) {
  const structuralUtilities = new Set([
    "flex",
    "grid",
    "inline-flex",
    "inline-grid",
    "items-center",
    "items-stretch",
    "justify-between",
    "justify-center",
    "place-items-center",
  ]);
  for (const match of stripCssComments(css).matchAll(/@apply\s+([^;]+);/gu)) {
    const utilities = match[1].trim().split(/\s+/u);
    if (
      utilities.length >= 2 &&
      utilities.some((utility) => structuralUtilities.has(utility))
    ) {
      return true;
    }
  }
  return false;
}

function validateCssTooling(
  rootManifest,
  postcssConfigs,
  primitivesCss,
  errors,
) {
  for (const dependency of ["tailwindcss", "@tailwindcss/postcss"]) {
    if (rootManifest?.devDependencies?.[dependency] !== TAILWIND_VERSION) {
      errors.push(`root must pin ${dependency} to ${TAILWIND_VERSION}`);
    }
  }
  for (const [appName, source] of Object.entries(postcssConfigs)) {
    if (!hasTailwindPostcssPlugin(source)) {
      errors.push(`${appName} PostCSS config must enable @tailwindcss/postcss`);
    }
  }
  if (!hasStructuralApply(primitivesCss)) {
    errors.push("primitives.css must contain a structural @apply rule");
  }
}

function validateStyles(css, tokenSource, appStyles, errors) {
  validateAppStyleConsumption(appStyles, errors);
  const cleanCss = stripCssComments(css);
  const rules = cssStyleRules(cleanCss);
  validateCriticalText(
    rules,
    UI_CSS_PATH,
    CRITICAL_TEXT_CLASSES,
    false,
    errors,
  );
  validateRtlCss(rules, UI_CSS_PATH, errors);
  validateCssVariables(
    cleanCss,
    rules,
    tokenSource,
    new Set(),
    UI_CSS_PATH,
    errors,
  );
  validateFocusVisible(rules, errors);
  validateFieldHoverFeedback(rules, errors);
  validateReducedMotion(cleanCss, rules, errors);
  return locallyDeclaredVariables(rules);
}

function validatePreviewStyles(css, tokenSource, uiLocalVariables, errors) {
  const cleanCss = stripCssComments(css);
  const rules = cssStyleRules(cleanCss);
  validateCriticalText(
    rules,
    SPECIMEN_CSS_PATH,
    PREVIEW_CRITICAL_TEXT_CLASSES,
    true,
    errors,
  );
  validateRtlCss(rules, SPECIMEN_CSS_PATH, errors);
  validateCssVariables(
    cleanCss,
    rules,
    tokenSource,
    uiLocalVariables,
    SPECIMEN_CSS_PATH,
    errors,
  );
  validateMotionTokens(rules, SPECIMEN_CSS_PATH, errors);
}

function importedNames(sourceFile, moduleName) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      if (!element.isTypeOnly) {
        names.add(element.propertyName?.text ?? element.name.text);
      }
    }
  }
  return names;
}

function importsModule(sourceFile, moduleName) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName,
  );
}

function requireImports(sourceFile, moduleName, names, label, errors) {
  const actual = importedNames(sourceFile, moduleName);
  for (const name of names) {
    if (!actual.has(name)) {
      errors.push(`${label} must import ${name} from ${moduleName}`);
    }
  }
  return actual;
}

function requireRendered(source, names, label, errors) {
  for (const name of names) {
    if (!new RegExp(`<${name}\\b`, "u").test(source)) {
      errors.push(`${label} must render ${name}`);
    }
  }
}

function validateSpecimen(specimenSource, interactionsSource, errors) {
  const specimenFile = parseSource(specimenSource, SPECIMEN_PATH);
  if (hasUseClientDirective(specimenFile)) {
    errors.push("preview specimen must remain server-compatible");
  }
  if (!importsModule(specimenFile, "./ui-primitives-specimen.module.css")) {
    errors.push(
      "preview specimen must consume ./ui-primitives-specimen.module.css",
    );
  }
  requireImports(
    specimenFile,
    "@fan-support/ui",
    ["Icon", "Link", "Price", "Status"],
    "specimen",
    errors,
  );
  if (importedNames(specimenFile, "@fan-support/ui/client").size > 0) {
    errors.push("preview specimen must not import the UI client entry");
  }
  requireImports(
    specimenFile,
    "./ui-primitives-interactions",
    ["UiPrimitiveInteractions"],
    "specimen",
    errors,
  );
  requireRendered(
    specimenSource,
    ["Icon", "Link", "Price", "Status", "UiPrimitiveInteractions"],
    "specimen",
    errors,
  );

  const interactionsFile = parseSource(interactionsSource, INTERACTIONS_PATH);
  if (!hasUseClientDirective(interactionsFile)) {
    errors.push("preview interactions must begin with use client");
  }
  requireImports(
    interactionsFile,
    "@fan-support/ui",
    ["Button", "Field"],
    "specimen",
    errors,
  );
  requireImports(
    interactionsFile,
    "@fan-support/ui/client",
    CLIENT_PRIMITIVES,
    "specimen",
    errors,
  );
  requireRendered(
    interactionsSource,
    ["Button", "Field", ...CLIENT_PRIMITIVES],
    "specimen",
    errors,
  );
  if (!/<Button\b[^>]*\bdisabled(?:\s|=|>)/u.test(interactionsSource)) {
    errors.push("specimen must include a disabled state");
  }
  if (!/<Button\b[^>]*\bloading(?:\s|=|>)/u.test(interactionsSource)) {
    errors.push("specimen must include a loading state");
  }
  if (!/\bdir\s*=\s*["']rtl["']/u.test(interactionsSource)) {
    errors.push('specimen must include an explicit dir="rtl" smoke');
  }
}

async function listFiles(root) {
  const files = [];
  async function visit(directory, relativeDirectory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  await visit(path.join(root, "apps/storefront/src/app"), "");
  return files.sort();
}

function expectedPreviewPath(locale, profile) {
  return path.posix.join(
    "%5Finternal/design-foundations",
    `(${profile})`,
    locale,
    "primitives/page.tsx",
  );
}

async function validatePreviewPages(workspaceRoot, errors) {
  const appFiles = await listFiles(workspaceRoot);
  const expected = new Map(
    Object.entries(PREVIEW_LOCALE_PROFILES).map(([locale, profile]) => [
      expectedPreviewPath(locale, profile),
      locale,
    ]),
  );
  const actualPreviewPages = appFiles.filter((relativePath) =>
    relativePath.endsWith("/primitives/page.tsx"),
  );

  for (const [relativePath, locale] of expected) {
    if (!actualPreviewPages.includes(relativePath)) {
      errors.push(`missing preview fixture ${locale}: ${relativePath}`);
      continue;
    }
    const source = await readText(
      workspaceRoot,
      path.posix.join("apps/storefront/src/app", relativePath),
      errors,
    );
    if (
      source !== undefined &&
      !new RegExp(
        `<UiPrimitivesSpecimen\\b[^>]*\\blocale\\s*=\\s*["']${locale.replace(
          /[.*+?^${}()|[\]\\]/gu,
          "\\$&",
        )}["']`,
        "u",
      ).test(source)
    ) {
      errors.push(
        `preview fixture ${locale} must render UiPrimitivesSpecimen with locale="${locale}"`,
      );
    }
  }

  for (const relativePath of actualPreviewPages) {
    if (!expected.has(relativePath)) {
      errors.push(`unexpected UI primitive preview page ${relativePath}`);
    }
  }
  if (
    appFiles.some((relativePath) =>
      relativePath.startsWith("%5Finternal/ui-primitives/"),
    )
  ) {
    errors.push(
      "UI primitive previews must inherit the design-foundations gate and font route groups",
    );
  }
}

function previewEnvironmentSet(helperSource, errors) {
  const sourceFile = parseSource(helperSource, PREVIEW_HELPER_PATH);
  const declaration = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "isDesignFoundationPreviewEnabled",
  );
  if (
    declaration === undefined ||
    !ts.isFunctionDeclaration(declaration) ||
    declaration.body === undefined ||
    declaration.parameters.length !== 1 ||
    !ts.isIdentifier(declaration.parameters[0].name) ||
    declaration.body.statements.length !== 1 ||
    !ts.isReturnStatement(declaration.body.statements[0]) ||
    declaration.body.statements[0].expression === undefined
  ) {
    errors.push(
      "preview helper must allow exactly development, test, and preview",
    );
    return undefined;
  }
  const parameterName = declaration.parameters[0].name.text;
  const values = new Set();

  function unwrap(expression) {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    }
    return current;
  }

  function collect(expression) {
    const current = unwrap(expression);
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      return collect(current.left) && collect(current.right);
    }
    if (
      !ts.isBinaryExpression(current) ||
      current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      return false;
    }
    const left = unwrap(current.left);
    const right = unwrap(current.right);
    if (
      ts.isIdentifier(left) &&
      left.text === parameterName &&
      ts.isStringLiteral(right)
    ) {
      values.add(right.text);
      return true;
    }
    if (
      ts.isIdentifier(right) &&
      right.text === parameterName &&
      ts.isStringLiteral(left)
    ) {
      values.add(left.text);
      return true;
    }
    return false;
  }

  return collect(declaration.body.statements[0].expression)
    ? values
    : undefined;
}

function validatePreviewGate(layoutSource, helperSource, errors) {
  const environments = previewEnvironmentSet(helperSource, errors);
  if (
    environments === undefined ||
    environments.size !== 3 ||
    !["development", "test", "preview"].every((value) =>
      environments.has(value),
    )
  ) {
    errors.push(
      "preview helper must allow exactly development, test, and preview",
    );
  }

  const compact = layoutSource.replace(/\s+/gu, " ");
  if (
    !/export const dynamic\s*=\s*["']force-dynamic["']/u.test(compact) ||
    !/export const runtime\s*=\s*["']nodejs["']/u.test(compact)
  ) {
    errors.push(
      "inherited preview layout must be dynamic and use nodejs runtime",
    );
  }
  if (
    !/robots\s*:\s*\{[^{}]*follow\s*:\s*false[^{}]*index\s*:\s*false[^{}]*\}/u.test(
      compact,
    ) &&
    !/robots\s*:\s*\{[^{}]*index\s*:\s*false[^{}]*follow\s*:\s*false[^{}]*\}/u.test(
      compact,
    )
  ) {
    errors.push("inherited preview layout must be noindex,nofollow");
  }

  const functionStart = compact.indexOf("export default function");
  const functionBody = functionStart === -1 ? "" : compact.slice(functionStart);
  const helperCall = functionBody.indexOf(
    'isDesignFoundationPreviewEnabled(process.env["FAN_SUPPORT_DEPLOYMENT_ENV"])',
  );
  const helperCallSingleQuotes = functionBody.indexOf(
    "isDesignFoundationPreviewEnabled(process.env['FAN_SUPPORT_DEPLOYMENT_ENV'])",
  );
  const gateIndex = Math.max(helperCall, helperCallSingleQuotes);
  const notFoundIndex = functionBody.indexOf("notFound()");
  const configIndex = functionBody.indexOf("loadStorefrontRuntimeConfig()");
  const renderIndex = functionBody.indexOf("return children");
  if (
    gateIndex === -1 ||
    notFoundIndex === -1 ||
    configIndex === -1 ||
    renderIndex === -1 ||
    !/if\s*\(\s*!\s*isDesignFoundationPreviewEnabled/u.test(functionBody) ||
    !(
      gateIndex < notFoundIndex &&
      notFoundIndex < configIndex &&
      configIndex < renderIndex
    )
  ) {
    errors.push("preview gate must run before runtime config and rendering");
  }
}

export async function validateUiPrimitives(
  workspaceRoot = defaultWorkspaceRoot,
) {
  const errors = [];
  const [
    rootManifest,
    uiManifest,
    storefrontManifest,
    adminManifest,
    rootSource,
    clientSource,
    css,
    tokenSource,
    storefrontCss,
    adminCss,
    specimenSource,
    interactionsSource,
    specimenCss,
    storefrontPostcss,
    adminPostcss,
    previewLayoutSource,
    previewHelperSource,
  ] = await Promise.all([
    readJson(workspaceRoot, ROOT_MANIFEST_PATH, errors),
    readJson(workspaceRoot, UI_MANIFEST_PATH, errors),
    readJson(workspaceRoot, STOREFRONT_MANIFEST_PATH, errors),
    readJson(workspaceRoot, ADMIN_MANIFEST_PATH, errors),
    readText(workspaceRoot, UI_ROOT_PATH, errors),
    readText(workspaceRoot, UI_CLIENT_PATH, errors),
    readText(workspaceRoot, UI_CSS_PATH, errors),
    readText(workspaceRoot, TOKEN_SOURCE_PATH, errors),
    readText(workspaceRoot, STOREFRONT_GLOBAL_CSS_PATH, errors),
    readText(workspaceRoot, ADMIN_GLOBAL_CSS_PATH, errors),
    readText(workspaceRoot, SPECIMEN_PATH, errors),
    readText(workspaceRoot, INTERACTIONS_PATH, errors),
    readText(workspaceRoot, SPECIMEN_CSS_PATH, errors),
    readText(workspaceRoot, STOREFRONT_POSTCSS_PATH, errors),
    readText(workspaceRoot, ADMIN_POSTCSS_PATH, errors),
    readText(workspaceRoot, PREVIEW_LAYOUT_PATH, errors),
    readText(workspaceRoot, PREVIEW_HELPER_PATH, errors),
  ]);

  validateManifest(
    uiManifest,
    { Admin: adminManifest, Storefront: storefrontManifest },
    errors,
  );
  if (
    css !== undefined &&
    storefrontPostcss !== undefined &&
    adminPostcss !== undefined
  ) {
    validateCssTooling(
      rootManifest,
      { Admin: adminPostcss, Storefront: storefrontPostcss },
      css,
      errors,
    );
  }
  validateEntrypointExports(rootSource, clientSource, errors);
  await validateServerExportGraph(workspaceRoot, errors);
  await validateProductionDependencies(workspaceRoot, errors);
  let uiLocalVariables = new Set();
  if (css !== undefined && tokenSource !== undefined) {
    uiLocalVariables = validateStyles(
      css,
      tokenSource,
      { Admin: adminCss ?? "", Storefront: storefrontCss ?? "" },
      errors,
    );
  }
  if (specimenCss !== undefined && tokenSource !== undefined) {
    validatePreviewStyles(specimenCss, tokenSource, uiLocalVariables, errors);
  }
  if (specimenSource !== undefined && interactionsSource !== undefined) {
    validateSpecimen(specimenSource, interactionsSource, errors);
  }
  await validatePreviewPages(workspaceRoot, errors);
  if (previewLayoutSource !== undefined && previewHelperSource !== undefined) {
    validatePreviewGate(previewLayoutSource, previewHelperSource, errors);
  }

  return [...new Set(errors)].sort();
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  const errors = await validateUiPrimitives();
  if (errors.length > 0) {
    console.error("UI primitive validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      "UI primitive validation passed: RSC entrypoints, dependency/CSS boundaries, accessibility styles, and eight gated preview fixtures are synchronized.",
    );
  }
}
