import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");

const UI_MANIFEST_PATH = "packages/ui/package.json";
const INTERACTIONS_ENTRY_PATH = "packages/ui/src/interactions.ts";
const ROOT_ENTRY_PATH = "packages/ui/src/index.ts";
const CLIENT_ENTRY_PATH = "packages/ui/src/client.ts";
const OVERLAY_PATH = "packages/ui/src/overlay.tsx";
const MENU_PATH = "packages/ui/src/menu.tsx";
const TOAST_PATH = "packages/ui/src/toast.tsx";
const SELECTION_CONTROLS_PATH = "packages/ui/src/selection-controls.tsx";
const INTERACTION_CSS_PATH = "packages/ui/styles/interactions.css";
const CONTRACT_LOCALE_PATH = "packages/contracts/src/locale.ts";
const STOREFRONT_GLOBAL_CSS_PATH = "apps/storefront/src/app/globals.css";
const INTERACTION_LAB_PATH = "apps/storefront/src/app/ui-interaction-lab.tsx";
const PRESENTATION_LOCALE_PATH = "apps/storefront/src/presentation-locale.ts";
const INTERNAL_PRESENTATION_LOCALE_PATH =
  "apps/storefront/src/internal-presentation-locale.ts";
const STOREFRONT_APP_PATH = "apps/storefront/src/app";

const PUBLIC_LOCALES = Object.freeze([
  "en",
  "zh-CN",
  "th",
  "vi",
  "ja",
  "es",
  "pt",
]);

const INTERACTION_VALUE_EXPORTS = Object.freeze([
  "Dialog",
  "Drawer",
  "LanguageControl",
  "LiveRegion",
  "Menu",
  "RegionControl",
  "ToastProvider",
  "useToast",
]);

const INTERACTION_PACKAGE_EXPORT = Object.freeze({
  types: "./dist/interactions.d.ts",
  import: "./dist/interactions.js",
});

const INTERACTION_ROUTES = Object.freeze({
  "apps/storefront/src/app/%5Finternal/design-foundations/(japanese)/ja/interactions/page.tsx":
    "ja",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en/interactions/page.tsx":
    "en",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en-XA/interactions/page.tsx":
    "en-XA",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/es/interactions/page.tsx":
    "es",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/pt/interactions/page.tsx":
    "pt",
  "apps/storefront/src/app/%5Finternal/design-foundations/(simplified-chinese)/zh-CN/interactions/page.tsx":
    "zh-CN",
  "apps/storefront/src/app/%5Finternal/design-foundations/(thai)/th/interactions/page.tsx":
    "th",
  "apps/storefront/src/app/%5Finternal/design-foundations/(vietnamese)/vi/interactions/page.tsx":
    "vi",
});

const REVIEWED_BASE_UI_SUBMODULES = new Set([
  "@base-ui/react/dialog",
  "@base-ui/react/menu",
  "@base-ui/react/toast",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "output",
]);

const FOCUS_TARGETS = Object.freeze([
  ".fs-overlay-trigger",
  ".fs-menu__trigger",
  ".fs-menu__item",
  ".fs-overlay__close",
  ".fs-toast",
  ".fs-toast__close",
]);

const REDUCED_MOTION_TARGETS = Object.freeze([
  ".fs-overlay-trigger",
  ".fs-menu__trigger",
  ".fs-menu__popup",
  ".fs-overlay__backdrop",
  ".fs-dialog__popup",
  ".fs-drawer__popup",
  ".fs-overlay__close",
  ".fs-toast",
  ".fs-toast__close",
]);

const CRITICAL_COPY_CLASSES = Object.freeze([
  "fs-overlay__title",
  "fs-overlay__description",
  "fs-menu__label",
  "fs-menu__value",
  "fs-menu__detail",
  "fs-menu__item-label",
  "fs-menu__item-detail",
  "fs-toast__title",
  "fs-toast__description",
]);

const PHYSICAL_DIRECTION_PROPERTY =
  /(?:^|[;{]\s*)((?:border-(?:left|right)(?:-(?:color|style|width))?|border-(?:bottom|top)-(?:left|right)-radius)|bottom|height|inset-left|inset-right|left|margin-left|margin-right|max-height|max-width|min-height|min-width|padding-left|padding-right|right|top|width)\s*:/gmu;
const FLAG_GLYPH = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const FUNCTIONAL_GLYPH_OR_EMOJI =
  /[\u00d7\u25be\u2713\u2714\u2715\u2716\u2717]|[\u{1F000}-\u{1FAFF}]|[\u2600-\u27BF]/u;

async function readText(workspaceRoot, relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`missing P2-03 interaction file ${relativePath}: ${detail}`);
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

async function listFiles(absoluteRoot) {
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
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        files.push(target);
      }
    }
  }
  await visit(absoluteRoot);
  return files;
}

function normalizedRelativePath(workspaceRoot, absolutePath) {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
}

function sameObject(actual, expected) {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  const actualEntries = Object.entries(actual).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([key, value], index) =>
        key === expectedEntries[index]?.[0] &&
        value === expectedEntries[index]?.[1],
    )
  );
}

function validateUiManifest(manifest, errors) {
  if (
    !sameObject(
      manifest?.exports?.["./interactions"],
      INTERACTION_PACKAGE_EXPORT,
    )
  ) {
    errors.push(
      "@fan-support/ui must declare the exact package export ./interactions",
    );
  }
  if (
    manifest?.exports?.["./interactions.css"] !== "./styles/interactions.css"
  ) {
    errors.push(
      "@fan-support/ui must declare the exact package export ./interactions.css",
    );
  }
  if (manifest?.dependencies?.["@base-ui/react"] !== "1.7.0") {
    errors.push("@fan-support/ui @base-ui/react must be pinned to 1.7.0");
  }

  const sideEffects = manifest?.sideEffects;
  if (
    !Array.isArray(sideEffects) ||
    sideEffects.filter((entry) => entry === "./styles/interactions.css")
      .length !== 1
  ) {
    errors.push(
      "@fan-support/ui sideEffects must list ./styles/interactions.css exactly once",
    );
  }
}

function parseSource(source, relativePath) {
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
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

function exportedValueNames(sourceFile, errors, label) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) {
        continue;
      }
      if (
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        errors.push(`${label} must use explicit named exports`);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) {
          names.add(element.name.text);
        }
      }
      continue;
    }

    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) {
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.add(declaration.name.text);
        }
      }
    }
  }
  return names;
}

function validateEntrypoints(interactions, root, client, errors) {
  if (interactions === undefined) {
    return;
  }
  const interactionFile = parseSource(interactions, INTERACTIONS_ENTRY_PATH);
  if (!hasUseClientDirective(interactionFile)) {
    errors.push("interactions entrypoint must begin with use client");
  }
  const exported = exportedValueNames(
    interactionFile,
    errors,
    "interactions entrypoint",
  );
  const actual = [...exported].sort();
  const expected = [...INTERACTION_VALUE_EXPORTS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    errors.push(
      `interactions entrypoint must expose exact interaction value exports: ${expected.join(", ")}`,
    );
  }

  for (const [label, source, relativePath] of [
    ["root", root, ROOT_ENTRY_PATH],
    ["legacy client", client, CLIENT_ENTRY_PATH],
  ]) {
    if (source === undefined) {
      continue;
    }
    const entryErrors = [];
    const names = exportedValueNames(
      parseSource(source, relativePath),
      entryErrors,
      `${label} entrypoint`,
    );
    for (const name of INTERACTION_VALUE_EXPORTS) {
      if (names.has(name)) {
        errors.push(
          `${label} entrypoint must not export interaction value ${name}`,
        );
      }
    }
    if (/from\s+["'][^"']*interactions(?:\.js)?["']/u.test(source)) {
      errors.push(
        `${label} entrypoint must not re-export the interactions module`,
      );
    }
  }
}

async function validateBaseUiBoundary(workspaceRoot, errors) {
  const allFiles = (
    await Promise.all(
      ["apps", "packages"].map((root) =>
        listFiles(path.join(workspaceRoot, root)),
      ),
    )
  ).flat();
  const seenSubmodules = new Set();

  for (const absolutePath of allFiles) {
    const relativePath = normalizedRelativePath(workspaceRoot, absolutePath);
    if (path.basename(absolutePath) === "package.json") {
      let manifest;
      try {
        manifest = JSON.parse(await readFile(absolutePath, "utf8"));
      } catch {
        continue;
      }
      if (relativePath === UI_MANIFEST_PATH) {
        continue;
      }
      for (const section of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ]) {
        if (manifest?.[section]?.["@base-ui/react"] !== undefined) {
          errors.push(
            `Base UI dependency is allowed only in packages/ui (${relativePath})`,
          );
        }
      }
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(absolutePath))) {
      continue;
    }

    const source = await readFile(absolutePath, "utf8");
    for (const match of source.matchAll(
      /["'](@base-ui\/react(?:\/[^"']*)?)["']/gu,
    )) {
      const specifier = match[1];
      if (!relativePath.startsWith("packages/ui/src/")) {
        errors.push(
          `Base UI imports are allowed only in packages/ui (${relativePath})`,
        );
      }
      if (!REVIEWED_BASE_UI_SUBMODULES.has(specifier)) {
        errors.push(`unreviewed Base UI submodule ${specifier}`);
      } else {
        seenSubmodules.add(specifier);
      }
    }
  }

  for (const specifier of REVIEWED_BASE_UI_SUBMODULES) {
    if (!seenSubmodules.has(specifier)) {
      errors.push(`missing reviewed Base UI submodule ${specifier}`);
    }
  }
}

function validateCanonicalLocaleSource(
  contractLocale,
  selectionControls,
  errors,
) {
  if (contractLocale !== undefined) {
    const localeMatch = contractLocale.match(
      /SUPPORTED_LOCALES\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*as\s+const\s*\)/u,
    );
    const locales = localeMatch?.[1]
      ?.match(/["']([^"']+)["']/gu)
      ?.map((literal) => literal.slice(1, -1));
    if (
      locales === undefined ||
      locales.length !== PUBLIC_LOCALES.length ||
      locales.some((locale, index) => locale !== PUBLIC_LOCALES[index])
    ) {
      errors.push(
        `canonical SUPPORTED_LOCALES must remain ${PUBLIC_LOCALES.join(", ")}`,
      );
    }
    if (
      !/supportedLocaleSchema\s*=\s*z\.enum\(SUPPORTED_LOCALES\)/u.test(
        contractLocale,
      )
    ) {
      errors.push("supportedLocaleSchema must derive from SUPPORTED_LOCALES");
    }
  }

  if (selectionControls === undefined) {
    return;
  }
  if (
    !/import\s*\{[\s\S]*\bLOCALE_NATIVE_NAMES\b[\s\S]*\bSUPPORTED_LOCALES\b[\s\S]*\}\s*from\s*["']@fan-support\/contracts["']/u.test(
      selectionControls,
    )
  ) {
    errors.push(
      "LanguageControl must import SUPPORTED_LOCALES and LOCALE_NATIVE_NAMES from @fan-support/contracts",
    );
  }
  if (!/SUPPORTED_LOCALES\.map\s*\(/u.test(selectionControls)) {
    errors.push("LanguageControl options must derive from SUPPORTED_LOCALES");
  }
  if (!/LOCALE_NATIVE_NAMES\s*\[\s*locale\s*\]/u.test(selectionControls)) {
    errors.push("LanguageControl labels must use LOCALE_NATIVE_NAMES");
  }
  if (selectionControls.includes("en-XA")) {
    errors.push("en-XA must not enter the public language control");
  }
  if (
    FLAG_GLYPH.test(selectionControls) ||
    /\bflags?\b/iu.test(selectionControls)
  ) {
    errors.push("language and region controls must not use flags");
  }
}

function unwrapExpression(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function expressionPath(expression) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    return [current.text];
  }
  if (ts.isPropertyAccessExpression(current)) {
    const parent = expressionPath(current.expression);
    return parent === undefined ? undefined : [...parent, current.name.text];
  }
  return undefined;
}

function pathMatches(expression, expected) {
  const actual = expressionPath(expression);
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every((part, index) => part === expected[index])
  );
}

function callExpressionFromStatement(statement) {
  if (!ts.isExpressionStatement(statement)) {
    return undefined;
  }
  const expression = unwrapExpression(statement.expression);
  return ts.isCallExpression(expression) ? expression : undefined;
}

function directNamedFunctionLike(container, name) {
  const matches = [];
  for (const statement of container.statements ?? []) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      matches.push(statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        matches.push(declaration.initializer);
      }
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function conjunctionLeaves(expression) {
  const current = unwrapExpression(expression);
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [
      ...conjunctionLeaves(current.left),
      ...conjunctionLeaves(current.right),
    ];
  }
  return [current];
}

function isNegatedIdentifier(expression, name) {
  const current = unwrapExpression(expression);
  return (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(unwrapExpression(current.operand)) &&
    unwrapExpression(current.operand).text === name
  );
}

function isStrictStringComparison(expression, path, value) {
  const current = unwrapExpression(expression);
  return (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    pathMatches(current.left, path) &&
    ts.isStringLiteralLike(unwrapExpression(current.right)) &&
    unwrapExpression(current.right).text === value
  );
}

function isZeroArgumentCallStatement(statement, path) {
  const call = callExpressionFromStatement(statement);
  return (
    call !== undefined &&
    call.arguments.length === 0 &&
    pathMatches(call.expression, path)
  );
}

function hasOrderedTouchDismissalCancellation(handler, setterName) {
  if (
    handler === undefined ||
    handler.body === undefined ||
    !ts.isBlock(handler.body) ||
    handler.parameters.length !== 2 ||
    !ts.isIdentifier(handler.parameters[0].name) ||
    !ts.isIdentifier(handler.parameters[1].name)
  ) {
    return false;
  }
  const nextOpenName = handler.parameters[0].name.text;
  const detailsName = handler.parameters[1].name.text;
  const statements = [...handler.body.statements];
  if (statements.length !== 2) {
    return false;
  }
  const hasMatchingIf = (() => {
    const statement = statements[0];
    if (
      !ts.isIfStatement(statement) ||
      statement.elseStatement !== undefined ||
      !ts.isBlock(statement.thenStatement)
    ) {
      return false;
    }
    const leaves = conjunctionLeaves(statement.expression);
    const hasExactCondition =
      leaves.length === 3 &&
      leaves.filter((leaf) => isNegatedIdentifier(leaf, nextOpenName))
        .length === 1 &&
      leaves.filter((leaf) =>
        isStrictStringComparison(
          leaf,
          [detailsName, "reason"],
          "outside-press",
        ),
      ).length === 1 &&
      leaves.filter((leaf) =>
        isStrictStringComparison(
          leaf,
          [detailsName, "event", "type"],
          "touchmove",
        ),
      ).length === 1;
    const branch = [...statement.thenStatement.statements];
    return (
      hasExactCondition &&
      branch.length === 2 &&
      isZeroArgumentCallStatement(branch[0], [detailsName, "cancel"]) &&
      ts.isReturnStatement(branch[1]) &&
      branch[1].expression === undefined
    );
  })();
  if (!hasMatchingIf) {
    return false;
  }

  const setterCalls = [];
  const visitSetterCalls = (node) => {
    if (
      ts.isCallExpression(node) &&
      pathMatches(node.expression, [setterName])
    ) {
      setterCalls.push(node);
    }
    ts.forEachChild(node, visitSetterCalls);
  };
  visitSetterCalls(handler.body);
  if (
    setterCalls.length !== 1 ||
    setterCalls[0].arguments.length !== 1 ||
    !pathMatches(setterCalls[0].arguments[0], [nextOpenName])
  ) {
    return false;
  }
  const setterStatementIndex = statements.findIndex((statement) => {
    const call = callExpressionFromStatement(statement);
    return call === setterCalls[0];
  });
  return setterStatementIndex === 1;
}

function isFalseKeyword(expression) {
  return unwrapExpression(expression).kind === ts.SyntaxKind.FalseKeyword;
}

function isBareReturn(statement) {
  return ts.isReturnStatement(statement) && statement.expression === undefined;
}

function isClosedEffectGuard(statement, openName) {
  if (
    !ts.isIfStatement(statement) ||
    statement.elseStatement !== undefined ||
    !isNegatedIdentifier(statement.expression, openName)
  ) {
    return false;
  }
  const branch = statement.thenStatement;
  return ts.isBlock(branch)
    ? branch.statements.length === 1 && isBareReturn(branch.statements[0])
    : isBareReturn(branch);
}

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : undefined;
}

function hasPassiveFalseOptions(expression) {
  const current = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(current)) {
    return false;
  }
  const properties = new Map();
  for (const property of current.properties) {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }
    const name = propertyNameText(property.name);
    if (name === undefined || properties.has(name)) {
      return false;
    }
    properties.set(name, property.initializer);
  }
  return (
    (properties.size === 1 || properties.size === 2) &&
    properties.has("passive") &&
    isFalseKeyword(properties.get("passive")) &&
    [...properties.keys()].every(
      (name) => name === "passive" || name === "capture",
    ) &&
    (!properties.has("capture") || isFalseKeyword(properties.get("capture")))
  );
}

function functionBody(functionLike) {
  return functionLike?.body !== undefined && ts.isBlock(functionLike.body)
    ? functionLike.body
    : undefined;
}

function singleConstDeclaration(statement) {
  if (
    !ts.isVariableStatement(statement) ||
    (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    statement.declarationList.declarations.length !== 1
  ) {
    return undefined;
  }
  const declaration = statement.declarationList.declarations[0];
  return ts.isIdentifier(declaration.name) &&
    declaration.initializer !== undefined
    ? declaration
    : undefined;
}

function directConstDeclaration(container, name) {
  if (name === undefined) {
    return undefined;
  }
  const matches = (container.statements ?? [])
    .map(singleConstDeclaration)
    .filter((declaration) => declaration?.name.text === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function bindingIdentifiers(name, identifiers = []) {
  if (ts.isIdentifier(name)) {
    identifiers.push(name.text);
    return identifiers;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        bindingIdentifiers(element.name, identifiers);
      }
    }
  }
  return identifiers;
}

function hasSafeRuntimeBindings(sourceFile) {
  const protectedGlobals = new Set(["document", "Element", "Set", "Symbol"]);
  const requiredReactImports = new Set(["useEffect", "useRef"]);
  const foundReactImports = new Set();
  let invalid = false;

  const checkBinding = (name) => {
    if (protectedGlobals.has(name) || requiredReactImports.has(name)) {
      invalid = true;
    }
  };
  const visit = (node) => {
    if (invalid) {
      return;
    }
    if (ts.isImportDeclaration(node)) {
      const moduleName = ts.isStringLiteralLike(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;
      const clause = node.importClause;
      if (clause?.name !== undefined) {
        checkBinding(clause.name.text);
      }
      const namedBindings = clause?.namedBindings;
      if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
        checkBinding(namedBindings.name.text);
      }
      if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
        for (const specifier of namedBindings.elements) {
          const localName = specifier.name.text;
          const importedName = (specifier.propertyName ?? specifier.name).text;
          if (protectedGlobals.has(localName)) {
            invalid = true;
          }
          if (requiredReactImports.has(localName)) {
            if (
              moduleName !== "react" ||
              importedName !== localName ||
              clause?.isTypeOnly === true ||
              specifier.isTypeOnly
            ) {
              invalid = true;
            } else {
              foundReactImports.add(localName);
            }
          }
        }
      }
      return;
    }

    let declarationName;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      declarationName = node.name;
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)
    ) {
      declarationName = node.name;
    }
    if (declarationName !== undefined) {
      for (const name of bindingIdentifiers(declarationName)) {
        checkBinding(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return (
    !invalid &&
    [...requiredReactImports].every((name) => foundReactImports.has(name))
  );
}

function hasPopupAwareTouchCallback(callback) {
  const body = functionBody(callback);
  if (
    body === undefined ||
    callback.parameters.length !== 1 ||
    !ts.isIdentifier(callback.parameters[0].name) ||
    body.statements.length !== 2 ||
    !ts.isVariableStatement(body.statements[0]) ||
    !ts.isIfStatement(body.statements[1])
  ) {
    return false;
  }
  const eventName = callback.parameters[0].name.text;
  const declarations = body.statements[0].declarationList.declarations;
  if (
    declarations.length !== 1 ||
    !ts.isIdentifier(declarations[0].name) ||
    declarations[0].initializer === undefined
  ) {
    return false;
  }
  const insideName = declarations[0].name.text;
  const someCall = unwrapExpression(declarations[0].initializer);
  if (
    !ts.isCallExpression(someCall) ||
    someCall.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(someCall.expression) ||
    someCall.expression.name.text !== "some"
  ) {
    return false;
  }
  const composedPathCall = unwrapExpression(someCall.expression.expression);
  const predicate = unwrapExpression(someCall.arguments[0]);
  if (
    !ts.isCallExpression(composedPathCall) ||
    composedPathCall.arguments.length !== 0 ||
    !pathMatches(composedPathCall.expression, [eventName, "composedPath"]) ||
    (!ts.isArrowFunction(predicate) && !ts.isFunctionExpression(predicate)) ||
    predicate.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    ) ||
    predicate.asteriskToken !== undefined ||
    predicate.parameters.length !== 1 ||
    !ts.isIdentifier(predicate.parameters[0].name) ||
    ts.isBlock(predicate.body)
  ) {
    return false;
  }
  const targetName = predicate.parameters[0].name.text;
  const predicateLeaves = conjunctionLeaves(predicate.body);
  const isElementGuard = (leaf) =>
    ts.isBinaryExpression(leaf) &&
    leaf.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    pathMatches(leaf.left, [targetName]) &&
    pathMatches(leaf.right, ["Element"]);
  const isPopupMatch = (leaf) => {
    const call = unwrapExpression(leaf);
    return (
      ts.isCallExpression(call) &&
      call.arguments.length === 1 &&
      pathMatches(call.expression, [targetName, "classList", "contains"]) &&
      ts.isStringLiteralLike(unwrapExpression(call.arguments[0])) &&
      unwrapExpression(call.arguments[0]).text === "fs-menu__popup"
    );
  };
  const hasSafePredicate =
    predicateLeaves.length === 2 &&
    isElementGuard(predicateLeaves[0]) &&
    isPopupMatch(predicateLeaves[1]);
  const prevention = body.statements[1];
  const preventionStatement = ts.isBlock(prevention.thenStatement)
    ? prevention.thenStatement.statements[0]
    : prevention.thenStatement;
  return (
    hasSafePredicate &&
    prevention.elseStatement === undefined &&
    isNegatedIdentifier(prevention.expression, insideName) &&
    (ts.isBlock(prevention.thenStatement)
      ? prevention.thenStatement.statements.length === 1
      : true) &&
    isZeroArgumentCallStatement(preventionStatement, [
      eventName,
      "preventDefault",
    ])
  );
}

function hasBoundTouchScrollPrevention(sourceFile, menuFunction, openName) {
  const menuBody = functionBody(menuFunction);
  const lockHook = directNamedFunctionLike(sourceFile, "useMenuScrollLock");
  const lockBody = functionBody(lockHook);
  if (
    menuBody === undefined ||
    lockBody === undefined ||
    !hasSafeRuntimeBindings(sourceFile) ||
    lockHook.parameters.length !== 1 ||
    !ts.isIdentifier(lockHook.parameters[0].name) ||
    lockBody.statements.length !== 2
  ) {
    return false;
  }

  const menuHookCalls = menuBody.statements
    .map(callExpressionFromStatement)
    .filter(
      (call) =>
        call !== undefined &&
        pathMatches(call.expression, ["useMenuScrollLock"]) &&
        call.arguments.length === 1 &&
        pathMatches(call.arguments[0], [openName]),
    );
  if (menuHookCalls.length !== 1) {
    return false;
  }

  const hookOpenName = lockHook.parameters[0].name.text;
  const lockDeclaration = singleConstDeclaration(lockBody.statements[0]);
  const lockInitializer =
    lockDeclaration === undefined
      ? undefined
      : unwrapExpression(lockDeclaration.initializer);
  const symbolInitializer =
    lockInitializer !== undefined &&
    ts.isCallExpression(lockInitializer) &&
    pathMatches(lockInitializer.expression, ["useRef"]) &&
    lockInitializer.arguments.length === 1
      ? unwrapExpression(lockInitializer.arguments[0])
      : undefined;
  if (
    lockDeclaration === undefined ||
    symbolInitializer === undefined ||
    !ts.isCallExpression(symbolInitializer) ||
    !pathMatches(symbolInitializer.expression, ["Symbol"]) ||
    symbolInitializer.arguments.length !== 1 ||
    !ts.isStringLiteralLike(unwrapExpression(symbolInitializer.arguments[0])) ||
    unwrapExpression(symbolInitializer.arguments[0]).text !== "menu-scroll-lock"
  ) {
    return false;
  }
  const lockName = lockDeclaration.name.text;
  const effect = callExpressionFromStatement(lockBody.statements[1]);
  if (
    effect === undefined ||
    !pathMatches(effect.expression, ["useEffect"]) ||
    effect.arguments.length !== 2
  ) {
    return false;
  }
  const callback = unwrapExpression(effect.arguments[0]);
  const dependencies = unwrapExpression(effect.arguments[1]);
  if (
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    !ts.isBlock(callback.body) ||
    !ts.isArrayLiteralExpression(dependencies) ||
    dependencies.elements.length !== 1 ||
    !pathMatches(dependencies.elements[0], [hookOpenName])
  ) {
    return false;
  }
  const effectBody = callback.body;
  if (
    effectBody.statements.length !== 8 ||
    !isClosedEffectGuard(effectBody.statements[0], hookOpenName)
  ) {
    return false;
  }

  const rootDeclaration = singleConstDeclaration(effectBody.statements[1]);
  const tokenDeclaration = singleConstDeclaration(effectBody.statements[2]);
  const listenerDeclaration = singleConstDeclaration(effectBody.statements[3]);
  if (
    rootDeclaration === undefined ||
    !pathMatches(rootDeclaration.initializer, [
      "document",
      "documentElement",
    ]) ||
    tokenDeclaration === undefined ||
    !pathMatches(tokenDeclaration.initializer, [lockName, "current"]) ||
    listenerDeclaration === undefined
  ) {
    return false;
  }
  const rootName = rootDeclaration.name.text;
  const tokenName = tokenDeclaration.name.text;
  const listenerName = listenerDeclaration.name.text;
  const listener = unwrapExpression(listenerDeclaration.initializer);
  if (!hasPopupAwareTouchCallback(listener)) {
    return false;
  }

  const addLock = callExpressionFromStatement(effectBody.statements[4]);
  const setMarker = callExpressionFromStatement(effectBody.statements[5]);
  const addListener = callExpressionFromStatement(effectBody.statements[6]);
  const addLockPath =
    addLock === undefined ? undefined : expressionPath(addLock.expression);
  const lockSetName =
    addLockPath?.length === 2 && addLockPath[1] === "add"
      ? addLockPath[0]
      : undefined;
  const attributePath =
    setMarker?.arguments[0] === undefined
      ? undefined
      : expressionPath(setMarker.arguments[0]);
  const attributeName =
    attributePath?.length === 1 ? attributePath[0] : undefined;
  const lockSetDeclaration = directConstDeclaration(sourceFile, lockSetName);
  const lockSetInitializer =
    lockSetDeclaration === undefined
      ? undefined
      : unwrapExpression(lockSetDeclaration.initializer);
  const attributeDeclaration = directConstDeclaration(
    sourceFile,
    attributeName,
  );
  const attributeInitializer =
    attributeDeclaration === undefined
      ? undefined
      : unwrapExpression(attributeDeclaration.initializer);
  if (
    lockSetName === undefined ||
    lockSetInitializer === undefined ||
    !ts.isNewExpression(lockSetInitializer) ||
    !pathMatches(lockSetInitializer.expression, ["Set"]) ||
    (lockSetInitializer.arguments?.length ?? 0) !== 0 ||
    attributeName === undefined ||
    attributeInitializer === undefined ||
    !ts.isStringLiteralLike(attributeInitializer) ||
    attributeInitializer.text !== "data-fs-menu-scroll-lock" ||
    addLock === undefined ||
    !pathMatches(addLock.expression, [lockSetName, "add"]) ||
    addLock.arguments.length !== 1 ||
    !pathMatches(addLock.arguments[0], [tokenName]) ||
    setMarker === undefined ||
    !pathMatches(setMarker.expression, [rootName, "setAttribute"]) ||
    setMarker.arguments.length !== 2 ||
    !pathMatches(setMarker.arguments[0], [attributeName]) ||
    !ts.isStringLiteralLike(unwrapExpression(setMarker.arguments[1])) ||
    unwrapExpression(setMarker.arguments[1]).text !== "" ||
    addListener === undefined ||
    !pathMatches(addListener.expression, ["document", "addEventListener"]) ||
    addListener.arguments.length !== 3 ||
    !ts.isStringLiteralLike(unwrapExpression(addListener.arguments[0])) ||
    unwrapExpression(addListener.arguments[0]).text !== "touchmove" ||
    !pathMatches(addListener.arguments[1], [listenerName]) ||
    !hasPassiveFalseOptions(addListener.arguments[2])
  ) {
    return false;
  }

  const cleanupReturn = effectBody.statements[7];
  if (
    !ts.isReturnStatement(cleanupReturn) ||
    cleanupReturn.expression === undefined
  ) {
    return false;
  }
  const cleanup = unwrapExpression(cleanupReturn.expression);
  const cleanupBody =
    (ts.isArrowFunction(cleanup) || ts.isFunctionExpression(cleanup)) &&
    cleanup.parameters.length === 0 &&
    ts.isBlock(cleanup.body)
      ? cleanup.body
      : undefined;
  if (cleanupBody === undefined || cleanupBody.statements.length !== 3) {
    return false;
  }
  const removeListener = callExpressionFromStatement(cleanupBody.statements[0]);
  const deleteLock = callExpressionFromStatement(cleanupBody.statements[1]);
  const removeMarkerIf = cleanupBody.statements[2];
  if (
    removeListener === undefined ||
    !pathMatches(removeListener.expression, [
      "document",
      "removeEventListener",
    ]) ||
    (removeListener.arguments.length !== 2 &&
      removeListener.arguments.length !== 3) ||
    !ts.isStringLiteralLike(unwrapExpression(removeListener.arguments[0])) ||
    unwrapExpression(removeListener.arguments[0]).text !== "touchmove" ||
    !pathMatches(removeListener.arguments[1], [listenerName]) ||
    (removeListener.arguments.length === 3 &&
      !isFalseKeyword(removeListener.arguments[2])) ||
    deleteLock === undefined ||
    !pathMatches(deleteLock.expression, [lockSetName, "delete"]) ||
    deleteLock.arguments.length !== 1 ||
    !pathMatches(deleteLock.arguments[0], [tokenName]) ||
    !ts.isIfStatement(removeMarkerIf) ||
    removeMarkerIf.elseStatement !== undefined ||
    !ts.isBlock(removeMarkerIf.thenStatement) ||
    removeMarkerIf.thenStatement.statements.length !== 1
  ) {
    return false;
  }
  const lastLockCondition = unwrapExpression(removeMarkerIf.expression);
  const removeMarker = callExpressionFromStatement(
    removeMarkerIf.thenStatement.statements[0],
  );
  return (
    ts.isBinaryExpression(lastLockCondition) &&
    lastLockCondition.operatorToken.kind ===
      ts.SyntaxKind.EqualsEqualsEqualsToken &&
    pathMatches(lastLockCondition.left, [lockSetName, "size"]) &&
    ts.isNumericLiteral(unwrapExpression(lastLockCondition.right)) &&
    unwrapExpression(lastLockCondition.right).text === "0" &&
    removeMarker !== undefined &&
    pathMatches(removeMarker.expression, [rootName, "removeAttribute"]) &&
    removeMarker.arguments.length === 1 &&
    pathMatches(removeMarker.arguments[0], [attributeName])
  );
}

function validateMenuScrollLock(source, css, errors) {
  if (source !== undefined) {
    const sourceFile = parseSource(source, MENU_PATH);
    const menuFunction = directNamedFunctionLike(sourceFile, "Menu");
    const menuBody = functionBody(menuFunction);
    const rootTag = source.match(/<MenuPrimitive\.Root\b([\s\S]*?)>/u)?.[1];
    const openName = rootTag?.match(
      /\bopen=\{\s*([A-Za-z_$][\w$]*)\s*\}/u,
    )?.[1];
    const openSetter =
      openName === undefined
        ? undefined
        : source.match(
            new RegExp(
              `(?:const|let)\\s*\\[\\s*${openName}\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*useState(?:<[^>]+>)?\\(\\s*false\\s*\\)`,
              "u",
            ),
          )?.[1];
    const openChangeHandler = rootTag?.match(
      /\bonOpenChange=\{\s*([A-Za-z_$][\w$]*)\s*\}/u,
    )?.[1];
    const openChangeFunction =
      menuBody !== undefined && openChangeHandler !== undefined
        ? directNamedFunctionLike(menuBody, openChangeHandler)
        : undefined;
    const hasOrderedCancellation =
      openSetter !== undefined &&
      hasOrderedTouchDismissalCancellation(openChangeFunction, openSetter);
    const hasControlledChange =
      openSetter !== undefined &&
      openChangeHandler !== undefined &&
      hasOrderedCancellation;
    const openDrivesEffect =
      openName !== undefined &&
      /\buseEffect\s*\(/u.test(source) &&
      new RegExp(`\\[\\s*${openName}\\s*\\]`, "u").test(source) &&
      (new RegExp(`useMenuScrollLock\\(\\s*${openName}\\s*\\)`, "u").test(
        source,
      ) ||
        new RegExp(`if\\s*\\(\\s*!\\s*${openName}\\s*\\)`, "u").test(source));

    if (!hasControlledChange || !openDrivesEffect) {
      errors.push("Menu must use a controlled open state for scroll locking");
    }

    if (!hasOrderedCancellation) {
      errors.push(
        "Menu must cancel touchmove outside dismissal while scroll lock is active",
      );
    }

    const hasBoundScrollLifecycle =
      openName !== undefined &&
      hasBoundTouchScrollPrevention(sourceFile, menuFunction, openName);
    if (!hasBoundScrollLifecycle) {
      errors.push(
        "Menu scroll lock must prevent outside touchmove without blocking popup scrolling",
      );
      errors.push("Menu scroll lock must use a shared reference count");
      errors.push(
        "Menu scroll lock must set and remove data-fs-menu-scroll-lock on documentElement",
      );
    }

    let indicatorCount = 0;
    let mountedIndicatorCount = 0;
    const visitIndicator = (node) => {
      if (ts.isJsxElement(node)) {
        const opening = node.openingElement;
        if (
          opening.tagName.getText(sourceFile) ===
          "MenuPrimitive.RadioItemIndicator"
        ) {
          indicatorCount += 1;
          const keepMounted = opening.attributes.properties.find(
            (attribute) =>
              ts.isJsxAttribute(attribute) &&
              attribute.name.getText(sourceFile) === "keepMounted",
          );
          if (
            keepMounted !== undefined &&
            ts.isJsxAttribute(keepMounted) &&
            (keepMounted.initializer === undefined ||
              (ts.isJsxExpression(keepMounted.initializer) &&
                keepMounted.initializer.expression?.kind ===
                  ts.SyntaxKind.TrueKeyword))
          ) {
            mountedIndicatorCount += 1;
          }
        }
      }
      ts.forEachChild(node, visitIndicator);
    };
    visitIndicator(sourceFile);
    if (indicatorCount === 0 || mountedIndicatorCount !== indicatorCount) {
      errors.push("Menu RadioItemIndicator must keep its layout slot mounted");
    }
  }

  if (css !== undefined) {
    const rules = cssRules(css);
    let locksRoot = false;
    let locksBody = false;
    for (const rule of rules) {
      if (!/overflow\s*:\s*hidden\s*;/u.test(rule.declarations)) {
        continue;
      }
      const selectors = rule.selector
        .split(",")
        .map((selector) => selector.trim());
      locksRoot ||= selectors.some((selector) =>
        /^(?:html|:root)\[data-fs-menu-scroll-lock\]$/u.test(selector),
      );
      locksBody ||= selectors.some((selector) =>
        /^(?:html|:root)\[data-fs-menu-scroll-lock\]\s+body$/u.test(selector),
      );
    }
    if (!locksRoot || !locksBody) {
      errors.push(
        "interaction CSS must lock root and body overflow while a menu is open",
      );
    }

    const menuPopupRules = rules.filter((rule) =>
      rule.selector
        .split(",")
        .map((selector) => selector.trim())
        .includes(".fs-menu__popup"),
    );
    if (
      !menuPopupRules.some((rule) =>
        /max-block-size\s*:\s*[^;]*var\(\s*--available-height\s*\)/u.test(
          rule.declarations,
        ),
      )
    ) {
      errors.push("menu popup max-block-size must use --available-height");
    }
    if (
      !menuPopupRules.some((rule) =>
        /(?:^|;)\s*overflow\s*:\s*auto\s*(?:;|$)/u.test(rule.declarations),
      )
    ) {
      errors.push("menu popup must use overflow: auto");
    }
    const uncheckedIndicatorIsHidden = rules.some((rule) => {
      const selectors = rule.selector
        .split(",")
        .map((selector) => selector.trim());
      return (
        selectors.includes(".fs-menu__indicator[data-unchecked]") &&
        /(?:^|;)\s*(?:visibility\s*:\s*hidden|opacity\s*:\s*0)\s*(?:;|$)/u.test(
          rule.declarations,
        )
      );
    });
    if (!uncheckedIndicatorIsHidden) {
      errors.push("unchecked Menu indicator must remain visually hidden");
    }
    const highlightedItemRules = rules.filter((rule) =>
      rule.selector
        .split(",")
        .map((selector) => selector.trim())
        .includes(".fs-menu__item[data-highlighted]"),
    );
    const logicalHighlightRail = rules.some((rule) => {
      const selectors = rule.selector
        .split(",")
        .map((selector) => selector.trim());
      return (
        selectors.includes(".fs-menu__item[data-highlighted]::before") &&
        /(?:^|;)\s*content\s*:\s*["']{2}\s*(?:;|$)/u.test(rule.declarations) &&
        /(?:^|;)\s*inset-inline-start\s*:\s*0\s*(?:;|$)/u.test(
          rule.declarations,
        ) &&
        /(?:^|;)\s*inline-size\s*:\s*[^;]*var\(\s*--focus-ring-width\s*\)/u.test(
          rule.declarations,
        )
      );
    });
    if (
      !logicalHighlightRail ||
      highlightedItemRules.some((rule) =>
        /(?:^|;)\s*box-shadow\s*:/u.test(rule.declarations),
      )
    ) {
      errors.push("Menu highlighted indicator must use logical inline-start");
    }
  }
}

function validateInteractionLab(source, errors) {
  if (source === undefined) {
    errors.push(
      "interaction lab must synchronize documentElement lang to previewLocale",
    );
    errors.push(
      "interaction lab must restore the previous documentElement lang",
    );
    return;
  }

  const rootName =
    source.match(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*document\.documentElement\s*;/u,
    )?.[1] ?? "document.documentElement";
  const languageAttributeName = source.match(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*["']lang["']\s*;/u,
  )?.[1];
  const rootPattern =
    rootName === "document.documentElement"
      ? "document\\.documentElement"
      : rootName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const attributePattern =
    languageAttributeName === undefined
      ? `["']lang["']`
      : languageAttributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const previousMatch = source.match(
    new RegExp(
      `\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${rootPattern}(?:\\.lang|\\.getAttribute\\(\\s*${attributePattern}\\s*\\))\\s*;`,
      "u",
    ),
  );
  const setLanguagePattern = new RegExp(
    `(?:${rootPattern}\\.lang\\s*=\\s*previewLocale|${rootPattern}\\.setAttribute\\(\\s*${attributePattern}\\s*,\\s*previewLocale\\s*\\))`,
    "u",
  );
  const setupStart = previousMatch?.index ?? 0;
  const cleanupStart = source.indexOf("return", setupStart);
  const setupEnd = cleanupStart === -1 ? source.length : cleanupStart;
  const setupSource = source.slice(setupStart, setupEnd);
  const setLanguageMatch = setLanguagePattern.exec(setupSource);
  const setLanguageIndex =
    setLanguageMatch === null ? undefined : setupStart + setLanguageMatch.index;
  const effectDependsOnPreviewLocale =
    /\buseEffect\s*\(/u.test(source) &&
    /\[[^\]]*\bpreviewLocale\b[^\]]*\]\s*\)/u.test(source);

  if (
    !source.includes("document.documentElement") ||
    previousMatch === null ||
    setLanguageIndex === undefined ||
    !effectDependsOnPreviewLocale
  ) {
    errors.push(
      "interaction lab must synchronize documentElement lang to previewLocale",
    );
  }

  const previousName = previousMatch?.[1];
  const cleanup =
    setLanguageIndex === undefined
      ? ""
      : source.slice(source.indexOf("return", setLanguageIndex));
  const restoresPrevious =
    previousName !== undefined &&
    (new RegExp(`${rootPattern}\\.lang\\s*=\\s*${previousName}\\s*;`, "u").test(
      cleanup,
    ) ||
      new RegExp(
        `${rootPattern}\\.setAttribute\\(\\s*${attributePattern}\\s*,\\s*${previousName}\\s*\\)`,
        "u",
      ).test(cleanup));
  const readWithGetAttribute =
    previousMatch?.[0].includes("getAttribute") ?? false;
  const removesMissingPrevious = new RegExp(
    `${rootPattern}\\.removeAttribute\\(\\s*${attributePattern}\\s*\\)`,
    "u",
  ).test(cleanup);
  if (
    !/return\s*\(\s*\)\s*=>/u.test(cleanup) ||
    !restoresPrevious ||
    (readWithGetAttribute && !removesMissingPrevious)
  ) {
    errors.push(
      "interaction lab must restore the previous documentElement lang",
    );
  }
}

function importedIconName(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "./icon.js"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }
    const importedIcon = bindings.elements.find(
      (element) => (element.propertyName?.text ?? element.name.text) === "Icon",
    );
    if (importedIcon !== undefined) {
      return importedIcon.name.text;
    }
  }
  return undefined;
}

function renderedIconNames(sourceFile, localIconName) {
  const names = new Set();
  function visit(node) {
    if (
      localIconName !== undefined &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === localIconName
    ) {
      const nameAttribute = node.attributes.properties.find(
        (property) =>
          ts.isJsxAttribute(property) && property.name.text === "name",
      );
      if (
        nameAttribute &&
        ts.isJsxAttribute(nameAttribute) &&
        nameAttribute.initializer &&
        ts.isStringLiteral(nameAttribute.initializer)
      ) {
        names.add(nameAttribute.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function validateSourceOwnedInteractionIcons(sources, errors) {
  const requirements = {
    menu: ["chevron-down", "check"],
    overlay: ["close"],
    toast: ["close"],
  };

  for (const [label, source] of Object.entries(sources)) {
    if (source === undefined) {
      continue;
    }
    const sourceFile = parseSource(source, `${label}.tsx`);
    const localIconName = importedIconName(sourceFile);
    if (localIconName === undefined) {
      errors.push(`${label} must import source-owned Icon from ./icon.js`);
    }
    const iconNames = renderedIconNames(sourceFile, localIconName);
    for (const name of requirements[label]) {
      if (!iconNames.has(name)) {
        errors.push(`${label} must render source-owned Icon name="${name}"`);
      }
    }
    if (
      FUNCTIONAL_GLYPH_OR_EMOJI.test(source) ||
      /\\u\{?(?:00d7|25be|2713|2714|2715|2716|2717)\}?/iu.test(source) ||
      /&(?:#x?(?:00d7|25be|2713|2714|2715|2716|2717)|times);/iu.test(source)
    ) {
      errors.push(
        `interaction sources must not embed functional glyphs or emoji (${label})`,
      );
    }
  }
}

function validateStorefrontCss(css, errors) {
  if (css === undefined) {
    return;
  }
  const imports = [
    ...css.matchAll(
      /@import\s+["']@fan-support\/ui\/interactions\.css["']\s*;/gu,
    ),
  ];
  if (imports.length !== 1) {
    errors.push(
      "Storefront globals must import @fan-support/ui/interactions.css exactly once",
    );
  }
}

async function validateInteractionRoutes(workspaceRoot, errors) {
  const routeFiles = (
    await listFiles(path.join(workspaceRoot, STOREFRONT_APP_PATH))
  )
    .map((absolutePath) => normalizedRelativePath(workspaceRoot, absolutePath))
    .filter((relativePath) => /\/interactions\/page\.tsx$/u.test(relativePath));
  const expectedPaths = new Set(Object.keys(INTERACTION_ROUTES));

  for (const [relativePath, locale] of Object.entries(INTERACTION_ROUTES)) {
    if (!routeFiles.includes(relativePath)) {
      errors.push(`missing interaction preview route ${locale}`);
      continue;
    }
    const source = await readFile(
      path.join(workspaceRoot, relativePath),
      "utf8",
    );
    if (!source.includes('from "../../../../../ui-interactions-specimen"')) {
      errors.push(
        `interaction preview ${locale} must import the shared UiInteractionsSpecimen`,
      );
    }
    if (!new RegExp(`locale=["']${locale}["']`, "u").test(source)) {
      errors.push(
        `interaction preview ${locale} must render locale="${locale}"`,
      );
    }
  }

  for (const relativePath of routeFiles) {
    if (!expectedPaths.has(relativePath)) {
      errors.push(`unexpected interaction page ${relativePath}`);
    }
  }
}

function validatePresentationLocale(source, internalSource, errors) {
  if (source !== undefined) {
    if (!source.includes("supportedLocaleSchema.safeParse(value)")) {
      errors.push(
        "presentation locale values must use supportedLocaleSchema.safeParse",
      );
    }
    if (
      (source.match(/supportedLocaleSchema\.safeParse\s*\(/gu) ?? []).length < 2
    ) {
      errors.push(
        "presentation locale route sources and targets must both use supportedLocaleSchema.safeParse",
      );
    }
    if (source.includes("en-XA")) {
      errors.push(
        "en-XA must not enter the production presentation locale adapter",
      );
    }
    if (!source.includes('"site_locale"')) {
      errors.push("locale cookie must use the site_locale name");
    }
    if (!source.includes('"Path=/"')) {
      errors.push("locale cookie must set Path=/");
    }
    if (!/Max-Age\s*=/u.test(source) || !/31_536_000|31536000/u.test(source)) {
      errors.push("locale cookie must set Max-Age=31536000");
    }
    if (!source.includes('"SameSite=Lax"')) {
      errors.push("locale cookie must set SameSite=Lax");
    }
    if (/Domain\s*=/iu.test(source)) {
      errors.push("locale cookie must remain host-only without Domain");
    }
    if (
      !/if\s*\(\s*options\.secure\s*\)[\s\S]*?(?:push\(\s*["']Secure["']\s*\)|attributes\.push\(\s*["']Secure["']\s*\))/u.test(
        source,
      )
    ) {
      errors.push("locale cookie must add Secure only for HTTPS");
    }
    if (!/new\s+URL\(\s*currentUrl\.href\s*\)/u.test(source)) {
      errors.push(
        "presentation locale URL changes must clone the current URL to preserve origin, query, and hash",
      );
    }
  }

  if (internalSource !== undefined) {
    if (
      !internalSource.includes("supportedLocaleSchema.safeParse(nextLocale)")
    ) {
      errors.push(
        "internal adapter targets must use supportedLocaleSchema.safeParse",
      );
    }
    if (
      !/sourceLocale\s*===\s*["']en-XA["']/u.test(internalSource) ||
      (internalSource.match(/en-XA/gu) ?? []).length !== 1
    ) {
      errors.push(
        "internal adapter must recognize en-XA only as a source preview locale",
      );
    }
    if (!/new\s+URL\(\s*currentUrl\.href\s*\)/u.test(internalSource)) {
      errors.push(
        "internal locale URL changes must clone the current URL to preserve query and hash",
      );
    }
  }
}

function cssRules(css) {
  const rules = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selector = match[1]?.trim();
    const declarations = match[2]?.trim();
    if (selector !== undefined && declarations !== undefined) {
      rules.push({ declarations, selector });
    }
  }
  return rules;
}

function reducedMotionBody(css) {
  const match =
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/gu.exec(css);
  if (match === null) {
    return undefined;
  }
  const openingBrace = match.index + match[0].lastIndexOf("{");
  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(openingBrace + 1, index);
      }
    }
  }
  return undefined;
}

function validateInteractionCss(css, errors) {
  if (css === undefined) {
    return;
  }
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const rules = cssRules(withoutComments);

  const limitedToastIsHidden = rules.some((rule) => {
    const selectors = rule.selector
      .split(",")
      .map((selector) => selector.trim());
    return (
      selectors.includes(".fs-toast[data-limited]") &&
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/u.test(
        rule.declarations,
      )
    );
  });
  if (!limitedToastIsHidden) {
    errors.push("limited Toast items must not remain visible");
  }

  const physicalProperties = new Set();
  for (const match of withoutComments.matchAll(PHYSICAL_DIRECTION_PROPERTY)) {
    if (match[1] !== undefined) {
      physicalProperties.add(match[1]);
    }
  }
  for (const property of physicalProperties) {
    errors.push(`interaction CSS uses physical-direction property ${property}`);
  }
  for (const match of withoutComments.matchAll(
    /(?:^|[;{]\s*)text-align\s*:\s*(left|right)\b/gmu,
  )) {
    errors.push(
      `interaction CSS uses physical-direction value text-align: ${match[1]}`,
    );
  }
  if (/(?:^|[;{]\s*)z-index\s*:/gmu.test(withoutComments)) {
    errors.push("interaction CSS must not declare z-index");
  }

  for (const target of FOCUS_TARGETS) {
    const matchingRules = rules.filter((rule) =>
      rule.selector.includes(`${target}:focus-visible`),
    );
    if (
      matchingRules.length === 0 ||
      !matchingRules.some((rule) =>
        /(?:outline|box-shadow)\s*:\s*(?!none\b|0(?:\D|$))/u.test(
          rule.declarations,
        ),
      )
    ) {
      errors.push(
        `interaction controls must have visible :focus-visible styles (${target})`,
      );
    }
  }

  const reducedMotion = reducedMotionBody(withoutComments);
  if (reducedMotion === undefined) {
    errors.push("interaction CSS must include a reduced-motion override");
  } else {
    if (
      !/transition\s*:\s*none\s*;/u.test(reducedMotion) ||
      !/transform\s*:\s*none\s*;/u.test(reducedMotion) ||
      REDUCED_MOTION_TARGETS.some((target) => !reducedMotion.includes(target))
    ) {
      errors.push(
        "interaction reduced-motion override must neutralize every moving surface",
      );
    }
    const reducedRules = cssRules(reducedMotion);
    const drawerStartSelector =
      ".fs-overlay__viewport .fs-drawer__popup[data-side][data-starting-style]";
    const drawerEndSelector =
      ".fs-overlay__viewport .fs-drawer__popup[data-side][data-ending-style]";
    const hasSpecificDrawerOverride = reducedRules.some((rule) => {
      const selectors = rule.selector
        .split(",")
        .map((selector) => selector.trim());
      return (
        selectors.includes(drawerStartSelector) &&
        selectors.includes(drawerEndSelector) &&
        /(?:^|;)\s*transform\s*:\s*none\s*(?:;|$)/u.test(rule.declarations)
      );
    });
    if (!hasSpecificDrawerOverride) {
      errors.push(
        "reduced-motion Drawer transform override must beat directional selectors",
      );
    }
  }

  for (const rule of rules) {
    if (
      !CRITICAL_COPY_CLASSES.some((className) =>
        new RegExp(`\\.${className}(?![-_a-zA-Z0-9])`, "u").test(rule.selector),
      )
    ) {
      continue;
    }
    if (
      /(?:^|;)\s*(?:-webkit-line-clamp|block-size|line-clamp|max-block-size|text-overflow|white-space)\s*:/u.test(
        rule.declarations,
      ) ||
      /(?:^|;)\s*overflow\s*:\s*(?:clip|hidden)\b/u.test(rule.declarations)
    ) {
      errors.push(
        `visible critical copy must not be truncated (${rule.selector.replace(/\s+/gu, " ")})`,
      );
    }
  }
}

export async function validateUiInteractions(
  workspaceRoot = defaultWorkspaceRoot,
) {
  const errors = [];
  const [
    uiManifest,
    interactions,
    root,
    client,
    overlay,
    menu,
    toast,
    selectionControls,
    interactionCss,
    contractLocale,
    storefrontCss,
    interactionLab,
    presentationLocale,
    internalPresentationLocale,
  ] = await Promise.all([
    readJson(workspaceRoot, UI_MANIFEST_PATH, errors),
    readText(workspaceRoot, INTERACTIONS_ENTRY_PATH, errors),
    readText(workspaceRoot, ROOT_ENTRY_PATH, errors),
    readText(workspaceRoot, CLIENT_ENTRY_PATH, errors),
    readText(workspaceRoot, OVERLAY_PATH, errors),
    readText(workspaceRoot, MENU_PATH, errors),
    readText(workspaceRoot, TOAST_PATH, errors),
    readText(workspaceRoot, SELECTION_CONTROLS_PATH, errors),
    readText(workspaceRoot, INTERACTION_CSS_PATH, errors),
    readText(workspaceRoot, CONTRACT_LOCALE_PATH, errors),
    readText(workspaceRoot, STOREFRONT_GLOBAL_CSS_PATH, errors),
    readText(workspaceRoot, INTERACTION_LAB_PATH, errors),
    readText(workspaceRoot, PRESENTATION_LOCALE_PATH, errors),
    readText(workspaceRoot, INTERNAL_PRESENTATION_LOCALE_PATH, errors),
  ]);

  validateUiManifest(uiManifest, errors);
  validateEntrypoints(interactions, root, client, errors);
  await validateBaseUiBoundary(workspaceRoot, errors);
  validateCanonicalLocaleSource(contractLocale, selectionControls, errors);
  validateMenuScrollLock(menu, interactionCss, errors);
  validateInteractionLab(interactionLab, errors);
  validateSourceOwnedInteractionIcons({ menu, overlay, toast }, errors);
  validateStorefrontCss(storefrontCss, errors);
  await validateInteractionRoutes(workspaceRoot, errors);
  validatePresentationLocale(
    presentationLocale,
    internalPresentationLocale,
    errors,
  );
  validateInteractionCss(interactionCss, errors);

  return [...new Set(errors)].sort();
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  const errors = await validateUiInteractions();
  if (errors.length > 0) {
    console.error("UI interaction validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      "UI interaction validation passed: dedicated exports, Base UI boundaries, locale isolation, gated fixtures, and accessible motion/layout styles are synchronized.",
    );
  }
}
