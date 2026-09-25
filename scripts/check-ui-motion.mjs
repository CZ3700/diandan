import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";
import ts from "typescript";

import { requiresBrowserEvidence } from "./browser-evidence-policy.mjs";
import {
  assessCurrentMotionEvidence,
  collectMotionSourceFingerprint,
  validateMotionEvidenceCandidate,
} from "./verify-ui-motion-browser.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");

const UI_MANIFEST_PATH = "packages/ui/package.json";
const MOTION_SERVER_PATH = "packages/ui/src/motion.tsx";
const MOTION_CLIENT_PATH = "packages/ui/src/motion-client.tsx";
const MOTION_CSS_PATH = "packages/ui/styles/motion.css";
const GLOBAL_CSS_PATH = "apps/storefront/src/app/globals.css";
const SPECIMEN_PATH = "apps/storefront/src/app/ui-motion-specimen.tsx";
const LAB_PATH = "apps/storefront/src/app/ui-motion-lab.tsx";
const MOTION_ASSET_README_PATH = "apps/storefront/public/ui-motion/README.md";
const MOTION_EVIDENCE_PATH = "output/playwright/p2-05";

const EXPECTED_MOTION_EXPORTS = Object.freeze({
  "./motion": Object.freeze({
    types: "./dist/motion.d.ts",
    import: "./dist/motion.js",
  }),
  "./motion-client": Object.freeze({
    types: "./dist/motion-client.d.ts",
    import: "./dist/motion-client.js",
  }),
  "./motion.css": "./styles/motion.css",
});

const FROZEN_ENTRY_PATHS = Object.freeze({
  "packages/ui/src/index.ts": "root",
  "packages/ui/src/client.ts": "client",
  "packages/ui/src/interactions.ts": "interactions",
  "packages/ui/src/composites.ts": "composites",
  "packages/ui/src/composites-client.ts": "composites-client",
});

const MOTION_ROUTES = Object.freeze({
  "apps/storefront/src/app/%5Finternal/design-foundations/(japanese)/ja/motion/page.tsx":
    "ja",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en-XA/motion/page.tsx":
    "en-XA",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/en/motion/page.tsx":
    "en",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/es/motion/page.tsx":
    "es",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/pt/motion/page.tsx":
    "pt",
  "apps/storefront/src/app/%5Finternal/design-foundations/(simplified-chinese)/zh-CN/motion/page.tsx":
    "zh-CN",
  "apps/storefront/src/app/%5Finternal/design-foundations/(thai)/th/motion/page.tsx":
    "th",
  "apps/storefront/src/app/%5Finternal/design-foundations/(vietnamese)/vi/motion/page.tsx":
    "vi",
});

const HEAVYWEIGHT_MOTION_DEPENDENCIES = new Set([
  "@motionone/dom",
  "@react-spring/web",
  "animejs",
  "framer-motion",
  "gsap",
  "lottie-web",
  "motion",
  "react-spring",
  "react-transition-group",
]);

const ALLOWED_DURATION_TOKEN =
  /var\(\s*--motion-(?:control|hero|layout)-effective\s*\)/u;
const MOTION_TIME_PROPERTY =
  /^(?:animation|animation-delay|animation-duration|transition|transition-delay|transition-duration)$/u;
const ANIMATABLE_COMPOSITE_PROPERTIES = new Set([
  "clip-path",
  "opacity",
  "transform",
]);

async function readText(workspaceRoot, relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`missing UI motion file ${relativePath}: ${detail}`);
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

function sameStructure(actual, expected) {
  if (Object.is(actual, expected)) {
    return true;
  }
  if (
    actual === null ||
    expected === null ||
    typeof actual !== "object" ||
    typeof expected !== "object" ||
    Array.isArray(actual) !== Array.isArray(expected)
  ) {
    return false;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return (
      actual.length === expected.length &&
      actual.every((value, index) => sameStructure(value, expected[index]))
    );
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key, index) =>
        key === expectedKeys[index] &&
        sameStructure(actual[key], expected[key]),
    )
  );
}

function referencesMotionTarget(value) {
  if (typeof value === "string") {
    return /(?:^|\/)motion(?:[-.]|$)/u.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(referencesMotionTarget);
  }
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).some(referencesMotionTarget)
  );
}

function validateManifest(manifest, errors) {
  const packageExports = manifest?.exports;
  for (const [publicPath, expected] of Object.entries(
    EXPECTED_MOTION_EXPORTS,
  )) {
    if (!sameStructure(packageExports?.[publicPath], expected)) {
      errors.push(`@fan-support/ui must define the exact ${publicPath} export`);
    }
  }

  if (packageExports !== null && typeof packageExports === "object") {
    for (const publicPath of Object.keys(packageExports)) {
      if (
        publicPath.startsWith("./motion") &&
        !Object.hasOwn(EXPECTED_MOTION_EXPORTS, publicPath)
      ) {
        errors.push(`unexpected motion export ${publicPath}`);
      }
      if (
        !Object.hasOwn(EXPECTED_MOTION_EXPORTS, publicPath) &&
        referencesMotionTarget(packageExports[publicPath])
      ) {
        errors.push(`unexpected alias to a motion target ${publicPath}`);
      }
    }
  }

  const sideEffects = Array.isArray(manifest?.sideEffects)
    ? manifest.sideEffects
    : [];
  if (
    sideEffects.filter((entry) => entry === "./styles/motion.css").length !== 1
  ) {
    errors.push(
      "@fan-support/ui must list motion.css side effect exactly once",
    );
  }
}

function parseTypeScript(source, relativePath, errors) {
  if (source === undefined) {
    return undefined;
  }
  const parsed = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (parsed.parseDiagnostics.length > 0) {
    errors.push(`${relativePath} must parse as TypeScript`);
  }
  return parsed;
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function collectBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, names);
    }
  }
}

function collectRuntimeExports(sourceFile) {
  const names = [];
  for (const statement of sourceFile.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    if (
      exported &&
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement))
    ) {
      names.push(
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
          ? "default"
          : (statement.name?.text ?? "anonymous"),
      );
      continue;
    }
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.push("default");
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) {
      continue;
    }
    if (statement.exportClause === undefined) {
      names.push("*");
      continue;
    }
    if (ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) {
        if (!specifier.isTypeOnly) {
          names.push(specifier.name.text);
        }
      }
    }
  }
  return names.sort();
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((name) => actual.includes(name))
  );
}

function isDirective(statement, value) {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text === value
  );
}

function validateEntrypoints(serverSource, clientSource, errors) {
  const server = parseTypeScript(serverSource, MOTION_SERVER_PATH, errors);
  const client = parseTypeScript(clientSource, MOTION_CLIENT_PATH, errors);
  if (server !== undefined) {
    if (
      server.statements.some((statement) =>
        isDirective(statement, "use client"),
      )
    ) {
      errors.push("motion server entry must not use client");
    }
    const runtimeExports = collectRuntimeExports(server);
    if (!sameSet(runtimeExports, ["HeroEntrance", "SuccessReveal"])) {
      errors.push(
        `motion server runtime exports must be exactly HeroEntrance and SuccessReveal; found ${runtimeExports.join(", ")}`,
      );
    }
  }
  if (client !== undefined) {
    if (!isDirective(client.statements[0], "use client")) {
      errors.push('motion-client first statement must be "use client"');
    }
    const runtimeExports = collectRuntimeExports(client);
    if (!sameSet(runtimeExports, ["AddToCartConfirmation", "IdolSwitcher"])) {
      errors.push(
        `motion-client runtime exports must be exactly AddToCartConfirmation and IdolSwitcher; found ${runtimeExports.join(", ")}`,
      );
    }
  }
}

function modulePathTouchesMotion(modulePath) {
  return /(?:^|\/)motion(?:[-./]|$)/u.test(modulePath);
}

function validateFrozenEntry(source, relativePath, label, errors) {
  const parsed = parseTypeScript(source, relativePath, errors);
  if (parsed === undefined) {
    return;
  }
  for (const statement of parsed.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      modulePathTouchesMotion(statement.moduleSpecifier.text)
    ) {
      errors.push(
        `frozen ${label} entry must not import or re-export motion modules`,
      );
    }
  }
}

function splitTopLevelCommas(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function insideKeyframes(declaration) {
  let current = declaration.parent;
  while (current !== undefined) {
    if (current.type === "atrule" && /keyframes$/iu.test(current.name)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function validateMotionDeclaration(declaration, errors) {
  const property = declaration.prop.toLowerCase();
  const value = declaration.value.toLowerCase();
  const location = `${MOTION_CSS_PATH}:${String(declaration.source?.start?.line ?? "?")}`;

  if (
    property === "transition" &&
    splitTopLevelCommas(value).some((part) => /^all(?:\s|$)/u.test(part))
  ) {
    errors.push(`${location} must not use transition: all`);
  }
  if (/(?:^|[\s,])ease-in(?:[\s,]|$)/u.test(value)) {
    errors.push(`${location} must not use ease-in`);
  }
  if (/(?:^|[\s,])infinite(?:[\s,]|$)/u.test(value)) {
    errors.push(`${location} must not use infinite motion`);
  }
  if (/scale(?:3d|[xyz])?\(\s*0(?:\.0+)?(?:\s*[,)]|\s*\))/iu.test(value)) {
    errors.push(`${location} must not use scale(0)`);
  }
  if (/\b(?:\d*\.)?\d+(?:ms|s)\b/u.test(value)) {
    errors.push(`${location} must not use a raw motion duration`);
  }

  if (MOTION_TIME_PROPERTY.test(property) && value !== "none") {
    for (const part of splitTopLevelCommas(value)) {
      if (!ALLOWED_DURATION_TOKEN.test(part)) {
        errors.push(
          `${location} motion duration must use an existing hero/layout/control effective token`,
        );
      }
    }
  }

  if (property === "transition" && value !== "none") {
    for (const part of splitTopLevelCommas(value)) {
      const animatedProperty = part.split(/\s+/u)[0];
      if (!ANIMATABLE_COMPOSITE_PROPERTIES.has(animatedProperty)) {
        errors.push(
          `${location} must not transition layout property ${animatedProperty}`,
        );
      }
    }
  }
  if (property === "transition-property") {
    for (const animatedProperty of splitTopLevelCommas(value)) {
      if (!ANIMATABLE_COMPOSITE_PROPERTIES.has(animatedProperty)) {
        errors.push(
          `${location} must not transition layout property ${animatedProperty}`,
        );
      }
    }
  }
  if (
    insideKeyframes(declaration) &&
    !ANIMATABLE_COMPOSITE_PROPERTIES.has(property)
  ) {
    errors.push(
      `${location} keyframes must not animate layout property ${property}`,
    );
  }
}

function validateReducedMotion(root, errors) {
  const reducedRules = [];
  root.walkAtRules("media", (atRule) => {
    if (/prefers-reduced-motion\s*:\s*reduce/iu.test(atRule.params)) {
      reducedRules.push(atRule);
    }
  });
  if (reducedRules.length !== 1) {
    errors.push("motion CSS must define exactly one reduced-motion block");
    return;
  }

  const reduced = reducedRules[0];
  const declarations = [];
  reduced.walkDecls((declaration) => declarations.push(declaration));
  const has = (property, value) =>
    declarations.some(
      (declaration) =>
        declaration.prop.toLowerCase() === property &&
        declaration.value.trim().toLowerCase() === value,
    );
  if (!has("animation", "none")) {
    errors.push("reduced-motion animation none is required");
  }
  if (!has("transition", "none")) {
    errors.push("reduced-motion transition none is required");
  }
  if (!has("transform", "none")) {
    errors.push("reduced-motion transform none is required");
  }
  if (!has("opacity", "1")) {
    errors.push("reduced-motion opacity final state is required");
  }

  const reducedSource = reduced.toString();
  for (const component of ["hero", "idol", "add", "success"]) {
    if (!reducedSource.includes(`.fs-motion-${component}`)) {
      errors.push(`reduced-motion block must cover ${component}`);
    }
  }
}

function validateCss(css, errors) {
  if (css === undefined) {
    return;
  }
  let root;
  try {
    root = postcss.parse(css, { from: MOTION_CSS_PATH });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${MOTION_CSS_PATH} must parse as CSS: ${detail}`);
    return;
  }
  root.walkDecls((declaration) =>
    validateMotionDeclaration(declaration, errors),
  );
  validateReducedMotion(root, errors);
}

function validateGlobalImport(css, errors) {
  if (css === undefined) {
    return;
  }
  let root;
  try {
    root = postcss.parse(css, { from: GLOBAL_CSS_PATH });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${GLOBAL_CSS_PATH} must parse as CSS: ${detail}`);
    return;
  }
  const imports = [];
  root.walkAtRules("import", (atRule) => {
    if (atRule.params.includes("@fan-support/ui/motion.css")) {
      imports.push(atRule.params.trim());
    }
  });
  if (
    imports.length !== 1 ||
    !/^["']@fan-support\/ui\/motion\.css["']$/u.test(imports[0] ?? "")
  ) {
    errors.push("storefront globals must import motion.css exactly once");
  }
}

async function collectFiles(directory, errors) {
  const results = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`cannot inspect ${directory}: ${detail}`);
    return results;
  }
  for (const entry of entries) {
    if ([".next", "dist", "node_modules"].includes(entry.name)) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(absolutePath, errors)));
    } else if (entry.isFile()) {
      results.push(absolutePath);
    }
  }
  return results;
}

async function validateRoutes(workspaceRoot, errors) {
  const expectedPaths = new Set(Object.keys(MOTION_ROUTES));
  for (const [relativePath, locale] of Object.entries(MOTION_ROUTES)) {
    const source = await readText(workspaceRoot, relativePath, errors);
    if (source === undefined) {
      errors.push(`missing motion preview route ${locale}`);
      continue;
    }
    if (!source.includes(`<UiMotionSpecimen locale="${locale}" />`)) {
      errors.push(
        `motion preview route ${locale} must bind its canonical locale`,
      );
    }
  }

  const appRoot = path.join(workspaceRoot, "apps/storefront/src/app");
  const files = await collectFiles(appRoot, errors);
  for (const absolutePath of files) {
    const relativePath = path
      .relative(workspaceRoot, absolutePath)
      .split(path.sep)
      .join("/");
    if (
      relativePath.endsWith("/motion/page.tsx") &&
      !expectedPaths.has(relativePath)
    ) {
      errors.push(`unexpected motion preview route ${relativePath}`);
    }
  }
}

async function validateFixture(
  workspaceRoot,
  specimen,
  lab,
  assetReadme,
  errors,
) {
  if (specimen !== undefined) {
    if (
      !/preview only/iu.test(specimen) ||
      !/no payment proof/iu.test(specimen)
    ) {
      errors.push(
        "motion fixture must include a preview-only disclaimer and no payment proof",
      );
    }
    if (!/no commerce authority/iu.test(specimen)) {
      errors.push(
        "motion fixture must explicitly declare no payment authority",
      );
    }
  }
  if (lab !== undefined) {
    if (!lab.includes('data-motion-fixture="true"')) {
      errors.push(
        "motion fixture must be explicitly marked as a preview fixture",
      );
    }
    if (
      /\bfetch\s*\(/u.test(lab) ||
      /["'][^"']*(?:checkout|payment)[^"']*["']/iu.test(lab) ||
      /["']\/api\//u.test(lab)
    ) {
      errors.push("motion fixture must not own payment or checkout authority");
    }

    const mediaSources = [...lab.matchAll(/\bsrc:\s*["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    if (mediaSources.some((source) => /^https?:\/\//iu.test(source))) {
      errors.push("motion fixture must not use remote fixture media");
    }
    const localMotionAsset = mediaSources.find((source) =>
      /^\/ui-motion\/fictional-[^/]+\.(?:avif|png|webp)$/iu.test(source),
    );
    if (localMotionAsset === undefined) {
      errors.push("motion fixture must use a local fictional motion asset");
    } else {
      try {
        await readFile(
          path.join(workspaceRoot, "apps/storefront/public", localMotionAsset),
        );
      } catch {
        errors.push(
          `local fictional motion asset is missing: ${localMotionAsset}`,
        );
      }
    }
  }
  if (
    assetReadme !== undefined &&
    (!/fictional/iu.test(assetReadme) || !/preview-only/iu.test(assetReadme))
  ) {
    errors.push(
      "motion asset provenance must remain fictional and preview-only",
    );
  }
}

async function validateHeavyweightDependencies(workspaceRoot, errors) {
  const manifests = [];
  for (const relativeRoot of ["apps", "packages"]) {
    manifests.push(
      ...(
        await collectFiles(path.join(workspaceRoot, relativeRoot), errors)
      ).filter((file) => path.basename(file) === "package.json"),
    );
  }
  const rootManifest = path.join(workspaceRoot, "package.json");
  try {
    await readFile(rootManifest, "utf8");
    manifests.push(rootManifest);
  } catch {
    // The primary read reports a missing root manifest; avoid a duplicate error here.
  }

  for (const manifestPath of manifests) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      continue;
    }
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const dependency of Object.keys(manifest?.[section] ?? {})) {
        if (HEAVYWEIGHT_MOTION_DEPENDENCIES.has(dependency)) {
          const relativePath = path.relative(workspaceRoot, manifestPath);
          errors.push(
            `heavyweight motion dependency ${dependency} is forbidden in ${relativePath}`,
          );
        }
      }
    }
  }
}

export async function validateUiMotion(workspaceRoot = defaultWorkspaceRoot) {
  const errors = [];
  const [
    manifest,
    serverSource,
    clientSource,
    css,
    globalCss,
    specimen,
    lab,
    assetReadme,
  ] = await Promise.all([
    readJson(workspaceRoot, UI_MANIFEST_PATH, errors),
    readText(workspaceRoot, MOTION_SERVER_PATH, errors),
    readText(workspaceRoot, MOTION_CLIENT_PATH, errors),
    readText(workspaceRoot, MOTION_CSS_PATH, errors),
    readText(workspaceRoot, GLOBAL_CSS_PATH, errors),
    readText(workspaceRoot, SPECIMEN_PATH, errors),
    readText(workspaceRoot, LAB_PATH, errors),
    readText(workspaceRoot, MOTION_ASSET_README_PATH, errors),
  ]);

  validateManifest(manifest, errors);
  validateEntrypoints(serverSource, clientSource, errors);
  for (const [relativePath, label] of Object.entries(FROZEN_ENTRY_PATHS)) {
    const source = await readText(workspaceRoot, relativePath, errors);
    validateFrozenEntry(source, relativePath, label, errors);
  }
  validateCss(css, errors);
  validateGlobalImport(globalCss, errors);
  await validateRoutes(workspaceRoot, errors);
  await validateFixture(workspaceRoot, specimen, lab, assetReadme, errors);
  await validateHeavyweightDependencies(workspaceRoot, errors);
  return errors;
}

export async function validatePersistedUiMotionEvidence(
  workspaceRoot = defaultWorkspaceRoot,
) {
  try {
    const evidence = await validateMotionEvidenceCandidate(
      path.join(workspaceRoot, MOTION_EVIDENCE_PATH),
    );
    const currentFingerprint =
      await collectMotionSourceFingerprint(workspaceRoot);
    return assessCurrentMotionEvidence(evidence, currentFingerprint);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      `persisted P2-05 browser evidence is missing or invalid: ${detail}`,
    ];
  }
}

/** Boundaries are always checked; persisted browser evidence only when required. */
export async function runUiMotionCheck({
  workspaceRoot = defaultWorkspaceRoot,
  requireBrowserEvidence = false,
  validateStructure = validateUiMotion,
  validateEvidence = validatePersistedUiMotionEvidence,
} = {}) {
  const [boundaryErrors, evidenceErrors] = await Promise.all([
    validateStructure(workspaceRoot),
    requireBrowserEvidence ? validateEvidence(workspaceRoot) : [],
  ]);
  return [...boundaryErrors, ...evidenceErrors];
}

async function main() {
  const requireBrowserEvidence = requiresBrowserEvidence();
  const errors = await runUiMotionCheck({ requireBrowserEvidence });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    requireBrowserEvidence
      ? "UI motion boundary check passed."
      : "UI motion boundary check passed (browser evidence not required locally; run pnpm verify:ui-motion:browser for browser acceptance).",
  );
}

if (process.argv[1] === scriptPath) {
  await main();
}
