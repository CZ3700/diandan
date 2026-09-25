import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { requiresBrowserEvidence } from "./browser-evidence-policy.mjs";
import {
  assessCurrentCompositeEvidence,
  collectCompositeSourceFingerprint,
  validateCompositeEvidenceCandidate,
} from "./verify-ui-composites-browser.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");

const UI_MANIFEST_PATH = "packages/ui/package.json";
const COMPOSITES_ENTRY_PATH = "packages/ui/src/composites.ts";
const COMPOSITES_CSS_PATH = "packages/ui/styles/composites.css";
const STOREFRONT_GLOBAL_CSS_PATH = "apps/storefront/src/app/globals.css";
const INTERNAL_LAYOUT_PATH =
  "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx";
const ROOT_MANIFEST_PATH = "package.json";
const STOREFRONT_APP_PATH = "apps/storefront/src/app";
const COMPOSITE_EVIDENCE_PATH = "output/playwright/p2-04";

const EXPECTED_PACKAGE_EXPORTS = Object.freeze({
  ".": Object.freeze({
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  }),
  "./client": Object.freeze({
    types: "./dist/client.d.ts",
    import: "./dist/client.js",
  }),
  "./composites": Object.freeze({
    types: "./dist/composites.d.ts",
    import: "./dist/composites.js",
  }),
  "./composites-client": Object.freeze({
    types: "./dist/composites-client.d.ts",
    import: "./dist/composites-client.js",
  }),
  "./composites.css": "./styles/composites.css",
  "./interactions": Object.freeze({
    types: "./dist/interactions.d.ts",
    import: "./dist/interactions.js",
  }),
  "./interactions.css": "./styles/interactions.css",
  "./motion": Object.freeze({
    types: "./dist/motion.d.ts",
    import: "./dist/motion.js",
  }),
  "./motion-client": Object.freeze({
    types: "./dist/motion-client.d.ts",
    import: "./dist/motion-client.js",
  }),
  "./motion.css": "./styles/motion.css",
  "./primitives.css": "./styles/primitives.css",
});

const EXPECTED_SIDE_EFFECTS = Object.freeze([
  "./styles/composites.css",
  "./styles/interactions.css",
  "./styles/motion.css",
  "./styles/primitives.css",
]);

const EXPECTED_COMPOSITE_VALUES = Object.freeze([
  "CartLine",
  "GiftTile",
  "Hero",
  "IdolContext",
  "IdolPortrait",
  "OrderTimeline",
]);

const EXPECTED_COMPOSITE_TYPES = Object.freeze([
  "CartLineProps",
  "CompositeAction",
  "CompositeFocalPoint",
  "CompositeMedia",
  "CompositeMediaResource",
  "CompositeMoney",
  "CompositeResponsiveMedia",
  "GiftTileProps",
  "HeroProps",
  "IdolContextProps",
  "IdolPortraitProps",
  "OrderTimelineProps",
  "OrderTimelineStep",
]);

const EXPECTED_COMPOSITE_CLIENT_VALUES = Object.freeze(["InteractiveCartLine"]);
const EXPECTED_COMPOSITE_CLIENT_TYPES = Object.freeze([
  "InteractiveCartLineProps",
]);
const ALLOWED_COMPOSITE_CLIENT_BOUNDARIES = new Set([
  "packages/ui/src/composite-media-client.tsx",
]);

const FROZEN_ENTRIES = Object.freeze({
  "packages/ui/src/index.ts": Object.freeze({
    label: "root",
    types: Object.freeze([
      "ButtonProps",
      "FieldProps",
      "IconName",
      "IconProps",
      "LinkProps",
      "PriceProps",
      "StatusProps",
    ]),
    values: Object.freeze([
      "Button",
      "Field",
      "Icon",
      "Link",
      "Price",
      "Status",
      "buttonVariants",
      "linkVariants",
      "statusVariants",
      "workspacePackageName",
    ]),
  }),
  "packages/ui/src/client.ts": Object.freeze({
    label: "client",
    types: Object.freeze(["MediaFit", "MediaProps", "QuantityProps"]),
    values: Object.freeze(["Media", "Quantity"]),
  }),
  "packages/ui/src/interactions.ts": Object.freeze({
    label: "interactions",
    types: Object.freeze([
      "DialogProps",
      "DrawerProps",
      "DrawerSide",
      "LanguageControlProps",
      "LiveRegionProps",
      "MenuOption",
      "MenuProps",
      "RegionControlProps",
      "RegionOption",
      "ToastController",
      "ToastMessage",
      "ToastProviderProps",
    ]),
    values: Object.freeze([
      "Dialog",
      "Drawer",
      "LanguageControl",
      "LiveRegion",
      "Menu",
      "RegionControl",
      "ToastProvider",
      "useToast",
    ]),
  }),
});

const COMPOSITE_OWNED_MODULES = new Set([
  "cart-line.tsx",
  "cart-line-client.tsx",
  "composite-media-client.tsx",
  "composite-media.tsx",
  "composite-state.tsx",
  "composite-types.ts",
  "composites.ts",
  "composites-client.ts",
  "gift-tile.tsx",
  "hero.tsx",
  "idol-context.tsx",
  "idol-portrait.tsx",
  "order-timeline.tsx",
]);

const FORBIDDEN_COMPOSITE_MODULES = new Set([
  "client.ts",
  "interactions.ts",
  "live-region.tsx",
  "media.tsx",
  "menu.tsx",
  "overlay.tsx",
  "quantity.tsx",
  "selection-controls.tsx",
  "toast.tsx",
]);

const ALLOWED_EXTERNAL_IMPORTS = new Set([
  "@fan-support/contracts",
  "class-variance-authority",
  "react",
]);

const COMPOSITE_ROUTES = Object.freeze({
  "apps/storefront/src/app/%5Finternal/design-foundations/(japanese)/ja/components/page.tsx":
    "ja",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en-XA/components/page.tsx":
    "en-XA",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en/components/page.tsx":
    "en",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/es/components/page.tsx":
    "es",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/pt/components/page.tsx":
    "pt",
  "apps/storefront/src/app/%5Finternal/design-foundations/(simplified-chinese)/zh-CN/components/page.tsx":
    "zh-CN",
  "apps/storefront/src/app/%5Finternal/design-foundations/(thai)/th/components/page.tsx":
    "th",
  "apps/storefront/src/app/%5Finternal/design-foundations/(vietnamese)/vi/components/page.tsx":
    "vi",
});

const PHYSICAL_DIRECTION_PROPERTY =
  /^(?:border-(?:bottom-left|bottom-right|left|right|top-left|top-right)(?:-color|-radius|-style|-width)?|inset-left|inset-right|left|margin-left|margin-right|padding-left|padding-right|right)$/u;
const CLIPPING_PROPERTY =
  /^(?:-webkit-line-clamp|block-size|height|line-clamp|max-block-size|max-height|overflow|text-overflow|white-space)$/u;
const TRANSLATABLE_CLASSES = Object.freeze([
  "fs-cart-line__idol",
  "fs-cart-line__title",
  "fs-cart-line__variant",
  "fs-composite-state",
  "fs-gift-tile__subtitle",
  "fs-gift-tile__title",
  "fs-hero__description",
  "fs-hero__eyebrow",
  "fs-hero__heading",
  "fs-idol-context__label",
  "fs-idol-context__name",
  "fs-idol-portrait__name",
  "fs-idol-portrait__selected",
  "fs-order-timeline__content",
  "fs-order-timeline__label",
]);

async function readText(workspaceRoot, relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`missing UI composite file ${relativePath}: ${detail}`);
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

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((entry) => actual.includes(entry))
  );
}

function sameObject(actual, expected) {
  return (
    actual !== null &&
    typeof actual === "object" &&
    !Array.isArray(actual) &&
    sameSet(Object.keys(actual), Object.keys(expected)) &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function validateManifest(manifest, errors) {
  const exports = manifest?.exports;
  if (
    exports === null ||
    typeof exports !== "object" ||
    Array.isArray(exports)
  ) {
    errors.push("@fan-support/ui must declare explicit package exports");
    return;
  }
  for (const [subpath, expected] of Object.entries(EXPECTED_PACKAGE_EXPORTS)) {
    const actual = exports[subpath];
    const matches =
      typeof expected === "string"
        ? actual === expected
        : sameObject(actual, expected);
    if (!matches) {
      errors.push(
        `@fan-support/ui must declare exact package export ${subpath}`,
      );
    }
  }
  for (const subpath of Object.keys(exports)) {
    if (!(subpath in EXPECTED_PACKAGE_EXPORTS)) {
      errors.push(`@fan-support/ui has unexpected public export ${subpath}`);
    }
  }
  if (!sameSet(manifest?.sideEffects ?? [], EXPECTED_SIDE_EFFECTS)) {
    errors.push(
      "@fan-support/ui sideEffects must list composite, interaction and primitive CSS exactly once",
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

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function declaredBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      declaredBindingNames(element.name, names);
    }
  }
}

function exportSurface(sourceFile, errors, label) {
  const values = [];
  const types = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined) {
        errors.push(`${label} must use explicit named exports`);
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        errors.push(`${label} must not use namespace exports`);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        const destination =
          statement.isTypeOnly || element.isTypeOnly ? types : values;
        destination.push(element.name.text);
      }
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name !== undefined) {
        values.push(statement.name.text);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        declaredBindingNames(declaration.name, values);
      }
      continue;
    }
    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)
    ) {
      types.push(statement.name.text);
    }
  }
  return { types: types.sort(), values: values.sort() };
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

function moduleSpecifiers(sourceFile, errors, label) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      if (
        node.arguments.length !== 1 ||
        !ts.isStringLiteral(node.arguments[0])
      ) {
        errors.push(`${label} must not use computed dynamic imports`);
      } else {
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

async function resolveRelativeModule(workspaceRoot, fromPath, specifier) {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromPath), specifier),
  );
  const candidates = specifier.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`]
    : [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ];
  for (const candidate of candidates) {
    try {
      await readFile(path.join(workspaceRoot, candidate), "utf8");
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function dependencyClosure(
  workspaceRoot,
  entryPath,
  errors,
  label,
  options = {},
) {
  const pending = [entryPath];
  const visited = new Set();
  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (relativePath === undefined || visited.has(relativePath)) {
      continue;
    }
    visited.add(relativePath);
    const source = await readText(workspaceRoot, relativePath, errors);
    if (source === undefined) {
      continue;
    }
    const sourceFile = parseSource(source, relativePath);
    if (
      options.enforceServer === true &&
      hasUseClientDirective(sourceFile) &&
      !options.allowedClientBoundaries?.has(relativePath)
    ) {
      errors.push(
        `${label} must remain server-compatible; reached ${relativePath}`,
      );
    }
    for (const specifier of moduleSpecifiers(sourceFile, errors, label)) {
      if (!specifier.startsWith(".")) {
        if (
          options.enforceExternalAllowlist === true &&
          !ALLOWED_EXTERNAL_IMPORTS.has(specifier)
        ) {
          errors.push(
            `${label} has forbidden external dependency ${specifier}`,
          );
        }
        continue;
      }
      const resolved = await resolveRelativeModule(
        workspaceRoot,
        relativePath,
        specifier,
      );
      if (resolved === undefined) {
        errors.push(
          `${label} has unresolved relative import ${specifier} from ${relativePath}`,
        );
        continue;
      }
      pending.push(resolved);
    }
  }
  return visited;
}

async function validateEntries(workspaceRoot, errors) {
  const compositeSource = await readText(
    workspaceRoot,
    COMPOSITES_ENTRY_PATH,
    errors,
  );
  if (compositeSource !== undefined) {
    const sourceFile = parseSource(compositeSource, COMPOSITES_ENTRY_PATH);
    const surface = exportSurface(sourceFile, errors, "composites entry");
    if (!sameSet(surface.values, EXPECTED_COMPOSITE_VALUES)) {
      errors.push("composites entry must expose exact value exports");
    }
    if (!sameSet(surface.types, EXPECTED_COMPOSITE_TYPES)) {
      errors.push("composites entry must expose exact type exports");
    }
  }

  const compositeGraph = await dependencyClosure(
    workspaceRoot,
    COMPOSITES_ENTRY_PATH,
    errors,
    "composites entry",
    {
      allowedClientBoundaries: ALLOWED_COMPOSITE_CLIENT_BOUNDARIES,
      enforceExternalAllowlist: true,
      enforceServer: true,
    },
  );
  for (const relativePath of compositeGraph) {
    if (FORBIDDEN_COMPOSITE_MODULES.has(path.posix.basename(relativePath))) {
      errors.push(`forbidden composite dependency ${relativePath}`);
    }
  }

  const compositeClientPath = "packages/ui/src/composites-client.ts";
  const compositeClientSource = await readText(
    workspaceRoot,
    compositeClientPath,
    errors,
  );
  if (compositeClientSource !== undefined) {
    const sourceFile = parseSource(compositeClientSource, compositeClientPath);
    const surface = exportSurface(
      sourceFile,
      errors,
      "composites client entry",
    );
    if (!hasUseClientDirective(sourceFile)) {
      errors.push("composites client entry must declare use client");
    }
    if (!sameSet(surface.values, EXPECTED_COMPOSITE_CLIENT_VALUES)) {
      errors.push("composites client entry must expose exact value exports");
    }
    if (!sameSet(surface.types, EXPECTED_COMPOSITE_CLIENT_TYPES)) {
      errors.push("composites client entry must expose exact type exports");
    }
  }

  for (const [relativePath, expected] of Object.entries(FROZEN_ENTRIES)) {
    const source = await readText(workspaceRoot, relativePath, errors);
    if (source !== undefined) {
      const sourceFile = parseSource(source, relativePath);
      const surface = exportSurface(
        sourceFile,
        errors,
        `${expected.label} entry`,
      );
      if (!sameSet(surface.values, expected.values)) {
        errors.push(`frozen ${expected.label} value exports must remain exact`);
      }
      if (!sameSet(surface.types, expected.types)) {
        errors.push(`frozen ${expected.label} type exports must remain exact`);
      }
    }
    const graph = await dependencyClosure(
      workspaceRoot,
      relativePath,
      errors,
      `${expected.label} entry`,
    );
    if (
      [...graph].some((entry) =>
        COMPOSITE_OWNED_MODULES.has(path.posix.basename(entry)),
      )
    ) {
      errors.push(`${expected.label} entry must not reach composite modules`);
    }
  }
}

function cssRules(css) {
  const rules = [];
  const matcher = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of css.matchAll(matcher)) {
    const selector = match[1]?.trim() ?? "";
    const declarations = [];
    for (const rawDeclaration of (match[2] ?? "").split(";")) {
      const separator = rawDeclaration.indexOf(":");
      if (separator === -1) {
        continue;
      }
      declarations.push({
        property: rawDeclaration.slice(0, separator).trim().toLowerCase(),
        value: rawDeclaration
          .slice(separator + 1)
          .trim()
          .toLowerCase(),
      });
    }
    rules.push({ declarations, selector });
  }
  return rules;
}

function validateCss(css, errors) {
  if (css !== undefined) {
    for (const rule of cssRules(css.replace(/\/\*[\s\S]*?\*\//gu, ""))) {
      for (const declaration of rule.declarations) {
        if (PHYSICAL_DIRECTION_PROPERTY.test(declaration.property)) {
          errors.push(
            `composites must use logical CSS properties (${declaration.property})`,
          );
        }
        if (
          TRANSLATABLE_CLASSES.some((className) =>
            new RegExp(`\\.${className}(?![\\w-])`, "u").test(rule.selector),
          ) &&
          CLIPPING_PROPERTY.test(declaration.property) &&
          (declaration.property !== "overflow" ||
            declaration.value !== "visible")
        ) {
          errors.push(
            `composite translatable text must not be clipped (${rule.selector})`,
          );
        }
      }
    }
  }
}

function validateStyleConsumption(storefrontCss, internalLayout, errors) {
  if (storefrontCss !== undefined) {
    const imports = [
      ...storefrontCss.matchAll(
        /@import\s+["']@fan-support\/ui\/composites\.css["']\s*;/gu,
      ),
    ];
    if (imports.length !== 0) {
      errors.push("Storefront public root must not import composites.css");
    }
  }
  if (internalLayout !== undefined) {
    const source = parseSource(internalLayout, INTERNAL_LAYOUT_PATH);
    const imports = source.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "@fan-support/ui/composites.css",
    );
    if (imports.length !== 1 || imports[0].importClause !== undefined) {
      errors.push(
        "Storefront internal layout must import composites.css exactly once as a side effect",
      );
    }
  }
}

async function listFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function normalizedRelativePath(workspaceRoot, absolutePath) {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
}

async function validateRoutes(workspaceRoot, errors) {
  const routeFiles = (
    await listFiles(path.join(workspaceRoot, STOREFRONT_APP_PATH))
  )
    .map((absolutePath) => normalizedRelativePath(workspaceRoot, absolutePath))
    .filter((relativePath) => /\/components\/page\.tsx$/u.test(relativePath));
  const expectedPaths = new Set(Object.keys(COMPOSITE_ROUTES));
  for (const [relativePath, locale] of Object.entries(COMPOSITE_ROUTES)) {
    if (!routeFiles.includes(relativePath)) {
      errors.push(`missing composite preview route ${locale}`);
      continue;
    }
    const source = await readText(workspaceRoot, relativePath, errors);
    if (
      source !== undefined &&
      (!source.includes('from "../../../../../ui-composites-specimen"') ||
        !source.includes(`locale="${locale}"`))
    ) {
      errors.push(
        `composite preview route ${locale} must bind its canonical locale`,
      );
    }
  }
  for (const relativePath of routeFiles) {
    if (!expectedPaths.has(relativePath)) {
      errors.push(`unexpected composite preview route ${relativePath}`);
    }
  }
}

function validateRootScripts(manifest, errors) {
  const expected =
    "node --test ./scripts/check-ui-composites.test.mjs && node ./scripts/check-ui-composites.mjs";
  if (manifest?.scripts?.["check:ui-composites"] !== expected) {
    errors.push(
      "root package must define the exact check:ui-composites script",
    );
  }
  if (
    !manifest?.scripts?.check?.includes("corepack pnpm check:ui-composites")
  ) {
    errors.push("root check must run check:ui-composites");
  }
}

export async function validateUiComposites(
  workspaceRoot = defaultWorkspaceRoot,
) {
  const errors = [];
  const [uiManifest, rootManifest, css, storefrontCss, internalLayout] =
    await Promise.all([
      readJson(workspaceRoot, UI_MANIFEST_PATH, errors),
      readJson(workspaceRoot, ROOT_MANIFEST_PATH, errors),
      readText(workspaceRoot, COMPOSITES_CSS_PATH, errors),
      readText(workspaceRoot, STOREFRONT_GLOBAL_CSS_PATH, errors),
      readText(workspaceRoot, INTERNAL_LAYOUT_PATH, errors),
    ]);
  validateManifest(uiManifest, errors);
  validateRootScripts(rootManifest, errors);
  await validateEntries(workspaceRoot, errors);
  validateCss(css, errors);
  validateStyleConsumption(storefrontCss, internalLayout, errors);
  await validateRoutes(workspaceRoot, errors);
  return errors;
}

export async function validatePersistedUiCompositeEvidence(
  workspaceRoot = defaultWorkspaceRoot,
) {
  try {
    const evidence = await validateCompositeEvidenceCandidate(
      path.join(workspaceRoot, COMPOSITE_EVIDENCE_PATH),
    );
    const currentFingerprint =
      await collectCompositeSourceFingerprint(workspaceRoot);
    return assessCurrentCompositeEvidence(evidence, currentFingerprint);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      `persisted P2-04 browser evidence is missing or invalid: ${detail}`,
    ];
  }
}

/** Structure is always checked; persisted browser evidence only when required. */
export async function runUiCompositesCheck({
  workspaceRoot = defaultWorkspaceRoot,
  requireBrowserEvidence = false,
  validateStructure = validateUiComposites,
  validateEvidence = validatePersistedUiCompositeEvidence,
} = {}) {
  const [structureErrors, evidenceErrors] = await Promise.all([
    validateStructure(workspaceRoot),
    requireBrowserEvidence ? validateEvidence(workspaceRoot) : [],
  ]);
  return [...structureErrors, ...evidenceErrors];
}

async function main() {
  const requireBrowserEvidence = requiresBrowserEvidence();
  const errors = await runUiCompositesCheck({ requireBrowserEvidence });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    requireBrowserEvidence
      ? "UI composite boundary check passed."
      : "UI composite boundary check passed (browser evidence not required locally; run pnpm verify:ui-composites:browser for browser acceptance).",
  );
}

if (process.argv[1] === scriptPath) {
  await main();
}
