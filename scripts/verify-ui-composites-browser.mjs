/* global AbortSignal, HTMLImageElement, HTMLElement, URL, document, fetch, getComputedStyle, matchMedia, setTimeout, window */

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assessNativeZoomMeasurements,
  assessPageMetrics,
  createNativeZoomLaunchOptions,
  createNativeZoomProfilePreferences,
  isSafeRelativeArtifactPath,
  observePage,
  readPngDimensions,
  summarizeAxeResult,
} from "./verify-ui-primitives-browser.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const evidenceRelativePath = "output/playwright/p2-04";
const routeSuffix = "/components";
const nativeZoomLocale = "pt";
const nativeZoomPercent = 200;
const nativeZoomScreenshots = Object.freeze({
  baseline: "zoom/google-chrome-baseline-pt.png",
  zoomed: "zoom/google-chrome-200-percent-pt.png",
});
const rerunCommand =
  "mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs";
const sourceFingerprintAlgorithm = "p2-04-render-inputs-v1";
const sourceFingerprintPathspec = Object.freeze([
  ".node-version",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "turbo.json",
  "packages/contracts",
  "packages/config",
  "packages/design-tokens",
  "packages/ui",
  "apps/storefront/next.config.ts",
  "apps/storefront/package.json",
  "apps/storefront/postcss-font-display-optional",
  "apps/storefront/postcss.config.mjs",
  "apps/storefront/tsconfig.build.json",
  "apps/storefront/tsconfig.json",
  "apps/storefront/public/ui-composites",
  "apps/storefront/src/app/globals.css",
  "apps/storefront/src/app/layout.tsx",
  "apps/storefront/src/order-entry.ts",
  "apps/storefront/src/app/ui-composites-*",
  "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(japanese)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(simplified-chinese)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(thai)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(vietnamese)/layout.tsx",
  ":(glob)apps/storefront/src/app/%5Finternal/design-foundations/**/components/page.tsx",
  "apps/storefront/src/design-foundations.ts",
  "apps/storefront/src/instrumentation.ts",
  "apps/storefront/src/internal-presentation-locale.ts",
  "apps/storefront/src/presentation-locale.ts",
  "apps/storefront/src/proxy.ts",
  "apps/storefront/src/server/runtime-config.ts",
  "scripts/check-ui-composites.mjs",
  "scripts/verify-ui-composites-browser.mjs",
  "scripts/verify-ui-primitives-browser.mjs",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const previewLocales = new Set([
  "en",
  "en-XA",
  "es",
  "ja",
  "pt",
  "th",
  "vi",
  "zh-CN",
]);
const requiredAxeScans = Object.freeze([
  "baseline-desktop",
  "baseline-mobile",
  "cart-line",
  "empty-error",
  "image-error",
  "loading",
  "pseudo",
  "reduced-motion",
  "timeline",
  "unavailable",
]);
const requiredAxeScanSet = new Set(requiredAxeScans);
const requiredBaselineCases = Object.freeze([
  Object.freeze([360, 800, "en"]),
  Object.freeze([390, 844, "vi"]),
  Object.freeze([768, 1024, "th"]),
  Object.freeze([1024, 768, "zh-CN"]),
  Object.freeze([1440, 900, "ja"]),
  Object.freeze([1920, 1080, "es"]),
]);
const requiredResponsiveBoundaryCases = Object.freeze([
  Object.freeze([767, 900, "pt"]),
  Object.freeze([1023, 900, "en-XA"]),
]);
const expectedComponentCounts = Object.freeze({
  "cart-line": 5,
  "gift-tile": 5,
  hero: 6,
  "idol-context": 5,
  "idol-portrait": 5,
  "order-timeline": 4,
});
const pseudoRuntimeCopyProof = Object.freeze([
  Object.freeze({ english: "For", pseudo: "[!! Föř ţħë šëļëçţëđ ïđöļ !!]" }),
  Object.freeze({
    english: "Gift image is temporarily unavailable",
    pseudo: "[!! Gïfţ ïɱàğë ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  }),
  Object.freeze({
    english: "Featured performer image is temporarily unavailable",
    pseudo: "[!! Fëàţüřëđ pëřföřɱëř ïɱàğë ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  }),
  Object.freeze({
    english: "Payment confirmed",
    pseudo: "[!! Pàÿɱëñţ ïš çöñfïřɱëđ !!]",
  }),
  Object.freeze({
    english: "Gifts paused",
    pseudo: "[!! Gïfţ řëçëïvïñğ ïš pàüšëđ !!]",
  }),
  Object.freeze({
    english: "Performer portrait is temporarily unavailable",
    pseudo: "[!! Pëřföřɱëř pöřţřàïţ ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  }),
  Object.freeze({
    english: "Preparing your gift",
    pseudo: "[!! Přëpàřïñğ ÿöüř ğïfţ ŵïţħ çàřë !!]",
  }),
  Object.freeze({ english: "Quantity", pseudo: "[!! Gïfţ ǫüàñţïţÿ !!]" }),
  Object.freeze({
    english: "Completed",
    pseudo: "[!! Çöɱpļëţëđ šţàğë !!]",
  }),
  Object.freeze({
    english: "In progress",
    pseudo: "[!! Çüřřëñţļÿ ïñ přöğřëšš !!]",
  }),
  Object.freeze({
    english: "Next",
    pseudo: "[!! Ñëxţ üpçöɱïñğ šţàğë !!]",
  }),
]);

function axeScan(id, include) {
  return Object.freeze(include === undefined ? { id } : { id, include });
}

function scenario(input) {
  return Object.freeze({
    ...input,
    axe: Object.freeze(input.axe ?? []),
    checks: Object.freeze(input.checks ?? []),
    viewport: Object.freeze(input.viewport),
  });
}

const compositeScenarioMatrix = Object.freeze([
  scenario({
    group: "baseline",
    id: "viewport-360x800-en",
    locale: "en",
    screenshot: "viewports/360x800-en.png",
    viewport: { height: 800, width: 360 },
  }),
  scenario({
    axe: [axeScan("baseline-mobile")],
    group: "baseline",
    id: "viewport-390x844-vi",
    locale: "vi",
    screenshot: "viewports/390x844-vi.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    group: "baseline",
    id: "viewport-768x1024-th",
    locale: "th",
    screenshot: "viewports/768x1024-th.png",
    viewport: { height: 1024, width: 768 },
  }),
  scenario({
    group: "baseline",
    id: "viewport-1024x768-zh-cn",
    locale: "zh-CN",
    screenshot: "viewports/1024x768-zh-CN.png",
    viewport: { height: 768, width: 1024 },
  }),
  scenario({
    axe: [axeScan("baseline-desktop")],
    group: "baseline",
    id: "viewport-1440x900-ja",
    locale: "ja",
    screenshot: "viewports/1440x900-ja.png",
    viewport: { height: 900, width: 1440 },
  }),
  scenario({
    group: "baseline",
    id: "viewport-1920x1080-es",
    locale: "es",
    screenshot: "viewports/1920x1080-es.png",
    viewport: { height: 1080, width: 1920 },
  }),
  scenario({
    group: "responsive-boundary",
    id: "responsive-767x900-pt",
    locale: "pt",
    screenshot: "responsive/767x900-pt.png",
    viewport: { height: 900, width: 767 },
  }),
  scenario({
    checks: ["pseudo-copy"],
    group: "responsive-boundary",
    id: "responsive-1023x900-en-xa",
    locale: "en-XA",
    screenshot: "responsive/1023x900-en-XA.png",
    viewport: { height: 900, width: 1023 },
  }),
  scenario({
    axe: [axeScan("pseudo")],
    checks: ["pseudo-copy"],
    fullPage: true,
    group: "stress",
    id: "stress-320x800-en-xa",
    locale: "en-XA",
    screenshot: "stress/320x800-en-XA.png",
    viewport: { height: 800, width: 320 },
  }),
  scenario({
    fullPage: true,
    group: "stress",
    id: "stress-320x800-pt",
    locale: "pt",
    screenshot: "stress/320x800-pt-long.png",
    viewport: { height: 800, width: 320 },
  }),
  scenario({
    axe: [
      axeScan("loading", '[data-render-state="loading"]'),
      axeScan(
        "empty-error",
        '[data-render-state="empty"], [data-render-state="error"]',
      ),
      axeScan("unavailable", '[data-availability="unavailable"]'),
      axeScan("image-error", '[data-media-state="error"]'),
      axeScan("cart-line", '[data-fs-composite="cart-line"]'),
      axeScan("timeline", '[data-fs-composite="order-timeline"]'),
    ],
    checks: ["keyboard", "states", "image-failure", "privacy", "semantics"],
    fullPage: true,
    group: "states",
    id: "states-390x844-en",
    locale: "en",
    screenshot: "states/390x844-en.png",
    touch: true,
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    checks: ["hover"],
    group: "hover",
    id: "hover-1440x900-en",
    locale: "en",
    screenshot: "interactions/1440x900-en-hover.png",
    viewport: { height: 900, width: 1440 },
  }),
  scenario({
    checks: ["rtl"],
    group: "rtl",
    id: "rtl-390x844-en",
    locale: "en",
    screenshot: "rtl/390x844-en.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    checks: ["rtl"],
    group: "rtl",
    id: "rtl-1440x900-en",
    locale: "en",
    screenshot: "rtl/1440x900-en.png",
    viewport: { height: 900, width: 1440 },
  }),
  scenario({
    axe: [axeScan("reduced-motion")],
    group: "reduced-motion",
    id: "reduced-motion-390x844-en",
    locale: "en",
    reducedMotion: true,
    screenshot: "reduced-motion/390x844-en.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    group: "reduced-motion",
    id: "reduced-motion-1440x900-en",
    locale: "en",
    reducedMotion: true,
    screenshot: "reduced-motion/1440x900-en.png",
    viewport: { height: 900, width: 1440 },
  }),
]);

export function createCompositeScenarioMatrix() {
  return compositeScenarioMatrix;
}

function caseKey(width, height, locale) {
  return [width, height, locale].join("x");
}

export function validateCompositeScenarioMatrix(matrix) {
  const errors = [];
  if (!Array.isArray(matrix)) {
    return ["composite browser scenario matrix must be an array"];
  }
  const ids = new Set();
  const screenshots = new Set();
  const axeIds = [];
  for (const entry of matrix) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("every browser scenario must be an object");
      continue;
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9-]+$/u.test(entry.id)) {
      errors.push("every browser scenario needs a stable lowercase id");
    } else if (ids.has(entry.id)) {
      errors.push("duplicate scenario id " + entry.id);
    } else {
      ids.add(entry.id);
    }
    if (!isSafeRelativeArtifactPath(entry.screenshot, ".png")) {
      errors.push(
        "scenario " +
          String(entry.id) +
          " screenshot must be a safe relative PNG path",
      );
    } else if (screenshots.has(entry.screenshot)) {
      errors.push("duplicate screenshot path " + entry.screenshot);
    } else {
      screenshots.add(entry.screenshot);
    }
    if (!previewLocales.has(entry.locale)) {
      errors.push("scenario " + String(entry.id) + " has unsupported locale");
    }
    if (
      !Number.isSafeInteger(entry.viewport?.width) ||
      entry.viewport.width <= 0 ||
      !Number.isSafeInteger(entry.viewport?.height) ||
      entry.viewport.height <= 0
    ) {
      errors.push("scenario " + String(entry.id) + " has an invalid viewport");
    }
    if (!Array.isArray(entry.checks) || !Array.isArray(entry.axe)) {
      errors.push(
        "scenario " + String(entry.id) + " must define checks and axe arrays",
      );
      continue;
    }
    for (const scan of entry.axe) {
      if (
        typeof scan?.id !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(scan.id)
      ) {
        errors.push(
          "scenario " + String(entry.id) + " needs a safe axe scan id",
        );
      } else {
        axeIds.push(scan.id);
        if (!requiredAxeScanSet.has(scan.id)) {
          errors.push(
            "scenario " + entry.id + " has an unapproved axe scan id",
          );
        }
      }
    }
  }
  const expectedBaselines = requiredBaselineCases.map(
    ([width, height, locale]) => caseKey(width, height, locale),
  );
  const actualBaselines = matrix
    .filter((entry) => entry?.group === "baseline")
    .map((entry) =>
      caseKey(entry.viewport?.width, entry.viewport?.height, entry.locale),
    );
  if (!sameSet(actualBaselines, expectedBaselines)) {
    errors.push("matrix must contain all six exact baseline viewport cases");
  }
  const expectedResponsiveBoundaries = requiredResponsiveBoundaryCases.map(
    ([width, height, locale]) => caseKey(width, height, locale),
  );
  const actualResponsiveBoundaries = matrix
    .filter((entry) => entry?.group === "responsive-boundary")
    .map((entry) =>
      caseKey(entry.viewport?.width, entry.viewport?.height, entry.locale),
    );
  if (!sameSet(actualResponsiveBoundaries, expectedResponsiveBoundaries)) {
    errors.push(
      "matrix must contain the exact 767px and 1023px responsive boundary cases",
    );
  }
  for (const locale of ["en-XA", "pt"]) {
    if (
      !matrix.some(
        (entry) =>
          entry?.group === "stress" &&
          entry.locale === locale &&
          entry.viewport?.width === 320,
      )
    ) {
      errors.push("matrix must contain the 320px " + locale + " stress case");
    }
  }
  if (
    !matrix.some(
      (entry) =>
        entry?.locale === "en-XA" && entry.checks?.includes("pseudo-copy"),
    )
  ) {
    errors.push("matrix must verify pseudo-localized runtime copy");
  }
  const states = matrix.find((entry) => entry?.group === "states");
  for (const check of [
    "keyboard",
    "states",
    "image-failure",
    "privacy",
    "semantics",
  ]) {
    if (!states?.checks?.includes(check)) {
      errors.push("state scenario must include " + check);
    }
  }
  if (states?.touch !== true) {
    errors.push("state scenario must run in a touch-capable mobile context");
  }
  if (!matrix.some((entry) => entry?.checks?.includes("hover"))) {
    errors.push("matrix must contain a hover case");
  }
  for (const width of [390, 1440]) {
    if (
      !matrix.some(
        (entry) =>
          entry?.checks?.includes("rtl") && entry.viewport?.width === width,
      )
    ) {
      errors.push("matrix must contain RTL at " + String(width) + "px");
    }
  }
  for (const width of [390, 1440]) {
    if (
      !matrix.some(
        (entry) =>
          entry?.reducedMotion === true && entry.viewport?.width === width,
      )
    ) {
      errors.push(
        "matrix must contain reduced motion at " + String(width) + "px",
      );
    }
  }
  for (const scan of requiredAxeScans) {
    if (axeIds.filter((id) => id === scan).length !== 1) {
      errors.push("matrix must contain one axe scan named " + scan);
    }
  }
  return errors;
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value))
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assessCompositeDiagnosticsEvidence(diagnostics, expectedFixtureUrl) {
  const arrayKeys = [
    "console",
    "externalResources",
    "httpErrors",
    "pageErrors",
    "requestFailures",
    "requests",
  ];
  if (
    !isRecord(diagnostics) ||
    arrayKeys.some((key) => !Array.isArray(diagnostics[key]))
  ) {
    return ["scenario diagnostics must contain all six result arrays"];
  }
  const hasFixtureRequest = diagnostics.requests.some((request) => {
    try {
      return (
        request.resourceType === "document" &&
        new URL(request.url).pathname === expectedFixtureUrl
      );
    } catch {
      return false;
    }
  });
  const requestsAreValid =
    diagnostics.requests.length > 0 &&
    diagnostics.requests.every(
      (request) =>
        request?.allowed === true &&
        typeof request.method === "string" &&
        request.method.length > 0 &&
        typeof request.resourceType === "string" &&
        request.resourceType.length > 0 &&
        typeof request.url === "string" &&
        request.url.length > 0,
    );
  return [
    ...(hasFixtureRequest && requestsAreValid
      ? []
      : ["scenario diagnostics must contain only allowed browser requests"]),
    ...diagnosticsErrors(diagnostics),
  ];
}

function assessCompositeChecksEvidence(checks, expected) {
  if (!isRecord(checks)) {
    return ["scenario checks must be an object"];
  }
  const keyByCheck = new Map([
    ["hover", "hover"],
    ["image-failure", "imageFailures"],
    ["keyboard", "keyboard"],
    ["privacy", "privacy"],
    ["pseudo-copy", "pseudoCopy"],
    ["rtl", "rtl"],
    ["semantics", "semantics"],
    ["states", "states"],
  ]);
  const expectedKeys = expected.checks.map((check) => keyByCheck.get(check));
  if (expected.reducedMotion === true) {
    expectedKeys.push("reducedMotion");
  }
  const errors = [];
  if (
    expectedKeys.some((key) => key === undefined) ||
    !sameSet(Object.keys(checks), expectedKeys)
  ) {
    errors.push("scenario checks do not match the matrix");
  }
  if (expected.checks.includes("keyboard")) {
    if (
      !String(checks.keyboard?.className).includes("fs-hero__action") ||
      checks.keyboard?.outlineStyle === "none" ||
      !(Number.parseFloat(String(checks.keyboard?.outlineWidth)) > 0)
    ) {
      errors.push("scenario checks must prove keyboard focus and activation");
    }
  }
  if (expected.checks.includes("states")) {
    if (
      ["loading", "empty", "error"].some(
        (state) =>
          !Number.isSafeInteger(checks.states?.[state]) ||
          checks.states[state] < 6,
      )
    ) {
      errors.push("scenario checks must prove all async composite states");
    }
  }
  if (expected.checks.includes("image-failure")) {
    const proof = checks.imageFailures;
    if (
      proof?.count !== 5 ||
      proof?.origin !== "runtime error/decode events" ||
      proof?.heroFallback?.overlap !== false ||
      typeof proof?.heroFallback?.text !== "string" ||
      proof.heroFallback.text.length === 0 ||
      cssContrastRatio(
        proof.heroFallback.foreground,
        proof.heroFallback.background,
      ) < 4.5
    ) {
      errors.push("scenario checks must prove real accessible media failures");
    }
  }
  if (
    expected.checks.includes("privacy") &&
    checks.privacy !== "no plaintext sentinel"
  ) {
    errors.push("scenario checks must prove private plaintext is absent");
  }
  if (expected.checks.includes("semantics")) {
    const semantics = checks.semantics;
    if (
      semantics?.selectedCurrentCount !== 1 ||
      semantics?.timelineOrdered !== true ||
      semantics?.quantity?.keyboard?.before !== 2 ||
      semantics.quantity.keyboard.after !== 3 ||
      semantics.quantity.keyboard.subtotalBefore !== "25800" ||
      semantics.quantity.keyboard.subtotalAfter !== "38700" ||
      semantics?.quantity?.touch?.before !== 3 ||
      semantics.quantity.touch.after !== 4 ||
      semantics.quantity.touch.subtotalAfter !== "51600" ||
      semantics?.remove?.semanticTag !== "BUTTON" ||
      semantics.remove.keyboard !== true ||
      semantics.remove.touch !== true
    ) {
      errors.push(
        "scenario checks must prove keyboard and touch CartLine semantics",
      );
    }
  }
  if (
    expected.checks.includes("hover") &&
    (typeof checks.hover?.before !== "string" ||
      typeof checks.hover?.after !== "string" ||
      checks.hover.before === checks.hover.after)
  ) {
    errors.push("scenario checks must prove the hover treatment");
  }
  if (expected.checks.includes("rtl")) {
    if (
      checks.rtl?.direction !== "rtl" ||
      !Number.isFinite(checks.rtl?.clientWidth) ||
      !Number.isFinite(checks.rtl?.scrollWidth) ||
      checks.rtl.scrollWidth > checks.rtl.clientWidth + 0.5 ||
      (expected.viewport.width >= 768 &&
        !String(checks.rtl?.scrimBackground).includes("to left"))
    ) {
      errors.push("scenario checks must prove responsive RTL behavior");
    }
  }
  if (expected.checks.includes("pseudo-copy")) {
    if (
      checks.pseudoCopy?.expected !== pseudoRuntimeCopyProof.length ||
      checks.pseudoCopy?.present !== pseudoRuntimeCopyProof.length ||
      !Array.isArray(checks.pseudoCopy?.englishLeaks) ||
      checks.pseudoCopy.englishLeaks.length !== 0
    ) {
      errors.push("scenario checks must prove complete pseudo-localized copy");
    }
  }
  if (
    expected.reducedMotion === true &&
    assessReducedMotion(checks.reducedMotion).length > 0
  ) {
    errors.push("scenario checks must prove reduced motion behavior");
  }
  return errors;
}

function assessCompositeScenarioEvidence(result, expected) {
  const expectedFixtureUrl = fixturePath(expected.locale);
  const errors = [];
  if (
    result?.group !== expected.group ||
    result?.locale !== expected.locale ||
    result?.fixtureUrl !== expectedFixtureUrl ||
    result?.reducedMotion !== (expected.reducedMotion === true) ||
    result?.touch !== (expected.touch === true) ||
    JSON.stringify(result?.viewport) !== JSON.stringify(expected.viewport)
  ) {
    errors.push("scenario metadata does not match the matrix");
  }
  const base = result?.metrics?.base;
  const documentMetrics = base?.document;
  if (
    !isRecord(result?.metrics) ||
    !isRecord(base) ||
    !Array.isArray(base.clippedText) ||
    !Array.isArray(base.controls) ||
    base.controls.length === 0 ||
    base.controls.some(
      (control) =>
        !Number.isFinite(control?.width) ||
        !Number.isFinite(control?.height) ||
        typeof control?.label !== "string",
    ) ||
    base.fontsStatus !== "loaded" ||
    base.replacementGlyphs !== 0 ||
    !isRecord(documentMetrics) ||
    !Array.isArray(result.metrics.ratios) ||
    !Number.isFinite(documentMetrics.clientWidth) ||
    !Number.isFinite(documentMetrics.scrollWidth) ||
    !Number.isFinite(documentMetrics.bodyScrollWidth) ||
    Math.abs(documentMetrics.clientWidth - expected.viewport.width) > 0.5
  ) {
    errors.push("scenario metrics are incomplete or use the wrong viewport");
  } else {
    const expectedHeroRatio = expected.viewport.width < 768 ? 4 / 5 : 16 / 9;
    const expectedRatios = new Map([
      ["hero", expectedHeroRatio],
      ["portrait", 4 / 5],
      ["gift", 1],
      ["hero failure", expectedHeroRatio],
    ]);
    if (
      result.metrics.ratios.length !== expectedRatios.size ||
      !sameSet(
        result.metrics.ratios.map((ratio) => ratio?.label),
        [...expectedRatios.keys()],
      ) ||
      result.metrics.ratios.some(
        (ratio) =>
          !expectedRatios.has(ratio?.label) ||
          !Number.isFinite(ratio?.expected) ||
          Math.abs(expectedRatios.get(ratio.label) - ratio?.expected) > 0.0001,
      )
    ) {
      errors.push(
        "scenario metrics must contain all four expected media ratios",
      );
    }
    const expectedHeroSource =
      expected.viewport.width < 768 ? "hero-mobile.png" : "hero-desktop.png";
    if (!String(result.metrics.heroCurrentSrc).endsWith(expectedHeroSource)) {
      errors.push("scenario metrics must prove responsive Hero art direction");
    }
    errors.push(...assessCompositeMetrics(result.metrics));
  }
  errors.push(
    ...assessCompositeDiagnosticsEvidence(
      result?.diagnostics,
      expectedFixtureUrl,
    ),
    ...assessCompositeChecksEvidence(result?.checks, expected),
  );
  return errors;
}

export function assessCompositeEvidenceShape(results) {
  const errors = [];
  if (
    !isRecord(results) ||
    results.schemaVersion !== 1 ||
    results.result !== "passed" ||
    !Array.isArray(results.matrix) ||
    !Array.isArray(results.scenarioResults) ||
    !Array.isArray(results.axeSummaries) ||
    !Array.isArray(results.runtimeGates) ||
    !Array.isArray(results.screenshots)
  ) {
    return ["P2-04 browser evidence is incomplete"];
  }

  const expectedMatrix = createCompositeScenarioMatrix();
  if (JSON.stringify(results.matrix) !== JSON.stringify(expectedMatrix)) {
    errors.push(
      "browser evidence must contain the exact P2-04 scenario matrix",
    );
  }
  const expectedScenarioById = new Map(
    expectedMatrix.map((entry) => [entry.id, entry]),
  );
  for (const scenarioResult of results.scenarioResults) {
    const expected = expectedScenarioById.get(scenarioResult?.id);
    if (expected === undefined) {
      continue;
    }
    const scenarioErrors = assessCompositeScenarioEvidence(
      scenarioResult,
      expected,
    );
    if (scenarioErrors.length > 0) {
      errors.push(
        `browser scenario evidence is invalid for ${scenarioResult.id}: ${scenarioErrors.join("; ")}`,
      );
    }
  }

  const scenarioIds = results.scenarioResults.map((entry) => entry?.id);
  if (
    results.scenarioResults.length !== expectedMatrix.length ||
    !sameSet(scenarioIds, [...expectedScenarioById.keys()]) ||
    results.scenarioResults.some((entry) => {
      const expected = expectedScenarioById.get(entry?.id);
      return (
        expected === undefined ||
        entry.screenshot !== expected.screenshot ||
        !Array.isArray(entry.errors) ||
        entry.errors.length !== 0
      );
    })
  ) {
    errors.push(
      `browser evidence must contain ${expectedMatrix.length} successful P2-04 scenarios`,
    );
  }

  const expectedAxeById = new Map(
    expectedMatrix.flatMap((entry) =>
      entry.axe.map((scan) => [scan.id, entry.id]),
    ),
  );
  const axeIds = results.axeSummaries.map((summary) => summary?.id);
  if (
    results.axeSummaries.length !== requiredAxeScans.length ||
    !sameSet(axeIds, requiredAxeScans) ||
    results.axeSummaries.some(
      (summary) =>
        expectedAxeById.get(summary?.id) !== summary?.scenarioId ||
        summary?.artifact !== `axe-results/${String(summary?.id)}.json` ||
        !Array.isArray(summary?.blocking) ||
        summary.blocking.length !== 0,
    )
  ) {
    errors.push("browser evidence must contain 10 clean P2-04 axe scans");
  }

  const expectedRuntime = new Map([
    ["preview", 200],
    ["staging", 404],
    ["production", 404],
  ]);
  const runtimeEnvironments = results.runtimeGates.map(
    (gate) => gate?.environment,
  );
  if (
    results.runtimeGates.length !== expectedRuntime.size ||
    !sameSet(runtimeEnvironments, [...expectedRuntime.keys()]) ||
    results.runtimeGates.some((gate) => {
      const expectedStatus = expectedRuntime.get(gate?.environment);
      return (
        expectedStatus === undefined ||
        gate.healthStatus !== 200 ||
        !Array.isArray(gate.localeStatuses) ||
        gate.localeStatuses.length !== previewLocales.size ||
        gate.localeStatuses.some((status) => status !== expectedStatus)
      );
    })
  ) {
    errors.push("browser evidence must contain all three runtime route gates");
  }

  const expectedScreenshotPaths = [
    ...expectedMatrix.map((entry) => entry.screenshot),
    nativeZoomScreenshots.baseline,
    nativeZoomScreenshots.zoomed,
  ];
  const screenshotPaths = results.screenshots.map(
    (screenshot) => screenshot?.path,
  );
  if (!sameSet(screenshotPaths, expectedScreenshotPaths)) {
    errors.push(
      `browser evidence must contain the exact ${expectedScreenshotPaths.length} screenshots`,
    );
  }

  const nativeScreenshotPaths = results.nativeZoom?.screenshots?.map(
    (screenshot) => screenshot?.path,
  );
  if (
    !isRecord(results.nativeZoom) ||
    results.nativeZoom.zoomPercent !== nativeZoomPercent ||
    !Number.isFinite(results.nativeZoom.detectedPercent) ||
    Math.abs(results.nativeZoom.detectedPercent - nativeZoomPercent) > 0.5 ||
    results.nativeZoom.profileRemoved !== true ||
    !Array.isArray(nativeScreenshotPaths) ||
    !sameSet(nativeScreenshotPaths, Object.values(nativeZoomScreenshots))
  ) {
    errors.push("browser evidence must contain the native Chrome 200% proof");
  }

  const fingerprintPattern = /^[a-f0-9]{64}$/u;
  const fingerprintFilesAreValid = (files) =>
    Array.isArray(files) &&
    files.length > 0 &&
    files.every(
      (file, index) =>
        isRecord(file) &&
        typeof file.path === "string" &&
        file.path.length > 0 &&
        !path.posix.isAbsolute(file.path) &&
        !file.path.startsWith("../") &&
        (index === 0 || files[index - 1].path < file.path) &&
        fingerprintPattern.test(file.sha256 ?? ""),
    );
  const beforeAlgorithm = results.git?.before?.sourceFingerprintAlgorithm;
  const beforeFiles = results.git?.before?.sourceFingerprintFiles;
  const beforeFingerprint = results.git?.before?.sourceFingerprint;
  if (
    !isRecord(results.git) ||
    !isRecord(results.git.before) ||
    !isRecord(results.git.after) ||
    beforeAlgorithm !== sourceFingerprintAlgorithm ||
    results.git.after.sourceFingerprintAlgorithm !== beforeAlgorithm ||
    !fingerprintFilesAreValid(beforeFiles) ||
    JSON.stringify(results.git.after.sourceFingerprintFiles) !==
      JSON.stringify(beforeFiles) ||
    !fingerprintPattern.test(beforeFingerprint ?? "") ||
    beforeFingerprint !==
      sha256(
        JSON.stringify({ algorithm: beforeAlgorithm, files: beforeFiles }),
      ) ||
    beforeFingerprint !== results.git.after.sourceFingerprint ||
    results.git.before.sha !== results.git.after.sha
  ) {
    errors.push(
      "browser evidence source fingerprint must match before and after capture",
    );
  }

  return errors;
}

export function assessCurrentCompositeEvidence(results, currentFingerprint) {
  const after = results?.git?.after;
  if (
    !isRecord(after) ||
    after.sourceFingerprintAlgorithm !== sourceFingerprintAlgorithm ||
    currentFingerprint?.algorithm !== sourceFingerprintAlgorithm
  ) {
    return [
      `P2-04 evidence uses a missing or unsupported source fingerprint algorithm; rerun ${rerunCommand}`,
    ];
  }
  if (
    after.sourceFingerprint !== currentFingerprint.digest ||
    JSON.stringify(after.sourceFingerprintFiles) !==
      JSON.stringify(currentFingerprint.files)
  ) {
    return [
      `P2-04 browser evidence is stale for the current render inputs; rerun ${rerunCommand}`,
    ];
  }
  return [];
}

function cssContrastRatio(foreground, background) {
  const luminance = (value) => {
    const channels = String(value)
      .match(/[\d.]+/gu)
      ?.slice(0, 3)
      .map(Number);
    if (
      channels?.length !== 3 ||
      channels.some((channel) => !Number.isFinite(channel))
    ) {
      return null;
    }
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) {
    return 0;
  }
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

const heroFrameMeasurementFields = Object.freeze([
  "AnchorTop",
  "DocumentHeight",
  "Height",
  "Left",
  "Top",
  "Width",
]);

function isStableHeroFrame(stability) {
  return heroFrameMeasurementFields.every((field) => {
    const before = stability?.[`before${field}`];
    const after = stability?.[`after${field}`];
    return (
      Number.isFinite(before) &&
      Number.isFinite(after) &&
      Math.abs(before - after) <= 1
    );
  });
}

export function assessCompositeMetrics(metrics) {
  const errors = [...assessPageMetrics(metrics?.base)];
  for (const [component, minimum] of Object.entries(expectedComponentCounts)) {
    if (Number(metrics?.componentCounts?.[component] ?? 0) < minimum) {
      errors.push("missing " + component + " composite states");
    }
  }
  if (metrics?.imageFailures !== 5) {
    errors.push("exactly five media fallbacks must be visible in the specimen");
  }
  if (metrics?.runtimeImageFailures !== 5) {
    errors.push("all five media fallbacks must come from runtime failures");
  }
  if (Number(metrics?.privacyLeaks ?? 0) !== 0) {
    errors.push("private plaintext must never enter the composite DOM");
  }
  if (
    typeof metrics?.heroAction?.text !== "string" ||
    metrics.heroAction.text.trim() === ""
  ) {
    errors.push("Hero action must expose visible text");
  }
  const heroActionContrast = cssContrastRatio(
    metrics?.heroAction?.foreground,
    metrics?.heroAction?.background,
  );
  if (heroActionContrast < 4.5) {
    errors.push(
      `Hero action contrast must be at least 4.5:1, received ${heroActionContrast.toFixed(2)}:1`,
    );
  }
  const transitionStability = metrics?.heroTransitionStability;
  if (
    !isStableHeroFrame(transitionStability) ||
    transitionStability?.beforeState !== "loading" ||
    transitionStability?.afterState !== "ready"
  ) {
    errors.push(
      `Hero loading-to-ready layout shift must stay within one CSS pixel: ${JSON.stringify(transitionStability)}`,
    );
  }
  const failureStability = metrics?.heroFailureStability;
  if (
    !isStableHeroFrame(failureStability) ||
    failureStability.browserDecodeFailed !== true ||
    failureStability.sourceChanged !== true ||
    typeof failureStability.initialSrc !== "string" ||
    failureStability.initialSrc.length === 0 ||
    typeof failureStability.requestedSrc !== "string" ||
    failureStability.requestedSrc.length === 0
  ) {
    errors.push(
      "Hero failure layout shift must stay within one CSS pixel of the ready frame",
    );
  }
  if (metrics?.heroFailureOverlap !== false) {
    errors.push("Hero failure fallback must not overlap Hero content");
  }
  const heroMediaStyle = metrics?.heroMediaStyle;
  if (
    heroMediaStyle?.borderTopWidth !== "0px" ||
    heroMediaStyle?.borderRightWidth !== "0px" ||
    heroMediaStyle?.borderBottomWidth !== "0px" ||
    heroMediaStyle?.borderLeftWidth !== "0px" ||
    heroMediaStyle?.borderRadius !== "0px"
  ) {
    errors.push("Hero media frame must remain borderless and square-cornered");
  }
  const cartLineGift = metrics?.cartLineMedia?.gift;
  const cartLineIdol = metrics?.cartLineMedia?.idol;
  const withinOnePixel = (actual, expected) =>
    Number.isFinite(actual) && Math.abs(actual - expected) <= 1;
  if (
    cartLineGift === null ||
    cartLineGift === undefined ||
    cartLineIdol === null ||
    cartLineIdol === undefined ||
    !withinOnePixel(cartLineGift.width, 80) ||
    !withinOnePixel(cartLineGift.height, 80) ||
    !withinOnePixel(cartLineIdol.width, 40) ||
    !withinOnePixel(cartLineIdol.height, 40)
  ) {
    errors.push(
      "CartLine media must keep an 80px gift image visible beneath a distinct 40px idol avatar",
    );
  }
  for (const ratio of metrics?.ratios ?? []) {
    if (
      !Number.isFinite(ratio.actual) ||
      !Number.isFinite(ratio.expected) ||
      Math.abs(ratio.actual - ratio.expected) > 0.025
    ) {
      errors.push(String(ratio.label) + " ratio is unstable");
    }
  }
  if (
    metrics?.timeline?.ordered !== true ||
    metrics?.timeline?.itemCount !== 3
  ) {
    errors.push("timeline must remain an ordered list with three items");
  }
  if (metrics?.timeline?.currentCount !== 1) {
    errors.push("timeline must expose exactly one current step");
  }
  return errors;
}

export function classifyTextClipping(measurement) {
  const reasons = [];
  if (
    measurement.rectLeft < -0.5 ||
    measurement.rectRight > measurement.viewportWidth + 0.5
  ) {
    reasons.push("outside-horizontal-viewport");
  }
  const clippingValues = new Set(["auto", "clip", "hidden", "scroll"]);
  if (
    measurement.clientWidth > 0 &&
    measurement.scrollWidth > measurement.clientWidth + 0.5 &&
    clippingValues.has(measurement.overflowX)
  ) {
    reasons.push("horizontal-clip");
  }
  if (
    measurement.clientHeight > 0 &&
    measurement.scrollHeight > measurement.clientHeight + 0.5 &&
    clippingValues.has(measurement.overflowY)
  ) {
    reasons.push("vertical-clip");
  }
  if (measurement.textOverflow === "ellipsis") {
    reasons.push("ellipsis");
  }
  if (
    typeof measurement.webkitLineClamp === "string" &&
    measurement.webkitLineClamp !== "none"
  ) {
    reasons.push("line-clamp");
  }
  return reasons;
}

function durationsAreZero(value) {
  return (
    typeof value === "string" &&
    value
      .split(",")
      .map((duration) => Number.parseFloat(duration))
      .every((duration) => Number.isFinite(duration) && duration === 0)
  );
}

export function assessReducedMotion(measurement) {
  const errors = [];
  if (measurement?.mediaQuery !== true) {
    errors.push("reduced-motion media query must be active");
  }
  if (!durationsAreZero(measurement?.linkTransitionDuration)) {
    errors.push("Link transition must be zero under reduced motion");
  }
  if (!durationsAreZero(measurement?.mediaTransitionDuration)) {
    errors.push("Media transition must be zero under reduced motion");
  }
  if (measurement?.scrollBehavior !== "auto") {
    errors.push("scroll behavior must be automatic under reduced motion");
  }
  return errors;
}

export function createEvidenceReadme({
  axeSummaries,
  generatedAt,
  git,
  nativeZoom,
  runtimeGates,
  scenarioResults,
  screenshots,
}) {
  const lines = [
    "# P2-04 UI composite browser verification",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Outcome",
    "",
    `- Scenarios: ${scenarioResults.length}/${scenarioResults.length} passed`,
    `- Screenshots: ${screenshots.length}`,
    `- Axe scans: ${axeSummaries.length}; critical/serious blocking findings: ${axeSummaries.reduce((total, scan) => total + scan.blocking.length, 0)}`,
    `- Native Chrome zoom: ${nativeZoom.detectedPercent.toFixed(1)}% detected for requested ${nativeZoom.zoomPercent}%`,
    `- Source fingerprint: ${git.before.sourceFingerprint} (${git.before.sourceFingerprintAlgorithm})`,
    "",
    "## Runtime gates",
    "",
    ...runtimeGates.map(
      (gate) =>
        `- ${gate.environment}: health ${gate.healthStatus}; locale routes ${gate.localeStatuses.join(", ")}`,
    ),
    "",
    "## Screenshots",
    "",
    ...screenshots.map((entry) => `- ${entry.path} (${entry.sha256})`),
    "",
    `Rerun: \`${rerunCommand}\``,
    "",
    "This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, formal brand approval, or real-device performance evidence.",
    "",
  ];
  return lines.join("\n");
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function pathExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function requireCompositeEvidenceFile(candidate, relativePath) {
  const absolutePath = path.join(candidate, ...relativePath.split("/"));
  let details;
  try {
    details = await lstat(absolutePath);
  } catch {
    throw new Error(`P2-04 evidence is missing ${relativePath}`);
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`P2-04 evidence ${relativePath} must be a regular file`);
  }
  return absolutePath;
}

export async function validateCompositeEvidenceCandidate(candidate) {
  const resultsPath = await requireCompositeEvidenceFile(
    candidate,
    "browser-results.json",
  );
  const readmePath = await requireCompositeEvidenceFile(candidate, "README.md");
  const manifestPath = await requireCompositeEvidenceFile(
    candidate,
    "screenshots.sha256",
  );

  let results;
  try {
    results = JSON.parse(await readFile(resultsPath, "utf8"));
  } catch {
    throw new Error("P2-04 browser-results.json must contain valid JSON");
  }
  const shapeErrors = assessCompositeEvidenceShape(results);
  if (shapeErrors.length > 0) {
    throw new Error(shapeErrors.join("; "));
  }
  const readme = await readFile(readmePath, "utf8");
  if (
    !readme.includes("P2-04 UI composite browser verification") ||
    !readme.includes(rerunCommand)
  ) {
    throw new Error(
      "P2-04 evidence README must identify the gate and rerun command",
    );
  }

  const manifestEntries = new Map();
  for (const line of (await readFile(manifestPath, "utf8"))
    .split("\n")
    .filter(Boolean)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (
      match === null ||
      !isSafeRelativeArtifactPath(match[2], ".png") ||
      manifestEntries.has(match[2])
    ) {
      throw new Error("P2-04 screenshot manifest contains an invalid entry");
    }
    manifestEntries.set(match[2], match[1]);
  }

  const screenshotPaths = new Set();
  for (const screenshot of results.screenshots) {
    if (
      !isSafeRelativeArtifactPath(screenshot?.path, ".png") ||
      !/^[a-f0-9]{64}$/u.test(screenshot?.sha256 ?? "") ||
      screenshotPaths.has(screenshot.path)
    ) {
      throw new Error("P2-04 browser results contain an invalid screenshot");
    }
    screenshotPaths.add(screenshot.path);
    const screenshotPath = await requireCompositeEvidenceFile(
      candidate,
      screenshot.path,
    );
    const buffer = await readFile(screenshotPath);
    const actualHash = sha256(buffer);
    if (
      actualHash !== screenshot.sha256 ||
      manifestEntries.get(screenshot.path) !== screenshot.sha256
    ) {
      throw new Error(`P2-04 screenshot hash mismatch for ${screenshot.path}`);
    }
    if (
      screenshot.path === nativeZoomScreenshots.baseline ||
      screenshot.path === nativeZoomScreenshots.zoomed
    ) {
      const dimensions = readPngDimensions(buffer);
      if (
        dimensions.width !== screenshot.pixelWidth ||
        dimensions.height !== screenshot.pixelHeight
      ) {
        throw new Error(
          `P2-04 native screenshot dimensions mismatch for ${screenshot.path}`,
        );
      }
    }
  }
  if (
    manifestEntries.size !== screenshotPaths.size ||
    [...manifestEntries.keys()].some((entry) => !screenshotPaths.has(entry))
  ) {
    throw new Error("P2-04 screenshot manifest does not match browser results");
  }

  const nativeErrors = assessNativeZoomMeasurements({
    baseline: results.nativeZoom.baseline,
    expectedPercent: nativeZoomPercent,
    zoomed: results.nativeZoom.zoomed,
  });
  if (nativeErrors.length > 0) {
    throw new Error(
      `P2-04 native zoom evidence is invalid: ${nativeErrors.join("; ")}`,
    );
  }

  for (const summary of results.axeSummaries) {
    const artifactPath = await requireCompositeEvidenceFile(
      candidate,
      summary.artifact,
    );
    let artifact;
    try {
      artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    } catch {
      throw new Error(`P2-04 axe artifact is invalid: ${summary.artifact}`);
    }
    if (
      artifact?.schemaVersion !== 1 ||
      artifact?.scan?.id !== summary.id ||
      artifact?.scan?.scenarioId !== summary.scenarioId
    ) {
      throw new Error(`P2-04 axe metadata mismatch: ${summary.artifact}`);
    }
    const artifactSummary = summarizeAxeResult(artifact.result);
    if (
      artifactSummary.blocking.length !== 0 ||
      JSON.stringify(artifactSummary.blocking) !==
        JSON.stringify(summary.blocking) ||
      JSON.stringify(artifactSummary.counts) !== JSON.stringify(summary.counts)
    ) {
      throw new Error(`P2-04 axe summary mismatch: ${summary.artifact}`);
    }
  }
  return results;
}

async function replaceCompositeEvidenceDirectory(candidate, target) {
  if (path.dirname(candidate) !== path.dirname(target)) {
    throw new Error("P2-04 candidate and target directories must be siblings");
  }
  const details = await lstat(candidate);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("P2-04 candidate evidence must be a directory");
  }
  await validateCompositeEvidenceCandidate(candidate);

  if (!(await pathExists(target))) {
    await rename(candidate, target);
    return;
  }
  const backup = path.join(
    path.dirname(target),
    `.${path.basename(target)}-backup-${String(process.pid)}-${randomUUID()}`,
  );
  await rename(target, backup);
  try {
    await rename(candidate, target);
  } catch (error) {
    await rename(backup, target);
    throw error;
  }
  await rm(backup, { force: true, recursive: true });
}

async function runCommand(
  command,
  arguments_,
  { cwd, env = process.env, logPath },
) {
  const child = spawn(command, arguments_, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const capture = (chunk) => {
    const value = chunk.toString();
    output.push(value);
    process.stdout.write(value);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const combined = output.join("");
  if (logPath !== undefined) {
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, combined, "utf8");
  }
  if (result.code !== 0) {
    throw new Error(
      `command failed: ${[command, ...arguments_].join(" ")}\nexit=${String(result.code)} signal=${String(result.signal)}\n${combined.slice(-4_000)}`,
    );
  }
  return combined.trim();
}

async function captureCommand(command, arguments_, cwd) {
  const child = spawn(command, arguments_, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  if (result !== 0) {
    throw new Error(output.join(""));
  }
  return output.join("").trimEnd();
}

export function normalizeWorkspaceStatus(lines) {
  return lines.filter(
    (line) =>
      !/^\?\? output\/playwright\/\.p2-04-candidate-[^/]+\//u.test(line) &&
      !/^.. output\/playwright\/p2-04\//u.test(line),
  );
}

export async function collectCompositeSourceFingerprint(workspaceRoot) {
  const listed = await captureCommand(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...sourceFingerprintPathspec,
    ],
    workspaceRoot,
  );
  const paths = listed.split("\0").filter(Boolean).sort();
  invariant(paths.length > 0, "composite source fingerprint scope is empty");
  const files = await Promise.all(
    paths.map(async (relativePath) => {
      const normalizedPath = path.posix.normalize(relativePath);
      const absolutePath = path.resolve(workspaceRoot, relativePath);
      invariant(
        normalizedPath === relativePath &&
          !path.isAbsolute(relativePath) &&
          !relativePath.startsWith("../") &&
          absolutePath.startsWith(workspaceRoot + path.sep),
        "composite source path escaped the workspace",
      );
      const details = await lstat(absolutePath);
      invariant(
        details.isFile() && !details.isSymbolicLink(),
        "composite source fingerprint accepts regular files only",
      );
      return {
        path: relativePath,
        sha256: sha256(await readFile(absolutePath)),
      };
    }),
  );
  return {
    algorithm: sourceFingerprintAlgorithm,
    digest: sha256(
      JSON.stringify({ algorithm: sourceFingerprintAlgorithm, files }),
    ),
    files,
  };
}

async function collectGit(workspaceRoot) {
  const [sha, sourceFingerprint, status] = await Promise.all([
    captureCommand("git", ["rev-parse", "HEAD"], workspaceRoot),
    collectCompositeSourceFingerprint(workspaceRoot),
    captureCommand(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      workspaceRoot,
    ),
  ]);
  return {
    sha,
    sourceFingerprint: sourceFingerprint.digest,
    sourceFingerprintAlgorithm: sourceFingerprint.algorithm,
    sourceFingerprintFiles: sourceFingerprint.files,
    status: normalizeWorkspaceStatus(
      status.length === 0 ? [] : status.split("\n"),
    ),
  };
}

async function collectVersions(workspaceRoot) {
  const [rootManifest, storefrontManifest, playwright, axe, next, react, pnpm] =
    await Promise.all([
      readJson(path.join(workspaceRoot, "package.json")),
      readJson(path.join(workspaceRoot, "apps/storefront/package.json")),
      readJson(
        path.join(workspaceRoot, "node_modules/@playwright/test/package.json"),
      ),
      readJson(
        path.join(
          workspaceRoot,
          "node_modules/@axe-core/playwright/package.json",
        ),
      ),
      readJson(
        path.join(
          workspaceRoot,
          "apps/storefront/node_modules/next/package.json",
        ),
      ),
      readJson(
        path.join(
          workspaceRoot,
          "apps/storefront/node_modules/react/package.json",
        ),
      ),
      captureCommand("corepack", ["pnpm", "--version"], workspaceRoot),
    ]);
  const expectedNode = (
    await readFile(path.join(workspaceRoot, ".node-version"), "utf8")
  ).trim();
  invariant(
    process.versions.node === expectedNode,
    `runner requires Node ${expectedNode}`,
  );
  invariant(
    pnpm === String(rootManifest.packageManager).replace(/^pnpm@/u, ""),
    "installed pnpm version does not match packageManager",
  );
  invariant(
    playwright.version === rootManifest.devDependencies["@playwright/test"] &&
      axe.version === rootManifest.devDependencies["@axe-core/playwright"] &&
      next.version === storefrontManifest.dependencies.next &&
      react.version === storefrontManifest.dependencies.react,
    "browser toolchain versions must match exact manifests",
  );
  return {
    axe: axe.version,
    browser: "pending",
    next: next.version,
    node: process.version,
    playwright: playwright.version,
    pnpm,
    react: react.version,
  };
}

async function readJson(absolutePath) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

async function prepareProductionBuild(workspaceRoot, candidate) {
  const logs = path.join(candidate, "logs");
  await runCommand(
    "corepack",
    ["pnpm", "--filter", "@fan-support/ui", "build"],
    {
      cwd: workspaceRoot,
      logPath: path.join(logs, "build-ui.log"),
    },
  );
  await runCommand(
    "corepack",
    ["pnpm", "--filter", "@fan-support/storefront", "build"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
        FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
        NODE_ENV: "production",
      },
      logPath: path.join(logs, "build-storefront.log"),
    },
  );
  const storefrontRoot = path.join(workspaceRoot, "apps/storefront");
  const standaloneAppRoot = path.join(
    storefrontRoot,
    ".next/standalone/apps/storefront",
  );
  invariant(
    await pathExists(path.join(standaloneAppRoot, "server.js")),
    "Next standalone server is missing",
  );
  const staticTarget = path.join(standaloneAppRoot, ".next/static");
  await rm(staticTarget, { force: true, recursive: true });
  await mkdir(path.dirname(staticTarget), { recursive: true });
  await cp(path.join(storefrontRoot, ".next/static"), staticTarget, {
    recursive: true,
  });
  const publicTarget = path.join(standaloneAppRoot, "public");
  await rm(publicTarget, { force: true, recursive: true });
  await cp(path.join(storefrontRoot, "public"), publicTarget, {
    recursive: true,
  });
  return standaloneAppRoot;
}

async function reservePort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  invariant(
    address !== null && typeof address === "object",
    "cannot reserve port",
  );
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

function runtimeSiteOrigin(environment) {
  return environment === "preview"
    ? "https://localhost:3443"
    : "https://shop.example.invalid";
}

async function startServer({ candidate, environment, standaloneAppRoot }) {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const chunks = [];
  const child = spawn(process.execPath, ["server.js"], {
    cwd: standaloneAppRoot,
    env: {
      ...process.env,
      FAN_SUPPORT_DEPLOYMENT_ENV: environment,
      FAN_SUPPORT_SITE_ORIGIN: runtimeSiteOrigin(environment),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk) => {
    chunks.push(chunk.toString());
    process.stdout.write(chunk.toString());
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  completion.catch(() => undefined);
  const server = { candidate, child, chunks, completion, environment, origin };
  try {
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      if (child.exitCode !== null) {
        throw new Error(environment + " server exited before readiness");
      }
      try {
        if ((await fetchStatus(origin + "/healthz")) === 200) {
          return server;
        }
      } catch {
        // Next has not bound the reserved port yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(environment + " server did not become ready");
  } catch (error) {
    await stopServer(server);
    throw error;
  }
}

async function stopServer(server) {
  if (server === undefined) {
    return;
  }
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill("SIGTERM");
    await Promise.race([
      server.completion,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill("SIGKILL");
    await server.completion;
  }
  const logPath = path.join(
    server.candidate,
    "logs",
    `server-${server.environment}.log`,
  );
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, server.chunks.join(""), "utf8");
}

async function fetchStatus(url) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const status = response.status;
  await response.body?.cancel();
  return status;
}

function fixturePath(locale) {
  return `/_internal/design-foundations/${encodeURIComponent(locale)}${routeSuffix}`;
}

async function probeRuntime(server) {
  const [healthStatus, ...localeStatuses] = await Promise.all([
    fetchStatus(server.origin + "/healthz"),
    ...[...previewLocales].map((locale) =>
      fetchStatus(server.origin + fixturePath(locale)),
    ),
  ]);
  return {
    environment: server.environment,
    healthStatus,
    localeStatuses,
    origin: server.origin,
  };
}

export async function settleDeferredImages(page) {
  const imageIds = await page.locator("img").evaluateAll((images) =>
    images.map((image, index) => {
      const id = `p2-04-${String(index)}`;
      image.setAttribute("data-p2-04-image-id", id);
      return id;
    }),
  );
  for (const imageId of imageIds) {
    // A failed image can be replaced by React between separate locator calls.
    // Resolve and scroll in one DOM turn; the completion check also accepts
    // the removed image, while each scenario still asserts its visible fallback.
    await page.evaluate((id) => {
      document
        .querySelector(`[data-p2-04-image-id="${id}"]`)
        ?.scrollIntoView({ behavior: "instant", block: "center" });
    }, imageId);
    await page.waitForFunction((id) => {
      const element = document.querySelector(`[data-p2-04-image-id="${id}"]`);
      return (
        element === null ||
        (element instanceof HTMLImageElement && element.complete)
      );
    }, imageId);
  }
  await page
    .locator("[data-p2-04-image-id]")
    .evaluateAll((images) =>
      images.forEach((image) => image.removeAttribute("data-p2-04-image-id")),
    );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("img")].every(
      (image) => image instanceof HTMLImageElement && image.complete,
    ),
  );
}

async function settlePage(page, locale, checks = []) {
  const url = fixturePath(locale);
  const response = await page.goto(url, { waitUntil: "load" });
  invariant(response?.status() === 200, `${url} must return 200`);
  const root = page.locator('main[data-ui-composites="v1"]');
  await root.waitFor({ state: "visible" });
  invariant(
    (await root.getAttribute("lang")) === locale,
    "fixture lang mismatch",
  );
  invariant(
    (await page.locator('meta[name="robots"]').getAttribute("content"))
      ?.toLowerCase()
      .includes("noindex") === true,
    "fixture must remain noindex",
  );
  await page.evaluate(async () => document.fonts.ready);
  await settleDeferredImages(page);
  const preflightChecks = {};
  if (checks.includes("keyboard")) {
    preflightChecks.keyboard = await collectKeyboardProof(page);
  }
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-media-error-source="runtime"]')
        .length === 4,
  );
  const settleLayout = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(resolve),
          ),
        ),
    );
  const measureHeroFrame = (heroSelector, anchorSelector) =>
    page.evaluate(
      ({ anchorSelector, heroSelector }) => {
        const hero = document.querySelector(heroSelector);
        const trigger = document.querySelector(anchorSelector);
        if (
          !(hero instanceof HTMLElement) ||
          !(trigger instanceof HTMLElement)
        ) {
          return null;
        }
        const heroRect = hero.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        return {
          anchorTop: triggerRect.top + window.scrollY,
          documentHeight: document.documentElement.scrollHeight,
          height: heroRect.height,
          left: heroRect.left + window.scrollX,
          top: heroRect.top + window.scrollY,
          width: heroRect.width,
        };
      },
      { anchorSelector, heroSelector },
    );
  const transitionHeroSelector =
    '[data-hero-transition-demo] [data-fs-composite="hero"]';
  const transitionTriggerSelector = '[data-hero-transition-trigger="true"]';
  await settleLayout();
  const beforeTransition = await measureHeroFrame(
    transitionHeroSelector,
    transitionTriggerSelector,
  );
  invariant(
    beforeTransition !== null,
    "Hero loading transition must be measurable before activation",
  );
  const beforeTransitionState = await page
    .locator(transitionHeroSelector)
    .getAttribute("data-render-state");
  await page.locator(transitionTriggerSelector).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-hero-transition-demo]")
        ?.getAttribute("data-hero-transition-demo") === "ready",
  );
  await settleDeferredImages(page);
  await settleLayout();
  const afterTransition = await measureHeroFrame(
    transitionHeroSelector,
    transitionTriggerSelector,
  );
  invariant(
    afterTransition !== null,
    "Hero loading transition must be measurable after activation",
  );
  const heroTransitionStability = {
    afterAnchorTop: afterTransition.anchorTop,
    afterDocumentHeight: afterTransition.documentHeight,
    afterHeight: afterTransition.height,
    afterLeft: afterTransition.left,
    afterState: await page
      .locator(transitionHeroSelector)
      .getAttribute("data-render-state"),
    afterTop: afterTransition.top,
    afterWidth: afterTransition.width,
    beforeAnchorTop: beforeTransition.anchorTop,
    beforeDocumentHeight: beforeTransition.documentHeight,
    beforeHeight: beforeTransition.height,
    beforeLeft: beforeTransition.left,
    beforeState: beforeTransitionState,
    beforeTop: beforeTransition.top,
    beforeWidth: beforeTransition.width,
  };
  const failureHeroSelector =
    '[data-hero-failure-demo] [data-fs-composite="hero"]';
  const failureTriggerSelector = '[data-hero-failure-trigger="true"]';
  const failureTrigger = page.locator(failureTriggerSelector);
  const initialFailureSource = await page.evaluate(() => {
    const demo = document.querySelector("[data-hero-failure-demo]");
    const image = demo?.querySelector(".fs-hero__media img");
    if (
      !(demo instanceof HTMLElement) ||
      !(image instanceof HTMLImageElement)
    ) {
      return null;
    }
    demo.dataset.heroFailureErrorEvent = "pending";
    image.addEventListener(
      "error",
      () => {
        demo.dataset.heroFailureErrorEvent = "received";
        demo.dataset.heroFailureNaturalWidth = String(image.naturalWidth);
        demo.dataset.heroFailureRequestedSrc = image.currentSrc || image.src;
      },
      { once: true },
    );
    return image.currentSrc || image.src;
  });
  invariant(
    typeof initialFailureSource === "string" && initialFailureSource.length > 0,
    "runtime Hero failure probe needs an initial image source",
  );
  await settleLayout();
  const beforeFailure = await measureHeroFrame(
    failureHeroSelector,
    failureTriggerSelector,
  );
  invariant(
    beforeFailure !== null,
    "runtime Hero failure probe must be measurable before activation",
  );
  await failureTrigger.click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-media-error-source="runtime"]')
        .length === 5,
  );
  await settleLayout();
  const afterFailure = await measureHeroFrame(
    failureHeroSelector,
    failureTriggerSelector,
  );
  invariant(
    afterFailure !== null,
    "runtime Hero failure probe must be measurable after activation",
  );
  const decodeProof = await page
    .locator("[data-hero-failure-demo]")
    .evaluate((demo) => ({
      errorEvent: demo.getAttribute("data-hero-failure-error-event"),
      naturalWidth: demo.getAttribute("data-hero-failure-natural-width"),
      requestedSrc: demo.getAttribute("data-hero-failure-requested-src"),
    }));
  const heroFailureStability = {
    afterAnchorTop: afterFailure.anchorTop,
    afterDocumentHeight: afterFailure.documentHeight,
    afterHeight: afterFailure.height,
    afterLeft: afterFailure.left,
    afterTop: afterFailure.top,
    afterWidth: afterFailure.width,
    beforeAnchorTop: beforeFailure.anchorTop,
    beforeDocumentHeight: beforeFailure.documentHeight,
    beforeHeight: beforeFailure.height,
    beforeLeft: beforeFailure.left,
    beforeTop: beforeFailure.top,
    beforeWidth: beforeFailure.width,
    browserDecodeFailed:
      decodeProof.errorEvent === "received" && decodeProof.naturalWidth === "0",
    initialSrc: initialFailureSource,
    requestedSrc: decodeProof.requestedSrc,
    sourceChanged:
      typeof decodeProof.requestedSrc === "string" &&
      decodeProof.requestedSrc !== initialFailureSource,
  };
  const informativeAlts = await page
    .locator('img[alt]:not([alt=""]), [role="img"][aria-label]')
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          element.getAttribute("alt") ??
          element.getAttribute("aria-label") ??
          "",
      ),
    );
  invariant(
    informativeAlts.length > 0 &&
      informativeAlts.every((alt) => alt.length > 0),
    "informative media must expose non-empty alternatives",
  );
  if (locale !== "en") {
    const englishAlternatives = new Set([
      "Fictional performer Mira Vale beside blue and ivory flowers",
      "Navy keepsake gift with ivory ribbon and dried flowers",
      "Portrait of the fictional performer Mira Vale",
    ]);
    invariant(
      informativeAlts.every((alt) => !englishAlternatives.has(alt)),
      `${locale} informative media alternatives must be localized`,
    );
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
  });
  return {
    heroFailureStability,
    heroTransitionStability,
    preflightChecks,
    url,
  };
}

async function collectMetrics(page) {
  const metrics = await page.evaluate(() => {
    const textSelectors = [
      "h1",
      "h2",
      "h3",
      "p",
      ".fs-link",
      ".fs-media__fallback",
      ".fs-status",
      "time",
    ];
    const viewportWidth = document.documentElement.clientWidth;
    const textMeasurements = [
      ...document.querySelectorAll(textSelectors.join(",")),
    ].flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) {
        return [];
      }
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return [
        {
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          rectLeft: rect.left,
          rectRight: rect.right,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
          selector: `${element.tagName}[${index}]`,
          textOverflow: style.textOverflow,
          viewportWidth,
          webkitLineClamp: style.webkitLineClamp,
        },
      ];
    });
    const controls = [
      ...document.querySelectorAll("a[href], button, input, select"),
    ]
      .filter(
        (element) =>
          element instanceof HTMLElement && element.offsetParent !== null,
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().slice(0, 120) ??
            element.tagName,
          width: rect.width,
        };
      });
    const componentCounts = Object.fromEntries(
      [
        "hero",
        "idol-portrait",
        "gift-tile",
        "idol-context",
        "cart-line",
        "order-timeline",
      ].map((name) => [
        name,
        document.querySelectorAll(`[data-fs-composite="${name}"]`).length,
      ]),
    );
    const ratio = (selector, expected, label) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return { actual: null, expected, label };
      }
      const rect = element.getBoundingClientRect();
      return { actual: rect.width / rect.height, expected, label };
    };
    const timeline = document.querySelector(
      '[data-fs-composite="order-timeline"][data-render-state="ready"] ol',
    );
    const heroAction = document.querySelector(".fs-hero__action");
    const heroActionStyle =
      heroAction instanceof HTMLElement ? getComputedStyle(heroAction) : null;
    const measureRect = (element) => {
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
    };
    const readyCartLine = document.querySelector(
      '[data-fs-composite="cart-line"][data-render-state="ready"]',
    );
    const heroMedia = document.querySelector(
      '[data-fs-composite="hero"] .fs-hero__media',
    );
    const heroMediaStyle =
      heroMedia instanceof HTMLElement ? getComputedStyle(heroMedia) : null;
    const failedHero = document.querySelector(
      '.fs-hero:has(.fs-hero__media[data-media-state="error"])',
    );
    const failedHeroFallback = failedHero?.querySelector(".fs-media__fallback");
    const failedHeroContent = failedHero?.querySelector(".fs-hero__content");
    const failedHeroFallbackRect =
      failedHeroFallback instanceof HTMLElement
        ? failedHeroFallback.getBoundingClientRect()
        : null;
    const failedHeroContentRect =
      failedHeroContent instanceof HTMLElement
        ? failedHeroContent.getBoundingClientRect()
        : null;
    return {
      base: {
        textMeasurements,
        controls,
        document: {
          bodyScrollWidth: document.body.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
        fontsStatus: document.fonts.status,
        replacementGlyphs: (document.body.innerText.match(/�/gu) ?? []).length,
      },
      componentCounts,
      cartLineMedia: {
        gift: measureRect(
          readyCartLine?.querySelector(".fs-cart-line__gift-media"),
        ),
        idol: measureRect(
          readyCartLine?.querySelector(".fs-cart-line__idol-media"),
        ),
      },
      heroCurrentSrc:
        document.querySelector('[data-fs-composite="hero"] picture img')
          ?.currentSrc ?? null,
      heroAction:
        heroActionStyle === null
          ? null
          : {
              background: heroActionStyle.backgroundColor,
              foreground: heroActionStyle.color,
              text: heroAction?.textContent?.trim() ?? "",
            },
      heroFailureOverlap:
        failedHeroFallbackRect === null || failedHeroContentRect === null
          ? null
          : failedHeroFallbackRect.left < failedHeroContentRect.right &&
            failedHeroFallbackRect.right > failedHeroContentRect.left &&
            failedHeroFallbackRect.top < failedHeroContentRect.bottom &&
            failedHeroFallbackRect.bottom > failedHeroContentRect.top,
      heroMediaStyle:
        heroMediaStyle === null
          ? null
          : {
              borderBottomWidth: heroMediaStyle.borderBottomWidth,
              borderLeftWidth: heroMediaStyle.borderLeftWidth,
              borderRadius: heroMediaStyle.borderRadius,
              borderRightWidth: heroMediaStyle.borderRightWidth,
              borderTopWidth: heroMediaStyle.borderTopWidth,
            },
      imageFailures: document.querySelectorAll('[data-media-state="error"]')
        .length,
      runtimeImageFailures: document.querySelectorAll(
        '[data-media-error-source="runtime"]',
      ).length,
      privacyLeaks: [
        "PRIVATE_FIXTURE_MESSAGE_SENTINEL",
        "fullDisplayName",
      ].filter((sentinel) =>
        document.documentElement.textContent?.includes(sentinel),
      ).length,
      ratios: [
        ratio(
          '[data-fs-composite="hero"] .fs-hero__media',
          window.innerWidth < 768 ? 4 / 5 : 16 / 9,
          "hero",
        ),
        ratio(
          '[data-fs-composite="idol-portrait"] .fs-idol-portrait__media',
          4 / 5,
          "portrait",
        ),
        ratio(
          '[data-fs-composite="gift-tile"] .fs-gift-tile__media',
          1,
          "gift",
        ),
        ratio(
          '.fs-hero:has(.fs-hero__media[data-media-state="error"]) .fs-hero__media',
          window.innerWidth < 768 ? 4 / 5 : 16 / 9,
          "hero failure",
        ),
      ],
      states: Object.fromEntries(
        ["loading", "empty", "error"].map((state) => [
          state,
          document.querySelectorAll(`[data-render-state="${state}"]`).length,
        ]),
      ),
      timeline: {
        currentCount:
          timeline?.querySelectorAll('[aria-current="step"]').length ?? 0,
        itemCount: timeline?.querySelectorAll(":scope > li").length ?? 0,
        ordered: timeline?.tagName === "OL",
      },
    };
  });
  const { textMeasurements, ...base } = metrics.base;
  const clippedText = textMeasurements.flatMap((measurement) => {
    const reasons = classifyTextClipping(measurement);
    return reasons.length === 0
      ? []
      : [{ reason: reasons.join(","), selector: measurement.selector }];
  });
  return { ...metrics, base: { ...base, clippedText } };
}

function diagnosticsErrors(diagnostics) {
  return [
    ...(diagnostics.console ?? []).map(
      (entry) => `console ${entry.type}: ${entry.text}`,
    ),
    ...(diagnostics.pageErrors ?? []).map((entry) => `page error: ${entry}`),
    ...(diagnostics.requestFailures ?? []).map(
      (entry) =>
        `request failure: ${entry.method} ${entry.url} ${entry.errorText}`,
    ),
    ...(diagnostics.httpErrors ?? []).map(
      (entry) => `HTTP ${entry.status}: ${entry.url}`,
    ),
    ...(diagnostics.externalResources ?? []).map(
      (entry) => `external resource: ${entry.url} (${entry.reason})`,
    ),
  ];
}

async function collectKeyboardProof(page) {
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => ({
    className:
      document.activeElement instanceof HTMLElement
        ? document.activeElement.className
        : "",
    outlineStyle:
      document.activeElement instanceof HTMLElement
        ? getComputedStyle(document.activeElement).outlineStyle
        : "none",
    outlineWidth:
      document.activeElement instanceof HTMLElement
        ? getComputedStyle(document.activeElement).outlineWidth
        : "0px",
  }));
  invariant(
    String(active.className).includes("fs-hero__action"),
    "Tab must reach Hero action first",
  );
  invariant(
    active.outlineStyle !== "none" && active.outlineWidth !== "0px",
    "keyboard focus must remain visible",
  );
  await page.keyboard.press("Enter");
  invariant(
    new URL(page.url()).hash === "#catalog",
    "Hero action must navigate by keyboard",
  );
  return active;
}

async function runChecks(page, checks, preflightChecks = {}) {
  const result = { ...preflightChecks };
  if (checks.includes("pseudo-copy")) {
    const visibleCopy = new Set(
      await page
        .locator("[data-fs-composite], [data-fs-composite] *")
        .evaluateAll((elements) =>
          elements.flatMap((element) => {
            const values = ["alt", "aria-label", "title"].flatMap(
              (attribute) => {
                const value = element.getAttribute(attribute)?.trim();
                return value === undefined || value.length === 0 ? [] : [value];
              },
            );
            for (const child of element.childNodes) {
              if (child.nodeType === 3) {
                const value = child.textContent?.trim();
                if (value !== undefined && value.length > 0) {
                  values.push(value);
                }
              }
            }
            return values;
          }),
        ),
    );
    const missing = pseudoRuntimeCopyProof.filter(
      ({ pseudo }) => !visibleCopy.has(pseudo),
    );
    const englishLeaks = pseudoRuntimeCopyProof.filter(({ english }) =>
      visibleCopy.has(english),
    );
    invariant(
      missing.length === 0,
      "pseudo-locale runtime copy is missing: " +
        missing.map(({ english }) => english).join(", "),
    );
    invariant(
      englishLeaks.length === 0,
      "pseudo-locale leaked English copy: " +
        englishLeaks.map(({ english }) => english).join(", "),
    );
    result.pseudoCopy = {
      englishLeaks: [],
      expected: pseudoRuntimeCopyProof.length,
      present: pseudoRuntimeCopyProof.length,
    };
  }
  if (checks.includes("states")) {
    const states = await page.evaluate(() =>
      Object.fromEntries(
        ["loading", "empty", "error"].map((state) => [
          state,
          document.querySelectorAll(`[data-render-state="${state}"]`).length,
        ]),
      ),
    );
    for (const count of Object.values(states)) {
      invariant(
        count >= 6,
        "each async state must appear for all six composites",
      );
    }
    result.states = states;
  }
  if (checks.includes("image-failure")) {
    const failures = await page.locator(
      '[data-media-error-source="runtime"][data-media-state="error"]',
    );
    invariant(
      (await failures.count()) === 5,
      "five media-bearing components need runtime fallbacks",
    );
    invariant(
      (await failures.locator('[role="img"]').count()) === 5,
      "each failed informative media frame needs an accessible fallback",
    );
    invariant(
      (await page.locator('[data-media-error-source="declared"]').count()) ===
        0,
      "browser failure proof must not rely on declared error props",
    );
    const heroFailure = await page
      .locator(
        '.fs-hero:has(.fs-hero__media[data-media-error-source="runtime"])',
      )
      .last()
      .evaluate((hero) => {
        const fallback = hero.querySelector(".fs-media__fallback");
        const content = hero.querySelector(".fs-hero__content");
        if (
          !(fallback instanceof HTMLElement) ||
          !(content instanceof HTMLElement)
        ) {
          return null;
        }
        const fallbackRect = fallback.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const style = getComputedStyle(fallback);
        return {
          background: style.backgroundColor,
          foreground: style.color,
          overlap:
            fallbackRect.left < contentRect.right &&
            fallbackRect.right > contentRect.left &&
            fallbackRect.top < contentRect.bottom &&
            fallbackRect.bottom > contentRect.top,
          text: fallback.textContent?.trim() ?? "",
        };
      });
    invariant(heroFailure !== null, "runtime Hero fallback must be measurable");
    invariant(
      !heroFailure.overlap,
      "runtime Hero fallback must not overlap content",
    );
    invariant(
      heroFailure.text.length > 0,
      "runtime Hero fallback must stay visible",
    );
    invariant(
      cssContrastRatio(heroFailure.foreground, heroFailure.background) >= 4.5,
      "runtime Hero fallback contrast must be at least 4.5:1",
    );
    result.imageFailures = {
      count: 5,
      origin: "runtime error/decode events",
      heroFallback: heroFailure,
    };
  }
  if (checks.includes("privacy")) {
    const body = await page.locator("body").innerText();
    invariant(
      !body.includes("PRIVATE_FIXTURE_MESSAGE_SENTINEL"),
      "private message leaked",
    );
    invariant(!body.includes("fullDisplayName"), "private display name leaked");
    result.privacy = "no plaintext sentinel";
  }
  if (checks.includes("semantics")) {
    invariant(
      (await page
        .locator('[data-selection="selected"] [aria-current="true"]')
        .count()) === 1,
      "selected idol needs aria-current",
    );
    invariant(
      (await page.locator('[data-fs-composite="order-timeline"] ol').count()) >=
        1,
      "timeline needs an ordered list",
    );
    const quantity = page
      .locator('.fs-cart-line__quantity [role="spinbutton"]')
      .first();
    await quantity.focus();
    const beforeQuantity = await quantity.inputValue();
    const lineTotal = page
      .locator('[data-fs-composite="cart-line"] .fs-price')
      .first();
    invariant(
      (await lineTotal.getAttribute("value")) === "25800",
      "CartLine subtotal must reflect its initial quantity",
    );
    await page.keyboard.press("ArrowUp");
    invariant(
      Number(await quantity.inputValue()) === Number(beforeQuantity) + 1,
      "CartLine quantity must update from the keyboard",
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fs-composite="cart-line"] .fs-price')
          ?.getAttribute("value") === "38700",
    );
    const keyboardQuantity = await quantity.inputValue();
    const remove = page.locator('[data-cart-line-action="remove"]').first();
    invariant((await remove.count()) === 1, "CartLine needs a remove button");
    invariant(
      (await remove.evaluate((element) => element.tagName)) === "BUTTON",
      "CartLine remove must use button semantics",
    );
    await remove.focus();
    await page.keyboard.press("Enter");
    const removed = page.locator('.fs-cart-line-demo__removed [role="status"]');
    await removed.waitFor({ state: "visible" });
    await page.locator(".fs-cart-line-demo__removed button").tap();
    await page
      .locator('.fs-cart-line__quantity [role="spinbutton"]')
      .waitFor({ state: "visible" });
    await page
      .locator('.fs-cart-line__quantity [data-quantity-action="increase"]')
      .first()
      .tap();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fs-composite="cart-line"] .fs-price')
          ?.getAttribute("value") === "51600",
    );
    const touchQuantity = await page
      .locator('.fs-cart-line__quantity [role="spinbutton"]')
      .first()
      .inputValue();
    await page.locator('[data-cart-line-action="remove"]').first().tap();
    await removed.waitFor({ state: "visible" });
    await page.locator(".fs-cart-line-demo__removed button").tap();
    await page
      .locator('.fs-cart-line__quantity [role="spinbutton"]')
      .waitFor({ state: "visible" });
    result.semantics = {
      quantity: {
        keyboard: {
          after: Number(keyboardQuantity),
          before: Number(beforeQuantity),
          subtotalAfter: "38700",
          subtotalBefore: "25800",
        },
        touch: {
          after: Number(touchQuantity),
          before: Number(keyboardQuantity),
          subtotalAfter: "51600",
        },
      },
      remove: { keyboard: true, semanticTag: "BUTTON", touch: true },
      selectedCurrentCount: 1,
      timelineOrdered: true,
    };
  }
  if (checks.includes("hover")) {
    const link = page.locator(".fs-gift-tile__title .fs-link").first();
    const before = await link.evaluate(
      (element) => getComputedStyle(element).color,
    );
    await link.hover();
    await page.waitForTimeout(150);
    const after = await link.evaluate(
      (element) => getComputedStyle(element).color,
    );
    invariant(
      after !== before,
      "GiftTile detail link hover must remain visible",
    );
    result.hover = { after, before };
  }
  if (checks.includes("rtl")) {
    await page.locator('main[data-ui-composites="v1"]').evaluate((element) => {
      element.dir = "rtl";
    });
    const rtl = await page.evaluate(() => {
      const scrim = document.querySelector(
        '[data-fs-composite="hero"] .fs-hero__scrim',
      );
      return {
        clientWidth: document.documentElement.clientWidth,
        direction: getComputedStyle(document.querySelector("main")).direction,
        scrimBackground:
          scrim instanceof HTMLElement
            ? getComputedStyle(scrim).backgroundImage
            : "",
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    invariant(rtl.direction === "rtl", "RTL structural probe must be active");
    invariant(
      rtl.scrollWidth <= rtl.clientWidth + 0.5,
      "RTL probe must not overflow",
    );
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      invariant(
        rtl.scrimBackground.includes("to left"),
        "desktop RTL Hero scrim must protect inline-start content",
      );
    }
    result.rtl = rtl;
  }
  return result;
}

async function reducedMotionMeasurement(page) {
  const measurement = await page.evaluate(() => {
    const link = document.querySelector(".fs-hero__action");
    const media = document.querySelector(".fs-hero__media");
    const root = document.querySelector('main[data-ui-composites="v1"]');
    if (
      !(link instanceof HTMLElement) ||
      !(media instanceof HTMLElement) ||
      !(root instanceof HTMLElement)
    ) {
      return null;
    }
    return {
      linkTransitionDuration: getComputedStyle(link).transitionDuration,
      mediaQuery: matchMedia("(prefers-reduced-motion: reduce)").matches,
      mediaTransitionDuration: getComputedStyle(media).transitionDuration,
      scrollBehavior: getComputedStyle(root).scrollBehavior,
    };
  });
  invariant(measurement !== null, "reduced-motion elements are missing");
  const errors = assessReducedMotion(measurement);
  invariant(errors.length === 0, errors.join("; "));
  return measurement;
}

async function writeAxeResult(candidate, scenarioId, scan, result) {
  const relativePath = path.posix.join("axe-results", scan.id + ".json");
  const target = path.join(candidate, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify(
      { result, scan: { ...scan, scenarioId }, schemaVersion: 1 },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return relativePath;
}

async function runScenario({ AxeBuilder, browser, candidate, origin, entry }) {
  const context = await browser.newContext({
    baseURL: origin,
    colorScheme: "dark",
    deviceScaleFactor: 1,
    hasTouch: entry.touch === true,
    isMobile: entry.touch === true,
    locale: "en-US",
    reducedMotion: entry.reducedMotion ? "reduce" : "no-preference",
    serviceWorkers: "block",
    viewport: entry.viewport,
  });
  const page = await context.newPage();
  const diagnostics = await observePage(page, context, origin);
  try {
    const {
      heroFailureStability,
      heroTransitionStability,
      preflightChecks,
      url,
    } = await settlePage(page, entry.locale, entry.checks);
    const checks = await runChecks(page, entry.checks, preflightChecks);
    if (entry.reducedMotion === true) {
      checks.reducedMotion = await reducedMotionMeasurement(page);
    }
    const metrics = {
      ...(await collectMetrics(page)),
      heroFailureStability,
      heroTransitionStability,
    };
    const errors = assessCompositeMetrics(metrics);
    const expectedMedia =
      entry.viewport.width < 768 ? "hero-mobile.png" : "hero-desktop.png";
    if (!String(metrics.heroCurrentSrc).endsWith(expectedMedia)) {
      errors.push(
        "responsive Hero selected the wrong source: " +
          String(metrics.heroCurrentSrc),
      );
    }
    const axeSummaries = [];
    for (const scan of entry.axe) {
      let builder = new AxeBuilder({ page });
      if (scan.include !== undefined) {
        builder = builder.include(scan.include);
      }
      const axeResult = await builder.analyze();
      const summary = summarizeAxeResult(axeResult);
      const artifact = await writeAxeResult(
        candidate,
        entry.id,
        scan,
        axeResult,
      );
      axeSummaries.push({
        ...summary,
        artifact,
        id: scan.id,
        scenarioId: entry.id,
      });
      for (const violation of summary.blocking) {
        errors.push(
          `axe ${scan.id} ${violation.impact} violation ${violation.id} (${violation.nodeCount} nodes)`,
        );
      }
    }
    const screenshotPath = path.join(candidate, ...entry.screenshot.split("/"));
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: entry.fullPage === true,
      path: screenshotPath,
    });
    errors.push(...diagnosticsErrors(diagnostics));
    const screenshotSha256 = sha256(await readFile(screenshotPath));
    return {
      axeSummaries,
      result: {
        checks,
        diagnostics,
        errors,
        fixtureUrl: url,
        group: entry.group,
        id: entry.id,
        locale: entry.locale,
        metrics,
        reducedMotion: entry.reducedMotion === true,
        screenshot: entry.screenshot,
        touch: entry.touch === true,
        viewport: entry.viewport,
      },
      screenshot: { path: entry.screenshot, sha256: screenshotSha256 },
    };
  } finally {
    await context.close();
  }
}

async function runMatrix({ candidate, origin, versions }) {
  const [{ chromium }, axeModule] = await Promise.all([
    import("@playwright/test"),
    import("@axe-core/playwright"),
  ]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  versions.browser = "Google Chrome " + browser.version();
  const scenarioResults = [];
  const axeSummaries = [];
  const screenshots = [];
  try {
    for (const entry of createCompositeScenarioMatrix()) {
      process.stdout.write(`\n[p2-04 browser] ${entry.id}\n`);
      const result = await runScenario({
        AxeBuilder: axeModule.default,
        browser,
        candidate,
        entry,
        origin,
      });
      scenarioResults.push(result.result);
      axeSummaries.push(...result.axeSummaries);
      screenshots.push(result.screenshot);
      if (result.result.errors.length > 0) {
        throw new Error(
          `${entry.id} failed:\n- ${result.result.errors.join("\n- ")}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  return { axeSummaries, scenarioResults, screenshots };
}

async function resolveChrome(workspaceRoot) {
  const override = process.env.FAN_SUPPORT_GOOGLE_CHROME_PATH?.trim();
  const candidates = override ? [override] : [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
  } else if (process.platform === "linux") {
    for (const command of ["google-chrome-stable", "google-chrome"]) {
      try {
        candidates.push(
          await captureCommand("which", [command], workspaceRoot),
        );
      } catch {
        continue;
      }
    }
  }
  for (const candidate of new Set(candidates)) {
    if (await pathExists(candidate)) {
      const version = await captureCommand(
        candidate,
        ["--version"],
        workspaceRoot,
      );
      if (/^Google Chrome \d/u.test(version)) {
        return { executablePath: candidate, version };
      }
    }
  }
  throw new Error("installed Google Chrome was not found");
}

async function writeZoomPreference(profileRoot, percent) {
  const directory = path.join(profileRoot, "Default");
  const target = path.join(directory, "Preferences");
  await mkdir(directory, { recursive: true });
  const desired = createNativeZoomProfilePreferences(percent);
  await writeFile(target, JSON.stringify(desired), "utf8");
  return desired.partition.default_zoom_level.x;
}

async function runNativeZoomPass({
  candidate,
  chromium,
  executablePath,
  origin,
  profileRoot,
  screenshot,
}) {
  const context = await chromium.launchPersistentContext(
    profileRoot,
    createNativeZoomLaunchOptions(executablePath, origin),
  );
  try {
    const page = await context.newPage();
    const diagnostics = await observePage(page, context, origin);
    const { heroFailureStability, heroTransitionStability } = await settlePage(
      page,
      nativeZoomLocale,
    );
    const measurement = await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      outerHeight: window.outerHeight,
      outerWidth: window.outerWidth,
      visualViewport:
        window.visualViewport === null
          ? null
          : {
              height: window.visualViewport.height,
              scale: window.visualViewport.scale,
              width: window.visualViewport.width,
            },
    }));
    const metrics = {
      ...(await collectMetrics(page)),
      heroFailureStability,
      heroTransitionStability,
    };
    const errors = [
      ...assessCompositeMetrics(metrics),
      ...diagnosticsErrors(diagnostics),
    ];
    invariant(errors.length === 0, errors.join("; "));
    const session = await context.newCDPSession(page);
    const captured = await session.send("Page.captureScreenshot", {
      captureBeyondViewport: false,
      format: "png",
      fromSurface: true,
    });
    await session.detach();
    const buffer = Buffer.from(captured.data, "base64");
    const dimensions = readPngDimensions(buffer);
    const expectedWidth = Math.round(
      measurement.innerWidth * measurement.devicePixelRatio,
    );
    const expectedHeight = Math.round(
      measurement.innerHeight * measurement.devicePixelRatio,
    );
    invariant(
      dimensions.width === expectedWidth &&
        dimensions.height === expectedHeight,
      "native screenshot must cover the physical viewport",
    );
    const target = path.join(candidate, ...screenshot.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return {
      measurement,
      screenshot: {
        captureMethod: "CDP Page.captureScreenshot without Emulation commands",
        path: screenshot,
        pixelHeight: dimensions.height,
        pixelWidth: dimensions.width,
        sha256: sha256(buffer),
      },
    };
  } finally {
    await context.close();
  }
}

async function runNativeZoom({ candidate, origin, workspaceRoot }) {
  const { chromium } = await import("@playwright/test");
  const chrome = await resolveChrome(workspaceRoot);
  const profileRoot = await mkdtemp(
    path.join(os.tmpdir(), "fan-support-p2-04-zoom-"),
  );
  try {
    await writeZoomPreference(profileRoot, 100);
    const baseline = await runNativeZoomPass({
      candidate,
      chromium,
      executablePath: chrome.executablePath,
      origin,
      profileRoot,
      screenshot: nativeZoomScreenshots.baseline,
    });
    await writeZoomPreference(profileRoot, nativeZoomPercent);
    const zoomed = await runNativeZoomPass({
      candidate,
      chromium,
      executablePath: chrome.executablePath,
      origin,
      profileRoot,
      screenshot: nativeZoomScreenshots.zoomed,
    });
    const errors = assessNativeZoomMeasurements({
      baseline: baseline.measurement,
      expectedPercent: nativeZoomPercent,
      zoomed: zoomed.measurement,
    });
    invariant(errors.length === 0, errors.join("; "));
    return {
      baseline: baseline.measurement,
      browser: chrome.version,
      detectedPercent:
        (zoomed.measurement.devicePixelRatio /
          baseline.measurement.devicePixelRatio) *
        100,
      method: "isolated Chrome HostZoomMap profile; no Emulation commands",
      profileRemoved: true,
      screenshots: [baseline.screenshot, zoomed.screenshot],
      zoomed: zoomed.measurement,
      zoomPercent: nativeZoomPercent,
    };
  } finally {
    await rm(profileRoot, { force: true, recursive: true });
  }
}

export async function runUiCompositesBrowserVerification({
  workspaceRoot = defaultWorkspaceRoot,
} = {}) {
  const matrixErrors = validateCompositeScenarioMatrix(
    createCompositeScenarioMatrix(),
  );
  invariant(matrixErrors.length === 0, matrixErrors.join("; "));
  const evidenceParent = path.join(workspaceRoot, "output/playwright");
  const target = path.join(workspaceRoot, evidenceRelativePath);
  await mkdir(evidenceParent, { recursive: true });
  const candidate = await mkdtemp(
    path.join(evidenceParent, ".p2-04-candidate-"),
  );
  let server;
  let committed = false;
  try {
    const [versions, gitBefore] = await Promise.all([
      collectVersions(workspaceRoot),
      collectGit(workspaceRoot),
    ]);
    const standaloneAppRoot = await prepareProductionBuild(
      workspaceRoot,
      candidate,
    );
    server = await startServer({
      candidate,
      environment: "preview",
      standaloneAppRoot,
    });
    const previewGate = await probeRuntime(server);
    invariant(
      previewGate.healthStatus === 200 &&
        previewGate.localeStatuses.every((status) => status === 200),
      "preview must expose all eight composite locale routes",
    );
    const browserResult = await runMatrix({
      candidate,
      origin: server.origin,
      versions,
    });
    process.stdout.write("\n[p2-04 browser] native-chrome-200-percent-pt\n");
    const nativeZoom = await runNativeZoom({
      candidate,
      origin: server.origin,
      workspaceRoot,
    });
    browserResult.screenshots.push(...nativeZoom.screenshots);
    await stopServer(server);
    server = undefined;

    const closedGates = [];
    for (const environment of ["staging", "production"]) {
      const closedServer = await startServer({
        candidate,
        environment,
        standaloneAppRoot,
      });
      try {
        const gate = await probeRuntime(closedServer);
        invariant(
          gate.healthStatus === 200 &&
            gate.localeStatuses.every((status) => status === 404),
          `${environment} must hide every internal composite route`,
        );
        closedGates.push(gate);
      } finally {
        await stopServer(closedServer);
      }
    }
    const gitAfter = await collectGit(workspaceRoot);
    invariant(
      gitAfter.sha === gitBefore.sha &&
        gitAfter.sourceFingerprint === gitBefore.sourceFingerprint &&
        gitAfter.sourceFingerprintAlgorithm ===
          gitBefore.sourceFingerprintAlgorithm &&
        JSON.stringify(gitAfter.sourceFingerprintFiles) ===
          JSON.stringify(gitBefore.sourceFingerprintFiles) &&
        JSON.stringify(gitAfter.status) === JSON.stringify(gitBefore.status),
      "browser verification changed source workspace state",
    );
    const runtimeGates = [previewGate, ...closedGates];
    const generatedAt = new Date().toISOString();
    const evidence = {
      axeSummaries: browserResult.axeSummaries,
      generatedAt,
      git: { after: gitAfter, before: gitBefore },
      launch: {
        browserChannel: "chrome",
        headlessMatrix: true,
        nativeZoomHeaded: true,
        productionBuild: true,
      },
      matrix: createCompositeScenarioMatrix(),
      nativeZoom,
      result: "passed",
      runtimeGates,
      scenarioResults: browserResult.scenarioResults,
      schemaVersion: 1,
      screenshots: browserResult.screenshots,
      versions,
    };
    await writeFile(
      path.join(candidate, "screenshots.sha256"),
      browserResult.screenshots
        .map((entry) => `${entry.sha256}  ${entry.path}`)
        .join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(candidate, "README.md"),
      createEvidenceReadme(evidence),
      "utf8",
    );
    await writeFile(
      path.join(candidate, "browser-results.json"),
      JSON.stringify(evidence, null, 2) + "\n",
      "utf8",
    );
    await replaceCompositeEvidenceDirectory(candidate, target);
    committed = true;
    process.stdout.write(`\nP2-04 browser verification passed: ${target}\n`);
    return evidence;
  } finally {
    await stopServer(server);
    if (!committed) {
      await rm(candidate, { force: true, recursive: true });
    }
  }
}

if (process.argv[1] === scriptPath) {
  await runUiCompositesBrowserVerification().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  });
}
