import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");

const FONT_VERSION = "5.3.0";
const FONT_LICENSE = "OFL-1.1";
const FONT_PACKAGES = Object.freeze({
  "@fontsource-variable/manrope": "https://fontsource.org/fonts/manrope",
  "@fontsource-variable/noto-sans": "https://fontsource.org/fonts/noto-sans",
  "@fontsource-variable/noto-sans-jp":
    "https://fontsource.org/fonts/noto-sans-jp",
  "@fontsource-variable/noto-sans-sc":
    "https://fontsource.org/fonts/noto-sans-sc",
  "@fontsource-variable/noto-sans-thai":
    "https://fontsource.org/fonts/noto-sans-thai",
});
const FONT_COPYRIGHT_NOTICES = Object.freeze({
  "@fontsource-variable/manrope":
    "Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope)",
  "@fontsource-variable/noto-sans":
    "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic) NotoSans-Italic[wdth,wght].ttf: Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)",
  "@fontsource-variable/noto-sans-jp": "Google Inc.",
  "@fontsource-variable/noto-sans-sc": "Google Inc.",
  "@fontsource-variable/noto-sans-thai":
    "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/thai)",
});
const FONT_PROFILES = Object.freeze({
  "japanese.css": ["@fontsource-variable/noto-sans-jp/wght.css"],
  "latin.css": [
    "@fontsource-variable/manrope/wght.css",
    "@fontsource-variable/noto-sans/wght.css",
  ],
  "simplified-chinese.css": ["@fontsource-variable/noto-sans-sc/wght.css"],
  "thai.css": ["@fontsource-variable/noto-sans-thai/wght.css"],
  "vietnamese.css": [
    "@fontsource-variable/manrope/wght.css",
    "@fontsource-variable/noto-sans/wght.css",
  ],
});
const IGNORED_DIRECTORIES = new Set([
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);
const SAFE_NAMED_COLORS = new Set([
  "currentcolor",
  "inherit",
  "initial",
  "none",
  "revert",
  "revert-layer",
  "transparent",
  "unset",
]);
const CSS_NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
  chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet
  deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
  forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green
  greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender
  lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
  lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue
  lightyellow lime limegreen linen magenta maroon mediumaquamarine
  mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange
  orangered orchid palegoldenrod palegreen paleturquoise palevioletred
  papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
  rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna
  silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
  teal thistle tomato turquoise violet wheat white whitesmoke yellow
  yellowgreen`
    .trim()
    .split(/\s+/u),
);
const COLOR_PROPERTIES =
  /(?:^|-)color$|^(?:background(?:-.+)?|border(?:-.+)?|box-shadow|caret-color|column-rule(?:-.+)?|fill|outline(?:-.+)?|stroke|text-decoration(?:-.+)?|text-shadow)$/u;
const DIRECT_COLOR_PROPERTIES = /(?:^|-)color$|^(?:fill|stroke)$/u;
const COLOR_LITERAL =
  /#[\da-f]{3,8}\b|\b(?:color|hsl|hsla|hwb|lab|lch|oklab|oklch|rgb|rgba)\s*\(/giu;
const DESIGN_DIMENSION =
  /(?:^|[^\w-])(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|ch|ex|cap|ic|lh|rlh|cm|mm|q|in|pt|pc)\b/giu;
const DURATION = /(?:^|[^\w-])(-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)\b/giu;
const INLINE_NUMERIC_DIMENSION_PROPERTIES =
  /^(?:block-size|border-(?:block|bottom|inline|left|right|top)?-?width|bottom|column-gap|font-size|gap|height|inline-size|inset(?:-.+)?|left|letter-spacing|margin(?:-.+)?|max-(?:block-size|height|inline-size|width)|min-(?:block-size|height|inline-size|width)|outline-offset|outline-width|padding(?:-.+)?|perspective|right|row-gap|scroll-margin(?:-.+)?|scroll-padding(?:-.+)?|text-indent|top|width|word-spacing)$/u;
const MOTION_TIMING_PROPERTIES =
  /^(?:animation|animation-delay|animation-duration|transition|transition-delay|transition-duration)$/u;
const BASE_MOTION_TOKEN = /var\((--motion-(?:control|fast|hero|layout))\)/u;

async function readText(workspaceRoot, relativePath, errors) {
  try {
    return await readFile(path.join(workspaceRoot, relativePath), "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`missing design foundation file ${relativePath}: ${detail}`);
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${relativePath} must be valid JSON: ${detail}`);
    return undefined;
  }
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function isObjectFreezeCall(node) {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Object" &&
    node.expression.name.text === "freeze"
  );
}

function unwrapTypeWrappers(expression) {
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

function unwrapStaticExpression(expression) {
  const current = unwrapTypeWrappers(expression);
  if (isObjectFreezeCall(current)) {
    return unwrapStaticExpression(current.arguments[0]);
  }
  return current;
}

function objectProperty(objectLiteral, expectedName) {
  return objectLiteral.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === expectedName,
  );
}

function staticStringRecord(expression, label, errors) {
  const objectLiteral = unwrapStaticExpression(expression);
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    errors.push(`${label} must be a static object literal`);
    return undefined;
  }

  const values = new Map();
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      errors.push(`${label} may contain only static string properties`);
      continue;
    }
    const name = propertyName(property.name);
    const value = unwrapStaticExpression(property.initializer);
    if (
      name === undefined ||
      (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value))
    ) {
      errors.push(`${label} may contain only static string properties`);
      continue;
    }
    values.set(name, value.text);
  }
  return values;
}

function parseTokenContract(source, relativePath, errors) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let contractInitializer;

  function visit(node) {
    if (
      contractInitializer === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "DESIGN_TOKEN_CONTRACT"
    ) {
      contractInitializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (contractInitializer === undefined) {
    errors.push(`${relativePath} must export DESIGN_TOKEN_CONTRACT`);
    return undefined;
  }
  const contract = unwrapStaticExpression(contractInitializer);
  if (!ts.isObjectLiteralExpression(contract)) {
    errors.push("DESIGN_TOKEN_CONTRACT must be a static object literal");
    return undefined;
  }

  const schemaVersion = objectProperty(contract, "schemaVersion");
  const schemaValue =
    schemaVersion === undefined
      ? undefined
      : unwrapStaticExpression(schemaVersion.initializer);
  if (
    !schemaValue ||
    !ts.isNumericLiteral(schemaValue) ||
    schemaValue.text !== "1"
  ) {
    errors.push("DESIGN_TOKEN_CONTRACT.schemaVersion must be 1");
  }

  const breakpointsProperty = objectProperty(contract, "breakpoints");
  const runtimeDefaultsProperty = objectProperty(contract, "runtimeDefaults");
  const valuesProperty = objectProperty(contract, "values");
  if (breakpointsProperty === undefined) {
    errors.push("DESIGN_TOKEN_CONTRACT.breakpoints is required");
  }
  if (valuesProperty === undefined) {
    errors.push("DESIGN_TOKEN_CONTRACT.values is required");
  }
  if (runtimeDefaultsProperty === undefined) {
    errors.push("DESIGN_TOKEN_CONTRACT.runtimeDefaults is required");
  }
  if (
    breakpointsProperty === undefined ||
    runtimeDefaultsProperty === undefined ||
    valuesProperty === undefined
  ) {
    return undefined;
  }

  return {
    breakpoints: staticStringRecord(
      breakpointsProperty.initializer,
      "DESIGN_TOKEN_CONTRACT.breakpoints",
      errors,
    ),
    runtimeDefaults: staticStringRecord(
      runtimeDefaultsProperty.initializer,
      "DESIGN_TOKEN_CONTRACT.runtimeDefaults",
      errors,
    ),
    values: staticStringRecord(
      valuesProperty.initializer,
      "DESIGN_TOKEN_CONTRACT.values",
      errors,
    ),
  };
}

function stringPropertyValue(objectLiteral, expectedName) {
  const property = objectProperty(objectLiteral, expectedName);
  if (property === undefined) {
    return undefined;
  }
  const value = unwrapStaticExpression(property.initializer);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined;
}

function parseSupportedLocales(source, relativePath, errors) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let initializer;

  function visit(node) {
    if (
      initializer === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "SUPPORTED_LOCALES"
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (initializer === undefined) {
    errors.push(`${relativePath} must export SUPPORTED_LOCALES`);
    return undefined;
  }
  const array = unwrapStaticExpression(initializer);
  if (!ts.isArrayLiteralExpression(array)) {
    errors.push("SUPPORTED_LOCALES must be a static array literal");
    return undefined;
  }

  const locales = [];
  for (const element of array.elements) {
    const value = unwrapStaticExpression(element);
    if (!ts.isStringLiteral(value)) {
      errors.push("SUPPORTED_LOCALES may contain only static strings");
      continue;
    }
    locales.push(value.text);
  }
  if (new Set(locales).size !== locales.length) {
    errors.push("SUPPORTED_LOCALES must not contain duplicate locales");
  }
  return locales;
}

function importsSupportedLocalesAsValue(sourceFile) {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@fan-support/contracts" ||
      statement.importClause === undefined ||
      statement.importClause.isTypeOnly ||
      statement.importClause.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      return false;
    }
    return statement.importClause.namedBindings.elements.some(
      (element) =>
        !element.isTypeOnly &&
        element.name.text === "SUPPORTED_LOCALES" &&
        (element.propertyName?.text ?? element.name.text) ===
          "SUPPORTED_LOCALES",
    );
  });
}

function isObjectMethodCall(node, methodName) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Object" &&
    node.expression.name.text === methodName
  );
}

function parseCanonicalLocaleFactory(
  sourceFile,
  localeMapInitializer,
  relativePath,
  errors,
) {
  const localeMap = unwrapStaticExpression(localeMapInitializer);
  if (!isObjectMethodCall(localeMap, "fromEntries")) {
    errors.push(
      "FONT_PROFILE_BY_LOCALE must derive from SUPPORTED_LOCALES with Object.fromEntries",
    );
    return undefined;
  }
  if (localeMap.arguments.length !== 1) {
    errors.push(
      "FONT_PROFILE_BY_LOCALE Object.fromEntries must have one input",
    );
    return undefined;
  }

  const mapCall = unwrapStaticExpression(localeMap.arguments[0]);
  if (
    !ts.isCallExpression(mapCall) ||
    !ts.isPropertyAccessExpression(mapCall.expression) ||
    !ts.isIdentifier(mapCall.expression.expression) ||
    mapCall.expression.expression.text !== "SUPPORTED_LOCALES" ||
    mapCall.expression.name.text !== "map" ||
    mapCall.arguments.length !== 1
  ) {
    errors.push(
      "FONT_PROFILE_BY_LOCALE must map the canonical SUPPORTED_LOCALES value",
    );
    return undefined;
  }

  const callback = unwrapStaticExpression(mapCall.arguments[0]);
  if (
    !ts.isArrowFunction(callback) ||
    callback.parameters.length !== 1 ||
    !ts.isIdentifier(callback.parameters[0].name)
  ) {
    errors.push(
      "FONT_PROFILE_BY_LOCALE must use a one-parameter static map callback",
    );
    return undefined;
  }
  const localeParameter = callback.parameters[0].name.text;
  const tuple = unwrapStaticExpression(callback.body);
  if (!ts.isArrayLiteralExpression(tuple) || tuple.elements.length !== 2) {
    errors.push(
      "FONT_PROFILE_BY_LOCALE callback must return [locale, resolver(locale)]",
    );
    return undefined;
  }

  const localeKey = unwrapStaticExpression(tuple.elements[0]);
  const resolverCall = unwrapStaticExpression(tuple.elements[1]);
  if (
    !ts.isIdentifier(localeKey) ||
    localeKey.text !== localeParameter ||
    !ts.isCallExpression(resolverCall) ||
    !ts.isIdentifier(resolverCall.expression) ||
    resolverCall.arguments.length !== 1 ||
    !ts.isIdentifier(resolverCall.arguments[0]) ||
    resolverCall.arguments[0].text !== localeParameter
  ) {
    errors.push(
      "FONT_PROFILE_BY_LOCALE callback must pass each canonical locale unchanged to its resolver",
    );
    return undefined;
  }

  const resolverName = resolverCall.expression.text;
  const resolver = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === resolverName,
  );
  if (
    resolver === undefined ||
    !ts.isFunctionDeclaration(resolver) ||
    resolver.body === undefined ||
    resolver.parameters.length !== 1 ||
    !ts.isIdentifier(resolver.parameters[0].name) ||
    resolver.body.statements.length !== 1 ||
    !ts.isSwitchStatement(resolver.body.statements[0])
  ) {
    errors.push(
      `${relativePath} must define ${resolverName} as one exhaustive locale switch`,
    );
    return undefined;
  }

  const resolverParameter = resolver.parameters[0].name.text;
  const switchStatement = resolver.body.statements[0];
  if (
    !ts.isIdentifier(switchStatement.expression) ||
    switchStatement.expression.text !== resolverParameter
  ) {
    errors.push(`${resolverName} must switch directly on its locale parameter`);
    return undefined;
  }

  const profileReferences = new Map();
  const pendingLocales = [];
  let hasExhaustiveDefault = false;
  for (const clause of switchStatement.caseBlock.clauses) {
    if (ts.isCaseClause(clause)) {
      const locale = unwrapStaticExpression(clause.expression);
      if (!ts.isStringLiteral(locale)) {
        errors.push(`${resolverName} may contain only static locale cases`);
        continue;
      }
      pendingLocales.push(locale.text);
      if (clause.statements.length === 0) {
        continue;
      }
      if (
        clause.statements.length !== 1 ||
        !ts.isReturnStatement(clause.statements[0]) ||
        clause.statements[0].expression === undefined
      ) {
        errors.push(
          `${resolverName} locale cases must return a static font profile`,
        );
        pendingLocales.length = 0;
        continue;
      }
      const profileReference = unwrapStaticExpression(
        clause.statements[0].expression,
      );
      if (!ts.isIdentifier(profileReference)) {
        errors.push(
          `${resolverName} locale cases must return a static font profile`,
        );
        pendingLocales.length = 0;
        continue;
      }
      for (const pendingLocale of pendingLocales) {
        if (profileReferences.has(pendingLocale)) {
          errors.push(
            `${resolverName} duplicates locale case ${pendingLocale}`,
          );
        }
        profileReferences.set(pendingLocale, profileReference.text);
      }
      pendingLocales.length = 0;
      continue;
    }

    let guardName;
    let returnsGuard = false;
    function inspectDefault(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.type?.kind === ts.SyntaxKind.NeverKeyword &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.initializer) &&
        node.initializer.text === resolverParameter
      ) {
        guardName = node.name.text;
      }
      if (
        guardName !== undefined &&
        ts.isReturnStatement(node) &&
        node.expression !== undefined &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === guardName
      ) {
        returnsGuard = true;
      }
      ts.forEachChild(node, inspectDefault);
    }
    inspectDefault(clause);
    hasExhaustiveDefault = guardName !== undefined && returnsGuard;
  }

  if (pendingLocales.length > 0) {
    errors.push(
      `${resolverName} locale cases must return a static font profile`,
    );
  }
  if (!hasExhaustiveDefault) {
    errors.push(
      `${resolverName} must use a never guard instead of a default font fallback`,
    );
  }
  return profileReferences;
}

function parseFontProfileContract(
  source,
  relativePath,
  supportedLocales,
  errors,
) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const profiles = new Map();
  let localeMapInitializer;
  let localeMapDeclarationCount = 0;

  if (!importsSupportedLocalesAsValue(sourceFile)) {
    errors.push(
      `${relativePath} must value-import SUPPORTED_LOCALES from @fan-support/contracts`,
    );
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isConst =
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined
      ) {
        continue;
      }
      if (declaration.name.text === "FONT_PROFILE_BY_LOCALE") {
        localeMapDeclarationCount += 1;
        localeMapInitializer = declaration.initializer;
        if (!isConst || !isExported) {
          errors.push("FONT_PROFILE_BY_LOCALE must be an exported const");
        }
        continue;
      }

      const value = unwrapStaticExpression(declaration.initializer);
      if (!ts.isObjectLiteralExpression(value)) {
        continue;
      }
      const cssModule = stringPropertyValue(value, "cssModule");
      const id = stringPropertyValue(value, "id");
      if (cssModule === undefined || id === undefined) {
        continue;
      }
      if (
        !isConst ||
        !isObjectFreezeCall(unwrapTypeWrappers(declaration.initializer))
      ) {
        errors.push(
          `font profile ${declaration.name.text} must be a frozen const`,
        );
      }
      if (profiles.has(declaration.name.text)) {
        errors.push(
          `duplicate top-level font profile ${declaration.name.text}`,
        );
      }
      profiles.set(declaration.name.text, { cssModule, id });
    }
  }

  if (localeMapInitializer === undefined) {
    errors.push(`${relativePath} must export FONT_PROFILE_BY_LOCALE`);
    return undefined;
  }
  if (localeMapDeclarationCount !== 1) {
    errors.push("FONT_PROFILE_BY_LOCALE must have one top-level declaration");
  }
  if (!isObjectFreezeCall(unwrapTypeWrappers(localeMapInitializer))) {
    errors.push("FONT_PROFILE_BY_LOCALE must freeze its derived map");
  }
  const profileReferences = parseCanonicalLocaleFactory(
    sourceFile,
    localeMapInitializer,
    relativePath,
    errors,
  );
  if (profileReferences === undefined || supportedLocales === undefined) {
    return undefined;
  }
  const byLocale = new Map();
  const canonicalLocaleSet = new Set(supportedLocales);
  for (const locale of profileReferences.keys()) {
    if (!canonicalLocaleSet.has(locale)) {
      errors.push(
        `font profile resolver contains non-canonical locale ${locale}`,
      );
    }
  }
  for (const locale of supportedLocales) {
    const profileReference = profileReferences.get(locale);
    if (profileReference === undefined) {
      errors.push(
        `font profile resolver is missing canonical locale ${locale}`,
      );
      continue;
    }
    const profile = profiles.get(profileReference);
    if (profile === undefined) {
      errors.push(
        `font profile resolver references non-static profile ${profileReference}`,
      );
      continue;
    }
    byLocale.set(locale, profile);
  }
  return byLocale;
}

function packageFontImports(source, relativePath) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier)
    .filter(ts.isStringLiteral)
    .map((specifier) => specifier.text)
    .filter((specifier) =>
      specifier.startsWith("@fan-support/design-tokens/fonts/"),
    );
}

async function validateStorefrontFontRoutes(
  workspaceRoot,
  fontProfilesByLocale,
  errors,
) {
  if (fontProfilesByLocale === undefined) {
    return;
  }
  const routeRoot = "apps/storefront/src/app/%5Finternal/design-foundations";
  const uniqueProfiles = new Map();
  const expectedLayoutPaths = new Set();
  for (const profile of fontProfilesByLocale.values()) {
    uniqueProfiles.set(profile.id, profile);
  }

  for (const profile of uniqueProfiles.values()) {
    const layoutPath = `${routeRoot}/(${profile.id})/layout.tsx`;
    expectedLayoutPaths.add(layoutPath);
    const layout = await readText(workspaceRoot, layoutPath, errors);
    if (layout === undefined) {
      continue;
    }
    const imports = packageFontImports(layout, layoutPath);
    if (imports.length !== 1 || imports[0] !== profile.cssModule) {
      errors.push(
        `${layoutPath} must import only ${profile.cssModule} for its locale profile`,
      );
    }
  }

  const latinProfile = uniqueProfiles.get("latin");
  const routeLocales = new Map(fontProfilesByLocale);
  if (latinProfile !== undefined) {
    routeLocales.set("en-XA", latinProfile);
  }
  for (const [locale, profile] of routeLocales) {
    const pagePath = `${routeRoot}/(${profile.id})/${locale}/page.tsx`;
    const page = await readText(workspaceRoot, pagePath, errors);
    if (page !== undefined && !page.includes(`locale="${locale}"`)) {
      errors.push(
        `${pagePath} must render the ${locale} specimen inside the ${profile.id} font profile`,
      );
    }
  }

  const storefrontSourceRoot = path.join(workspaceRoot, "apps/storefront/src");
  const importCandidates = [
    ...(await walkCssFiles(storefrontSourceRoot)),
    ...(await walkConsumerSourceFiles(storefrontSourceRoot)),
  ];
  for (const absolutePath of importCandidates) {
    const relativePath = path.relative(workspaceRoot, absolutePath);
    if (expectedLayoutPaths.has(relativePath)) {
      continue;
    }
    const source = await readFile(absolutePath, "utf8");
    const imports = absolutePath.endsWith(".css")
      ? cssImports(source).filter((specifier) =>
          specifier.startsWith("@fan-support/design-tokens/fonts/"),
        )
      : packageFontImports(source, relativePath);
    if (imports.length > 0) {
      errors.push(
        `${relativePath} must not import locale fonts outside the matching route-group layout`,
      );
    }
  }
}

function cssCustomProperties(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const declarations = new Map();
  const declarationPattern = /(--[\w-]+)\s*:\s*([^;{}]+);/gu;
  for (const match of withoutComments.matchAll(declarationPattern)) {
    const [, name, rawValue] = match;
    const values = declarations.get(name) ?? [];
    values.push(rawValue.trim().replace(/\s+/gu, " "));
    declarations.set(name, values);
  }
  return declarations;
}

function cssRuleBlock(css, headerPattern) {
  const header = headerPattern.exec(css);
  if (header?.index === undefined) {
    return undefined;
  }
  const openingBrace = css.indexOf("{", header.index + header[0].length);
  if (openingBrace < 0) {
    return undefined;
  }

  let depth = 1;
  for (let index = openingBrace + 1; index < css.length; index += 1) {
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

function validateTokenCss(contract, css, errors) {
  if (!contract?.values || !contract.runtimeDefaults || !contract.breakpoints) {
    return;
  }
  const declarations = cssCustomProperties(css);

  for (const [name, expectedValue] of contract.values) {
    const actualValues = declarations.get(name);
    if (actualValues === undefined) {
      errors.push(`foundations.css is missing contract token ${name}`);
      continue;
    }
    for (const actualValue of actualValues) {
      if (actualValue !== expectedValue) {
        errors.push(
          `foundations.css token ${name} expected ${expectedValue}, found ${actualValue}`,
        );
      }
    }
  }

  for (const [name, expectedValue] of contract.runtimeDefaults) {
    const actualValues = declarations.get(name);
    if (actualValues === undefined) {
      errors.push(`foundations.css is missing runtime token ${name}`);
      continue;
    }
    if (!actualValues.includes(expectedValue)) {
      errors.push(
        `foundations.css runtime token ${name} must include default ${expectedValue}`,
      );
    }
  }

  for (const name of declarations.keys()) {
    if (!contract.values.has(name) && !contract.runtimeDefaults.has(name)) {
      errors.push(
        `foundations.css token ${name} is not declared in the contract`,
      );
    }
  }

  for (const [name, value] of contract.breakpoints) {
    if (!css.includes(`@media (min-width: ${value})`)) {
      errors.push(
        `foundations.css breakpoint ${name} must match contract value ${value}`,
      );
    }
  }

  const reducedMotionBlock = cssRuleBlock(
    css,
    /@media\s*\(prefers-reduced-motion\s*:\s*reduce\s*\)/iu,
  );
  const reducedMotionDeclarations =
    reducedMotionBlock === undefined
      ? new Map()
      : cssCustomProperties(reducedMotionBlock);
  for (const name of contract.runtimeDefaults.keys()) {
    if (!/^--motion-.+-effective$/u.test(name)) {
      continue;
    }
    if (
      !reducedMotionDeclarations.get(name)?.includes("var(--motion-reduced)")
    ) {
      errors.push(
        `foundations.css reduced-motion state must set ${name} to var(--motion-reduced)`,
      );
    }
  }
}

function cssImports(css) {
  return [
    ...css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/gu),
  ].map((match) => match[1]);
}

function containsRemoteUrl(css) {
  return /\b(?:https?:)?\/\//iu.test(css);
}

async function validateFontPackage(
  workspaceRoot,
  designManifest,
  packageName,
  homepage,
  copyrightNotice,
  notice,
  errors,
) {
  const dependencyVersion = designManifest?.dependencies?.[packageName];
  if (dependencyVersion !== FONT_VERSION) {
    errors.push(
      `packages/design-tokens/package.json must pin ${packageName} to ${FONT_VERSION}`,
    );
  }

  const packageDirectory = path.join(
    "packages/design-tokens/node_modules",
    packageName,
  );
  const packageManifest = await readJson(
    workspaceRoot,
    path.join(packageDirectory, "package.json"),
    errors,
  );
  if (
    packageManifest?.name !== packageName ||
    packageManifest?.version !== FONT_VERSION ||
    packageManifest?.license !== FONT_LICENSE
  ) {
    errors.push(
      `${packageDirectory}/package.json must identify ${packageName} ${FONT_VERSION} under ${FONT_LICENSE}`,
    );
  }
  if (packageManifest?.homepage !== homepage) {
    errors.push(
      `${packageDirectory}/package.json must retain source ${homepage}`,
    );
  }

  const licensePath = path.join(packageDirectory, "LICENSE");
  const license = await readText(workspaceRoot, licensePath, errors);
  if (
    license !== undefined &&
    !/SIL OPEN FONT LICENSE Version 1\.1/iu.test(license)
  ) {
    errors.push(`${licensePath} must contain the SIL OFL 1.1 license text`);
  }
  if (license !== undefined && !license.startsWith(copyrightNotice)) {
    errors.push(
      `${licensePath} must retain the upstream copyright notice ${copyrightNotice}`,
    );
  }
  if (notice !== undefined && !notice.includes(copyrightNotice)) {
    errors.push(
      `packages/design-tokens/THIRD_PARTY_NOTICES.md must retain copyright notice ${copyrightNotice}`,
    );
  }
  if (license !== undefined && notice !== undefined) {
    const licenseBodyStart = license.indexOf(
      "SIL OPEN FONT LICENSE Version 1.1",
    );
    const licenseBody = license.slice(licenseBodyStart).trim();
    if (licenseBodyStart < 0 || !notice.includes(licenseBody)) {
      errors.push(
        "packages/design-tokens/THIRD_PARTY_NOTICES.md must contain the complete SIL OFL 1.1 license text",
      );
    }
  }

  const dependencyCssPath = path.join(packageDirectory, "wght.css");
  const dependencyCss = await readText(
    workspaceRoot,
    dependencyCssPath,
    errors,
  );
  if (dependencyCss !== undefined && containsRemoteUrl(dependencyCss)) {
    errors.push(`${dependencyCssPath} must not contain a remote URL`);
  }

  const expectedNoticeRow = `${packageName} | ${FONT_VERSION} | ${FONT_LICENSE} | ${homepage}`;
  if (notice !== undefined && !notice.includes(expectedNoticeRow)) {
    errors.push(
      `packages/design-tokens/THIRD_PARTY_NOTICES.md must list ${expectedNoticeRow}`,
    );
  }
}

async function validateFonts(workspaceRoot, designManifest, errors) {
  const notice = await readText(
    workspaceRoot,
    "packages/design-tokens/THIRD_PARTY_NOTICES.md",
    errors,
  );

  await Promise.all(
    Object.entries(FONT_PACKAGES).map(([packageName, homepage]) =>
      validateFontPackage(
        workspaceRoot,
        designManifest,
        packageName,
        homepage,
        FONT_COPYRIGHT_NOTICES[packageName],
        notice,
        errors,
      ),
    ),
  );

  for (const [fileName, expectedImports] of Object.entries(FONT_PROFILES)) {
    const relativePath = `packages/design-tokens/styles/fonts/${fileName}`;
    const css = await readText(workspaceRoot, relativePath, errors);
    if (css === undefined) {
      continue;
    }
    if (containsRemoteUrl(css)) {
      errors.push(`${relativePath} must not contain a remote URL`);
    }
    const actualImports = cssImports(css).sort();
    const sortedExpected = [...expectedImports].sort();
    if (JSON.stringify(actualImports) !== JSON.stringify(sortedExpected)) {
      errors.push(
        `${relativePath} profile imports must be exactly ${sortedExpected.join(", ")}`,
      );
    }
    const expectedExport = `./styles/fonts/${fileName}`;
    if (designManifest?.exports?.[`./fonts/${fileName}`] !== expectedExport) {
      errors.push(
        `packages/design-tokens/package.json must export ./fonts/${fileName} as ${expectedExport}`,
      );
    }
  }
}

function dockerStage(dockerfile, stageName) {
  const stages = [
    ...dockerfile.matchAll(/^FROM[^\n]+\s+AS\s+([^\s]+)[^\n]*$/gimu),
  ];
  const index = stages.findIndex(
    (match) => match[1]?.toLowerCase() === stageName,
  );
  if (index < 0) {
    return undefined;
  }
  const start = stages[index].index;
  const end = stages[index + 1]?.index ?? dockerfile.length;
  return dockerfile.slice(start, end);
}

async function validateFontNoticeDistribution(workspaceRoot, errors) {
  const dockerfile = await readText(
    workspaceRoot,
    "infra/docker/Dockerfile",
    errors,
  );
  if (dockerfile === undefined) {
    return;
  }

  for (const stageName of ["storefront", "admin"]) {
    const stage = dockerStage(dockerfile, stageName);
    if (
      stage === undefined ||
      !stage.includes(
        "/workspace/packages/design-tokens/THIRD_PARTY_NOTICES.md",
      ) ||
      !stage.includes("/app/THIRD_PARTY_NOTICES.md")
    ) {
      errors.push(
        `infra/docker/Dockerfile ${stageName} stage must copy THIRD_PARTY_NOTICES.md into /app`,
      );
    }
  }
}

async function walkCssFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkCssFiles(absolutePath)));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function walkConsumerSourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkConsumerSourceFiles(absolutePath)));
    } else if (
      entry.isFile() &&
      /\.[cm]?[jt]sx?$/u.test(entry.name) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
    ) {
      files.push(absolutePath);
    }
  }
  return files;
}

function cssDeclarations(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  return [...withoutComments.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/gu)].map(
    (match) => ({
      index: match.index,
      property: match[1].toLowerCase(),
      value: match[2].trim(),
    }),
  );
}

function valueWithoutAssetReferences(value) {
  return value
    .replace(
      /url\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)])*\s*\)/giu,
      "",
    )
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, "");
}

function valueWithoutVariableNames(value) {
  return value.replace(/var\(\s*--[\w-]+/giu, "var(");
}

function firstNonZeroMatch(pattern, value) {
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    if (Number(match[1]) !== 0) {
      return match[0].trim();
    }
  }
  return undefined;
}

function firstNamedColor(value) {
  for (const match of value.toLowerCase().matchAll(/\b[a-z]+\b/gu)) {
    if (CSS_NAMED_COLORS.has(match[0])) {
      return match[0];
    }
  }
  return undefined;
}

function validateConsumerValue(relativePath, line, property, rawValue, errors) {
  const value = valueWithoutAssetReferences(rawValue);
  COLOR_LITERAL.lastIndex = 0;
  const colorLiteral = COLOR_LITERAL.exec(value)?.[0];
  if (colorLiteral !== undefined) {
    errors.push(
      `${relativePath}:${line} must use a color token instead of ${colorLiteral}`,
    );
  } else if (COLOR_PROPERTIES.test(property) || property === "class-name") {
    const normalizedValue = valueWithoutVariableNames(value).toLowerCase();
    const namedColor = firstNamedColor(normalizedValue);
    if (
      namedColor !== undefined ||
      (DIRECT_COLOR_PROPERTIES.test(property) &&
        /^[a-z-]+$/u.test(normalizedValue) &&
        !SAFE_NAMED_COLORS.has(normalizedValue))
    ) {
      errors.push(
        `${relativePath}:${line} must use a color token instead of ${namedColor ?? value}`,
      );
    }
  }

  const dimension = firstNonZeroMatch(DESIGN_DIMENSION, value);
  if (dimension !== undefined) {
    errors.push(
      `${relativePath}:${line} must use a design-size token instead of ${dimension}`,
    );
  }

  const duration = firstNonZeroMatch(DURATION, value);
  if (duration !== undefined) {
    errors.push(
      `${relativePath}:${line} must use a duration token instead of ${duration}`,
    );
  }

  if (property === "class-name" || MOTION_TIMING_PROPERTIES.test(property)) {
    const baseMotionToken = BASE_MOTION_TOKEN.exec(value)?.[1];
    if (baseMotionToken !== undefined) {
      errors.push(
        `${relativePath}:${line} must use an effective motion token instead of ${baseMotionToken}`,
      );
    }
  }

  if (property === "z-index" && /^-?\d+$/u.test(value) && Number(value) !== 0) {
    errors.push(
      `${relativePath}:${line} must use a z-index token instead of ${value}`,
    );
  }
}

function validateConsumerCssText(
  relativePath,
  css,
  allowedBreakpoints,
  errors,
) {
  const mediaWidthPatterns = [
    /@media\s*\(\s*(?:min|max)-width\s*:\s*([^)]+)\)/giu,
    /@media\s*\(\s*width\s*(?:>=|>)\s*([^)]+)\)/giu,
    /@media\s*\(\s*([^\s)]+)\s*(?:<=|<)\s*width\s*\)/giu,
  ];
  for (const match of mediaWidthPatterns.flatMap((pattern) => [
    ...css.matchAll(pattern),
  ])) {
    const breakpoint = match[1].trim().replace(/\s+/gu, " ");
    if (!allowedBreakpoints.has(breakpoint)) {
      const line = css.slice(0, match.index).split(/\r?\n/u).length;
      errors.push(
        `${relativePath}:${line} media-query breakpoint ${breakpoint} is not declared in DESIGN_TOKEN_CONTRACT.breakpoints`,
      );
    }
  }

  for (const declaration of cssDeclarations(css)) {
    const line = css.slice(0, declaration.index).split(/\r?\n/u).length;
    validateConsumerValue(
      relativePath,
      line,
      declaration.property,
      declaration.value,
      errors,
    );
  }
}

async function consumerCssFiles(workspaceRoot) {
  // This gate intentionally selects stylesheets only. SVG and other image
  // assets may carry intrinsic artwork colors and are outside the token scan.
  const files = [];
  let appEntries = [];
  try {
    appEntries = await readdir(path.join(workspaceRoot, "apps"), {
      withFileTypes: true,
    });
  } catch {
    // The workspace structure gate owns missing app directory diagnostics.
  }
  for (const entry of appEntries) {
    if (entry.isDirectory()) {
      files.push(
        ...(await walkCssFiles(
          path.join(workspaceRoot, "apps", entry.name, "src"),
        )),
      );
    }
  }
  files.push(...(await walkCssFiles(path.join(workspaceRoot, "packages/ui"))));
  return files.sort();
}

async function consumerSourceFiles(workspaceRoot) {
  const files = [];
  let appEntries = [];
  try {
    appEntries = await readdir(path.join(workspaceRoot, "apps"), {
      withFileTypes: true,
    });
  } catch {
    // The workspace structure gate owns missing app directory diagnostics.
  }
  for (const entry of appEntries) {
    if (entry.isDirectory()) {
      files.push(
        ...(await walkConsumerSourceFiles(
          path.join(workspaceRoot, "apps", entry.name, "src"),
        )),
      );
    }
  }
  files.push(
    ...(await walkConsumerSourceFiles(path.join(workspaceRoot, "packages/ui"))),
  );
  return files.sort();
}

function jsxStringValue(initializer) {
  if (initializer === undefined) {
    return undefined;
  }
  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }
  if (ts.isJsxExpression(initializer) && initializer.expression !== undefined) {
    const expression = unwrapStaticExpression(initializer.expression);
    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text;
    }
  }
  return undefined;
}

function cssPropertyNameFromJs(name) {
  return name.startsWith("--")
    ? name
    : name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function validateConsumerSourceText(relativePath, source, errors) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function lineFor(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const match of node.text.matchAll(/\[([^\]]+)\]/gu)) {
        validateConsumerValue(
          relativePath,
          lineFor(node),
          "class-name",
          match[1],
          errors,
        );
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === "className") {
        const className = jsxStringValue(node.initializer);
        if (className !== undefined) {
          for (const match of className.matchAll(/\[([^\]]+)\]/gu)) {
            validateConsumerValue(
              relativePath,
              lineFor(node),
              "class-name",
              match[1],
              errors,
            );
          }
        }
      } else if (
        node.name.text === "style" &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression !== undefined
      ) {
        const style = unwrapStaticExpression(node.initializer.expression);
        if (ts.isObjectLiteralExpression(style)) {
          for (const property of style.properties) {
            if (!ts.isPropertyAssignment(property)) {
              continue;
            }
            const name = propertyName(property.name);
            const value = unwrapStaticExpression(property.initializer);
            if (
              name !== undefined &&
              (ts.isStringLiteral(value) ||
                ts.isNoSubstitutionTemplateLiteral(value))
            ) {
              validateConsumerValue(
                relativePath,
                lineFor(property),
                cssPropertyNameFromJs(name),
                value.text,
                errors,
              );
            } else if (
              name !== undefined &&
              ts.isNumericLiteral(value) &&
              Number(value.text) !== 0
            ) {
              const cssName = cssPropertyNameFromJs(name);
              if (
                cssName === "z-index" ||
                INLINE_NUMERIC_DIMENSION_PROPERTIES.test(cssName)
              ) {
                errors.push(
                  `${relativePath}:${lineFor(property)} inline numeric style ${cssName} must use a design token instead of ${value.text}`,
                );
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

async function validateConsumerCss(workspaceRoot, contract, errors) {
  const allowedBreakpoints = new Set(contract?.breakpoints?.values() ?? []);
  for (const absolutePath of await consumerCssFiles(workspaceRoot)) {
    const relativePath = path.relative(workspaceRoot, absolutePath);
    const css = await readFile(absolutePath, "utf8");
    validateConsumerCssText(relativePath, css, allowedBreakpoints, errors);
  }
}

async function validateConsumerSources(workspaceRoot, errors) {
  for (const absolutePath of await consumerSourceFiles(workspaceRoot)) {
    const relativePath = path.relative(workspaceRoot, absolutePath);
    const source = await readFile(absolutePath, "utf8");
    validateConsumerSourceText(relativePath, source, errors);
  }
}

async function validateAppConsumption(workspaceRoot, designManifest, errors) {
  const expectedExport = "./styles/foundations.css";
  if (designManifest?.exports?.["./foundations.css"] !== expectedExport) {
    errors.push(
      `packages/design-tokens/package.json must export ./foundations.css as ${expectedExport}`,
    );
  }

  for (const appName of ["admin", "storefront"]) {
    const manifestPath = `apps/${appName}/package.json`;
    const manifest = await readJson(workspaceRoot, manifestPath, errors);
    if (
      manifest?.dependencies?.["@fan-support/design-tokens"] !== "workspace:*"
    ) {
      errors.push(
        `${manifestPath} must consume @fan-support/design-tokens via workspace:*`,
      );
    }

    const cssFiles = await walkCssFiles(
      path.join(workspaceRoot, "apps", appName, "src"),
    );
    let consumesPackageExport = false;
    for (const cssPath of cssFiles) {
      const css = await readFile(cssPath, "utf8");
      if (
        cssImports(css).includes("@fan-support/design-tokens/foundations.css")
      ) {
        consumesPackageExport = true;
      }
    }
    if (!consumesPackageExport) {
      errors.push(
        `apps/${appName} must import foundations.css through the @fan-support/design-tokens package export`,
      );
    }
  }
}

export async function validateDesignFoundations(
  workspaceRoot = defaultWorkspaceRoot,
) {
  const errors = [];
  const [
    designManifest,
    tokenSource,
    fontProfileSource,
    foundationCss,
    localeSource,
  ] = await Promise.all([
    readJson(workspaceRoot, "packages/design-tokens/package.json", errors),
    readText(workspaceRoot, "packages/design-tokens/src/tokens.ts", errors),
    readText(
      workspaceRoot,
      "packages/design-tokens/src/font-profiles.ts",
      errors,
    ),
    readText(
      workspaceRoot,
      "packages/design-tokens/styles/foundations.css",
      errors,
    ),
    readText(workspaceRoot, "packages/contracts/src/locale.ts", errors),
  ]);

  let contract;
  if (tokenSource !== undefined && foundationCss !== undefined) {
    contract = parseTokenContract(
      tokenSource,
      "packages/design-tokens/src/tokens.ts",
      errors,
    );
    validateTokenCss(contract, foundationCss, errors);
  }
  const supportedLocales =
    localeSource === undefined
      ? undefined
      : parseSupportedLocales(
          localeSource,
          "packages/contracts/src/locale.ts",
          errors,
        );
  const fontProfilesByLocale =
    fontProfileSource === undefined
      ? undefined
      : parseFontProfileContract(
          fontProfileSource,
          "packages/design-tokens/src/font-profiles.ts",
          supportedLocales,
          errors,
        );
  await validateFonts(workspaceRoot, designManifest, errors);
  await validateStorefrontFontRoutes(
    workspaceRoot,
    fontProfilesByLocale,
    errors,
  );
  await validateFontNoticeDistribution(workspaceRoot, errors);
  await validateAppConsumption(workspaceRoot, designManifest, errors);
  await validateConsumerCss(workspaceRoot, contract, errors);
  await validateConsumerSources(workspaceRoot, errors);

  return [...new Set(errors)].sort();
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  const errors = await validateDesignFoundations();
  if (errors.length > 0) {
    console.error("Design foundation validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      "Design foundation validation passed: tokens, local font profiles, licenses, app imports, and consumer CSS are synchronized.",
    );
  }
}
