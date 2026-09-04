/* global AbortSignal, CSS, HTMLElement, URL, document, fetch, getComputedStyle, matchMedia, setTimeout, window */

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assessNativeScreenshotEvidence,
  assessNativeZoomMeasurements,
  createNativeZoomLaunchOptions,
  createNativeZoomProfilePreferences,
  readPngDimensions,
  summarizeAxeResult,
} from "./verify-ui-primitives-browser.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const evidenceRelativePath = "output/playwright/p2-03";
const fixtureRoot = "/_internal/design-foundations";
const fixtureSuffix = "/interactions";
const rerunCommand =
  "mise exec node@24.20.0 -- node scripts/verify-ui-interactions-browser.mjs";
const nativeZoomLocale = "pt";
const nativeZoomPercent = 200;
const nativeZoomMethod =
  "Chrome HostZoomMap default zoom preference loaded from an isolated temporary profile; no device-metrics, page-scale, or viewport emulation";
const nativeZoomScreenshots = Object.freeze({
  baseline: "zoom/google-chrome-baseline-pt.png",
  zoomed: "zoom/google-chrome-200-percent-pt.png",
});
const supportedPreviewLocaleList = Object.freeze([
  "en",
  "en-XA",
  "es",
  "ja",
  "pt",
  "th",
  "vi",
  "zh-CN",
]);
const supportedPreviewLocales = new Set(supportedPreviewLocaleList);
const interactionTextRootSelectors = Object.freeze([
  "main",
  ".fs-menu__popup",
  ".fs-dialog__popup",
  ".fs-drawer__popup",
  ".fs-toast",
]);
const expectedEvidenceVersions = Object.freeze({
  axe: "4.13.0",
  next: "16.3.4",
  node: "v24.20.0",
  playwright: "1.62.1",
  pnpm: "11.25.0",
  react: "19.2.8",
});
const expectedLaunchProvenance = Object.freeze({
  browserChannel: "chrome",
  browserEngine: "chromium",
  headless: true,
  nativeZoomHeaded: true,
  nativeZoomProfile: "isolated temporary profile",
  productionBuild: true,
  server: "Next.js standalone",
});
const axeExclusionPolicy = Object.freeze([
  Object.freeze({
    rationale:
      "Base UI focus guards are aria-hidden sentinels that immediately redirect focus; component focus containment is verified separately",
    selector: "[data-base-ui-focus-guard]",
    upstream: "https://github.com/mui/base-ui/issues/4845",
  }),
]);
const requiredAxeIds = Object.freeze([
  "base-desktop",
  "base-mobile",
  "dialog",
  "drawer",
  "menu",
  "pseudo-320",
  "reduced-motion",
  "toast",
]);
const requiredAxeIdSet = new Set(requiredAxeIds);
const requiredBaselineCases = Object.freeze([
  Object.freeze([360, 800, "en"]),
  Object.freeze([390, 844, "vi"]),
  Object.freeze([768, 1024, "th"]),
  Object.freeze([1024, 768, "zh-CN"]),
  Object.freeze([1440, 900, "ja"]),
  Object.freeze([1920, 1080, "es"]),
]);

export function createAxeExclusionPolicy() {
  return axeExclusionPolicy.map((entry) => ({ ...entry }));
}

function axeScan(id, state = "default") {
  return Object.freeze({ id, state });
}

function scenario(input) {
  return Object.freeze({
    ...input,
    axe: Object.freeze(input.axe ?? []),
    checks: Object.freeze(input.checks ?? []),
    viewport: Object.freeze(input.viewport),
  });
}

const interactionScenarioMatrix = Object.freeze([
  scenario({
    axe: [],
    group: "baseline",
    id: "viewport-360x800-en",
    locale: "en",
    screenshot: "viewports/360x800-en.png",
    viewport: { height: 800, width: 360 },
  }),
  scenario({
    axe: [axeScan("base-mobile")],
    group: "baseline",
    id: "viewport-390x844-vi",
    locale: "vi",
    screenshot: "viewports/390x844-vi-drawer.png",
    screenshotState: "drawer",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    group: "baseline",
    id: "viewport-768x1024-th",
    locale: "th",
    screenshot: "viewports/768x1024-th-menu.png",
    screenshotState: "menu",
    viewport: { height: 1024, width: 768 },
  }),
  scenario({
    axe: [],
    group: "baseline",
    id: "viewport-1024x768-zh-cn",
    locale: "zh-CN",
    screenshot: "viewports/1024x768-zh-CN.png",
    viewport: { height: 768, width: 1024 },
  }),
  scenario({
    axe: [axeScan("base-desktop")],
    checks: ["drawer-outside"],
    group: "baseline",
    id: "viewport-1440x900-ja",
    locale: "ja",
    screenshot: "viewports/1440x900-ja-dialog.png",
    screenshotState: "dialog",
    viewport: { height: 900, width: 1440 },
  }),
  scenario({
    axe: [],
    group: "baseline",
    id: "viewport-1920x1080-es",
    locale: "es",
    screenshot: "viewports/1920x1080-es.png",
    viewport: { height: 1080, width: 1920 },
  }),
  scenario({
    axe: [axeScan("pseudo-320")],
    group: "stress",
    id: "stress-320x800-en-xa",
    locale: "en-XA",
    screenshot: "stress/320x800-en-XA-menu.png",
    screenshotState: "menu",
    viewport: { height: 800, width: 320 },
  }),
  scenario({
    axe: [],
    group: "stress",
    id: "stress-320x800-pt",
    locale: "pt",
    screenshot: "stress/320x800-pt-long.png",
    viewport: { height: 800, width: 320 },
  }),
  scenario({
    axe: [
      axeScan("dialog", "dialog"),
      axeScan("drawer", "drawer"),
      axeScan("menu", "menu"),
      axeScan("toast", "toast"),
    ],
    checks: ["dialog", "drawer", "menu", "toast", "locale-region"],
    group: "interaction",
    id: "interaction-390x844-en-to-ja",
    locale: "en",
    screenshot: "interactions/390x844-ja-after-isolation.png",
    screenshotState: "toast",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    checks: ["touch-menu"],
    group: "touch",
    hasTouch: true,
    id: "touch-menu-390x844-en",
    isMobile: true,
    locale: "en",
    screenshot: "interactions/390x844-en-touch-menu.png",
    screenshotState: "touch-menu",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    checks: ["rtl"],
    direction: "rtl",
    group: "direction",
    id: "rtl-1440x900-en",
    locale: "en",
    screenshot: "rtl/1440x900-en-menu.png",
    screenshotState: "menu",
    viewport: { height: 900, width: 1440 },
  }),
  scenario({
    axe: [axeScan("reduced-motion")],
    group: "reduced-motion",
    id: "reduced-motion-390x844-en",
    locale: "en",
    reducedMotion: true,
    screenshot: "reduced-motion/390x844-en-dialog.png",
    screenshotState: "dialog",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    group: "reduced-motion",
    id: "reduced-motion-1440x900-pt",
    locale: "pt",
    reducedMotion: true,
    screenshot: "reduced-motion/1440x900-pt-drawer.png",
    screenshotState: "drawer",
    viewport: { height: 900, width: 1440 },
  }),
]);

export function createInteractionScenarioMatrix() {
  return interactionScenarioMatrix;
}

export function isSafeRelativeArtifactPath(value, extension) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-z]:/iu.test(value) ||
    path.posix.extname(value) !== extension
  ) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return (
    normalized === value &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.split("/").some((segment) => segment === "..")
  );
}

function caseKey(width, height, locale) {
  return [width, height, locale].join("x");
}

export function validateInteractionScenarioMatrix(matrix) {
  const errors = [];
  if (!Array.isArray(matrix)) {
    return ["interaction scenario matrix must be an array"];
  }

  const ids = new Set();
  const screenshots = new Set();
  const axeIds = [];
  for (const entry of matrix) {
    if (!isRecord(entry)) {
      errors.push("every interaction scenario must be an object");
      continue;
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9-]+$/u.test(entry.id)) {
      errors.push("every interaction scenario needs a stable lowercase id");
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
    if (!supportedPreviewLocales.has(entry.locale)) {
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
        !isRecord(scan) ||
        typeof scan.id !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(scan.id)
      ) {
        errors.push(
          "scenario " + String(entry.id) + " has an invalid axe scan id",
        );
        continue;
      }
      axeIds.push(scan.id);
      if (!requiredAxeIdSet.has(scan.id)) {
        errors.push("scenario " + entry.id + " has an unapproved axe scan id");
      }
    }
  }

  const baselineKeys = matrix
    .filter((entry) => entry?.group === "baseline")
    .map((entry) =>
      caseKey(entry.viewport?.width, entry.viewport?.height, entry.locale),
    );
  const requiredBaselineKeys = requiredBaselineCases.map(
    ([width, height, locale]) => caseKey(width, height, locale),
  );
  if (
    baselineKeys.length !== requiredBaselineKeys.length ||
    requiredBaselineKeys.some((key) => !baselineKeys.includes(key))
  ) {
    errors.push("matrix must contain all six exact baseline viewport cases");
  }
  for (const locale of supportedPreviewLocales) {
    if (!matrix.some((entry) => entry?.locale === locale)) {
      errors.push("matrix must cover preview locale " + locale);
    }
  }
  if (
    !matrix.some(
      (entry) => entry?.locale === "en-XA" && entry.viewport?.width === 320,
    )
  ) {
    errors.push("matrix must contain the 320px en-XA stress case");
  }
  const interaction = matrix.find(
    (entry) => entry?.id === "interaction-390x844-en-to-ja",
  );
  for (const check of ["dialog", "drawer", "menu", "toast", "locale-region"]) {
    if (!interaction?.checks?.includes(check)) {
      errors.push("390px interaction scenario must include " + check);
    }
  }
  const touchMenu = matrix.find(
    (entry) => entry?.id === "touch-menu-390x844-en",
  );
  if (
    touchMenu?.hasTouch !== true ||
    touchMenu?.isMobile !== true ||
    !touchMenu?.checks?.includes("touch-menu")
  ) {
    errors.push("matrix must contain a 390px mobile touch Menu lock case");
  }
  const rtl = matrix.find((entry) => entry?.id === "rtl-1440x900-en");
  if (
    rtl?.direction !== "rtl" ||
    rtl?.viewport?.width !== 1440 ||
    rtl?.viewport?.height !== 900 ||
    rtl?.screenshotState !== "menu" ||
    !rtl?.checks?.includes("rtl")
  ) {
    errors.push("matrix must contain the exact 1440px RTL interaction case");
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
  for (const requiredId of requiredAxeIds) {
    if (axeIds.filter((id) => id === requiredId).length !== 1) {
      errors.push("matrix must contain one axe scan named " + requiredId);
    }
  }

  return errors;
}

export function classifyBrowserResource(resourceUrl, expectedOrigin) {
  let parsed;
  let origin;
  try {
    parsed = new URL(resourceUrl);
    origin = new URL(expectedOrigin).origin;
  } catch {
    return { allowed: false, reason: "invalid-url" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { allowed: false, reason: "embedded-credentials" };
  }
  if (parsed.protocol === "about:" || parsed.protocol === "data:") {
    return { allowed: true, reason: "embedded" };
  }
  if (parsed.protocol === "blob:") {
    return parsed.origin === origin
      ? { allowed: true, reason: "embedded" }
      : { allowed: false, reason: "external-origin" };
  }
  return parsed.origin === origin
    ? { allowed: true, reason: "same-origin" }
    : { allowed: false, reason: "external-origin" };
}

export function classifyOverlayFocus(focus) {
  if (focus?.popupContainsActive === true) {
    return "inside";
  }
  if (focus?.baseUiFocusGuard === true && focus?.focusGuardType === "inside") {
    return "transient-inside-guard";
  }
  return "outside";
}

export function matchesActiveMenuItem(item, expectedText) {
  return (
    item?.role === "menuitemradio" &&
    item?.text === expectedText &&
    expectedText !== ""
  );
}

export function assessInteractionMeasurements(metrics) {
  const errors = [];
  const documentMetrics = metrics?.document;
  if (
    !isRecord(metrics) ||
    !Array.isArray(metrics.clippedText) ||
    !Array.isArray(metrics.controls) ||
    !Array.isArray(metrics.surfaces) ||
    !isRecord(documentMetrics) ||
    !isFiniteNumber(documentMetrics?.bodyScrollWidth) ||
    !isFiniteNumber(documentMetrics?.clientWidth) ||
    !isFiniteNumber(documentMetrics?.scrollWidth) ||
    typeof metrics.fontsStatus !== "string" ||
    !Number.isSafeInteger(metrics.replacementGlyphs) ||
    metrics.replacementGlyphs < 0
  ) {
    errors.push(
      "measurement inventory must include document, text, controls, surfaces, fonts, and glyphs",
    );
  }
  const clientWidth = documentMetrics?.clientWidth;
  const scrollWidth =
    isFiniteNumber(documentMetrics?.scrollWidth) &&
    isFiniteNumber(documentMetrics?.bodyScrollWidth)
      ? Math.max(documentMetrics.scrollWidth, documentMetrics.bodyScrollWidth)
      : Number.NaN;
  if (
    !isFiniteNumber(clientWidth) ||
    clientWidth <= 0 ||
    !isFiniteNumber(scrollWidth) ||
    scrollWidth > clientWidth + 0.5
  ) {
    errors.push(
      "horizontal overflow: clientWidth=" +
        String(clientWidth) +
        " scrollWidth=" +
        String(scrollWidth),
    );
  }
  for (const clipped of metrics?.clippedText ?? []) {
    errors.push(
      "clipped text at " +
        String(clipped.selector) +
        ": " +
        String(clipped.reason),
    );
  }
  for (const control of metrics?.controls ?? []) {
    if (
      !isFiniteNumber(control?.width) ||
      !isFiniteNumber(control?.height) ||
      control.width < 48 ||
      control.height < 48
    ) {
      errors.push(
        "control below 48px: " +
          String(control?.label) +
          " is " +
          String(control?.width) +
          "x" +
          String(control?.height),
      );
    }
  }
  for (const surface of metrics?.surfaces ?? []) {
    const top = surface?.top;
    const bottom = surface?.bottom;
    const left = surface?.left;
    const right = surface?.right;
    const viewportHeight = surface?.viewportHeight;
    const viewportWidth = surface?.viewportWidth;
    if (
      !isFiniteNumber(top) ||
      !isFiniteNumber(bottom) ||
      !isFiniteNumber(left) ||
      !isFiniteNumber(right) ||
      !isFiniteNumber(viewportHeight) ||
      !isFiniteNumber(viewportWidth) ||
      top < -0.5 ||
      bottom > viewportHeight + 0.5 ||
      left < -0.5 ||
      right > viewportWidth + 0.5
    ) {
      errors.push(
        "surface outside viewport: " + String(surface?.label ?? "unknown"),
      );
    }
    if (
      !isFiniteNumber(surface?.scrollHeight) ||
      !isFiniteNumber(surface?.clientHeight)
    ) {
      errors.push(
        "surface size must use finite numbers: " +
          String(surface?.label ?? "unknown"),
      );
    } else if (
      surface.scrollHeight > surface.clientHeight + 1 &&
      !["auto", "scroll"].includes(surface?.overflowY)
    ) {
      errors.push(
        "overflowing surface must be scrollable: " +
          String(surface?.label ?? "unknown"),
      );
    }
  }
  if (
    isFiniteNumber(metrics?.replacementGlyphs) &&
    metrics.replacementGlyphs > 0
  ) {
    errors.push(
      "replacement glyph count: " + String(metrics.replacementGlyphs),
    );
  }
  if (metrics?.fontsStatus !== "loaded") {
    errors.push(
      "document fonts are not loaded: " + String(metrics?.fontsStatus),
    );
  }
  return errors;
}

export function createInteractionTextRootSelector() {
  return interactionTextRootSelectors.join(",");
}

function durationListIsZero(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .every((part) => Number.parseFloat(part) === 0);
}

export function assessReducedMotionMeasurements(measurement) {
  const errors = [];
  if (measurement?.matches !== true) {
    errors.push("prefers-reduced-motion media query must match");
  }
  if (!Array.isArray(measurement?.styles) || measurement.styles.length === 0) {
    errors.push("reduced motion proof must contain computed styles");
    return errors;
  }
  for (const style of measurement.styles) {
    if (
      !durationListIsZero(style?.animationDuration) ||
      !durationListIsZero(style?.animationDelay)
    ) {
      errors.push(String(style?.label) + " animation must be disabled");
    }
    if (
      !durationListIsZero(style?.transitionDuration) ||
      !durationListIsZero(style?.transitionDelay)
    ) {
      errors.push(String(style?.label) + " transition must be disabled");
    }
    if (
      style?.startingTransform !== undefined &&
      style.startingTransform !== "none"
    ) {
      errors.push(
        String(style?.label) + " starting transform must be disabled",
      );
    }
  }
  return errors;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function diagnosticErrors(diagnostics) {
  const errors = [];
  if (isRecord(diagnostics) && "requests" in diagnostics) {
    errors.push("browser diagnostics must not persist request URLs");
  }
  for (const key of [
    "console",
    "externalResources",
    "httpErrors",
    "pageErrors",
    "requestFailures",
  ]) {
    if (!Array.isArray(diagnostics?.[key])) {
      errors.push("browser diagnostics must contain " + key);
    } else if (diagnostics[key].length > 0) {
      errors.push(
        "browser diagnostics " +
          key +
          " must be empty, received " +
          String(diagnostics[key].length),
      );
    }
  }
  return errors;
}

function createDiagnosticEvidence(diagnostics) {
  return {
    console: diagnostics.console,
    externalResources: diagnostics.externalResources,
    httpErrors: diagnostics.httpErrors,
    pageErrors: diagnostics.pageErrors,
    requestFailures: diagnostics.requestFailures,
  };
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = new Date(value);
  return (
    Number.isFinite(timestamp.valueOf()) && timestamp.toISOString() === value
  );
}

function screenshotEvidenceMatches(left, right) {
  return (
    isRecord(left) &&
    isRecord(right) &&
    left.path === right.path &&
    left.sha256 === right.sha256 &&
    left.bytes === right.bytes &&
    left.pixelWidth === right.pixelWidth &&
    left.pixelHeight === right.pixelHeight
  );
}

function isLoopbackRuntimeOrigin(value) {
  try {
    const url = new URL(value);
    return (
      value === url.origin &&
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      /^\d+$/u.test(url.port) &&
      Number(url.port) > 0 &&
      Number(url.port) <= 65_535 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function hasFixturePath(value, locale, expectedOrigin) {
  try {
    const url = new URL(value);
    return (
      url.origin === expectedOrigin &&
      url.pathname === fixturePath(locale) &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function hasNativeFixturePath(value, expectedOrigin) {
  return hasFixturePath(value, nativeZoomLocale, expectedOrigin);
}

function createFixtureEvidenceUrl(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href;
}

function hasFiniteNativeMeasurement(measurement) {
  return (
    isRecord(measurement) &&
    [
      measurement.devicePixelRatio,
      measurement.innerHeight,
      measurement.innerWidth,
      measurement.outerHeight,
      measurement.outerWidth,
      measurement.visualViewport?.height,
      measurement.visualViewport?.scale,
      measurement.visualViewport?.width,
    ].every((value) => isFiniteNumber(value) && value > 0)
  );
}

function hasScrollLockProof(proof) {
  return (
    isRecord(proof) &&
    proof.styleLocked === true &&
    typeof proof.bodyOverflow === "string" &&
    typeof proof.documentOverflow === "string" &&
    [proof.bodyOverflow, proof.documentOverflow].some((value) =>
      ["hidden", "clip"].includes(value),
    ) &&
    isFiniteNumber(proof.maxScroll) &&
    proof.maxScroll > 0 &&
    isFiniteNumber(proof.scrollY) &&
    isFiniteNumber(proof.afterScrollY) &&
    Math.abs(proof.afterScrollY - proof.scrollY) <= 1 &&
    isFiniteNumber(proof.delta) &&
    proof.delta !== 0
  );
}

export function isScrollReleaseMeasurement(proof) {
  return (
    isRecord(proof) &&
    proof.attributeRemoved === true &&
    typeof proof.bodyOverflow === "string" &&
    typeof proof.documentOverflow === "string" &&
    ![proof.bodyOverflow, proof.documentOverflow].some((value) =>
      ["hidden", "clip"].includes(value),
    )
  );
}

function hasScrollReleaseProof(proof) {
  return isScrollReleaseMeasurement(proof) && proof.released === true;
}

function hasTouchScrollProof(proof) {
  return (
    isRecord(proof) &&
    isFiniteNumber(proof.beforeScrollY) &&
    isFiniteNumber(proof.afterScrollY) &&
    Math.abs(proof.afterScrollY - proof.beforeScrollY) <= 1
  );
}

function measurementsMatchViewport(metrics, width, height) {
  const documentMetrics = metrics?.document;
  const maximumClassicScrollbarWidth = 24;
  return (
    isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    isFiniteNumber(metrics?.viewportWidth) &&
    isFiniteNumber(metrics?.viewportHeight) &&
    Math.abs(metrics.viewportWidth - width) <= 0.5 &&
    Math.abs(metrics.viewportHeight - height) <= 0.5 &&
    isRecord(documentMetrics) &&
    isFiniteNumber(documentMetrics.clientWidth) &&
    documentMetrics.clientWidth > 0 &&
    documentMetrics.clientWidth <= width + 0.5 &&
    documentMetrics.clientWidth >= width - maximumClassicScrollbarWidth - 0.5 &&
    isFiniteNumber(documentMetrics.scrollWidth) &&
    documentMetrics.scrollWidth >= documentMetrics.clientWidth - 0.5 &&
    documentMetrics.scrollWidth <= width + 0.5 &&
    isFiniteNumber(documentMetrics.bodyScrollWidth) &&
    documentMetrics.bodyScrollWidth >= documentMetrics.clientWidth - 0.5 &&
    documentMetrics.bodyScrollWidth <= width + 0.5 &&
    Array.isArray(metrics?.surfaces) &&
    metrics.surfaces.every(
      (surface) =>
        isFiniteNumber(surface?.viewportWidth) &&
        isFiniteNumber(surface?.viewportHeight) &&
        Math.abs(surface.viewportWidth - width) <= 0.5 &&
        Math.abs(surface.viewportHeight - height) <= 0.5,
    )
  );
}

function hasOverlayLifecycleProof(overlay, expectedCloseMethod) {
  return (
    overlay?.passed === true &&
    Number.isSafeInteger(overlay.focusableCount) &&
    overlay.focusableCount > 0 &&
    overlay.forwardTrap === true &&
    overlay.backwardTrap === true &&
    overlay.escapeRestoredFocus === true &&
    overlay.secondaryCloseRestoredFocus === true &&
    overlay.closeMethod === expectedCloseMethod &&
    hasScrollLockProof(overlay.scrollLock) &&
    hasScrollReleaseProof(overlay.scrollReleasedAfterEscape) &&
    hasScrollReleaseProof(overlay.scrollReleasedAfterSecondaryClose)
  );
}

function hasMenuLifecycleProof(menu) {
  const navigation = menu?.arrowNavigation;
  return (
    menu?.passed === true &&
    menu.disabledAria === true &&
    menu.disabledFocusable === true &&
    menu.disabledActivationBlocked === true &&
    Array.isArray(navigation) &&
    navigation.length === 4 &&
    navigation
      .slice(0, 3)
      .every((label) => typeof label === "string" && label.trim() !== "") &&
    new Set(navigation.slice(0, 3)).size === 3 &&
    navigation[3] === navigation[0] &&
    menu.homeEnd === true &&
    menu.typeahead === navigation[1] &&
    menu.escapeRestoredFocus === true &&
    hasScrollLockProof(menu.scrollLock) &&
    hasScrollReleaseProof(menu.scrollReleased)
  );
}

function validateRuntimeGates(runtimeGates) {
  const errors = [];
  const expected = new Map([
    ["preview", 200],
    ["staging", 404],
    ["production", 404],
  ]);
  if (!Array.isArray(runtimeGates) || runtimeGates.length !== expected.size) {
    return ["runtime evidence must contain preview, staging, and production"];
  }
  if (
    new Set(runtimeGates.map((gate) => gate?.environment)).size !==
    expected.size
  ) {
    errors.push("runtime evidence must contain unique environments");
  }
  for (const [environment, fixtureStatus] of expected) {
    const gate = runtimeGates.find(
      (candidate) => candidate?.environment === environment,
    );
    if (gate?.fixtureStatus !== fixtureStatus) {
      errors.push(
        environment +
          " fixture must return " +
          String(fixtureStatus) +
          ", received " +
          String(gate?.fixtureStatus),
      );
    }
    if (gate?.healthStatus !== 200) {
      errors.push(
        environment +
          " healthz must return 200, received " +
          String(gate?.healthStatus),
      );
    }
    if (!isLoopbackRuntimeOrigin(gate?.origin)) {
      errors.push(
        environment + " runtime origin must be an HTTP loopback origin",
      );
    }
    const fixtures = Array.isArray(gate?.fixtures) ? gate.fixtures : [];
    const fixtureLocales = fixtures.map((fixture) => fixture?.locale);
    if (
      fixtures.length !== supportedPreviewLocaleList.length ||
      new Set(fixtureLocales).size !== supportedPreviewLocaleList.length ||
      supportedPreviewLocaleList.some(
        (locale) => !fixtureLocales.includes(locale),
      )
    ) {
      errors.push(
        environment + " runtime gate must cover all 8 preview locales",
      );
      continue;
    }
    for (const locale of supportedPreviewLocaleList) {
      const fixture = fixtures.find(
        (candidate) => candidate?.locale === locale,
      );
      const expectedMarker = environment === "preview";
      if (
        fixture?.status !== fixtureStatus ||
        fixture?.containsFixtureMarker !== expectedMarker
      ) {
        errors.push(
          environment +
            " locale " +
            locale +
            " must return " +
            String(fixtureStatus) +
            " with fixture marker " +
            String(expectedMarker),
        );
      }
    }
  }
  return errors;
}

export function validateEvidenceBundle(evidence) {
  const errors = [];
  if (!isRecord(evidence) || evidence.schemaVersion !== 1) {
    return ["browser evidence must use schemaVersion 1"];
  }
  if (evidence.result !== "passed") {
    errors.push("browser evidence result must be passed");
  }
  if (!isCanonicalIsoTimestamp(evidence.generatedAt)) {
    errors.push("generatedAt must be a canonical ISO timestamp");
  }
  const versions = evidence.versions;
  if (
    !isRecord(versions) ||
    Object.entries(expectedEvidenceVersions).some(
      ([name, version]) => versions[name] !== version,
    ) ||
    !/^Google Chrome \d+(?:\.\d+){3}$/u.test(versions?.browser ?? "")
  ) {
    errors.push("toolchain versions must match the exact pinned release set");
  }
  if (
    !isRecord(evidence.launch) ||
    JSON.stringify(evidence.launch) !== JSON.stringify(expectedLaunchProvenance)
  ) {
    errors.push("launch provenance must describe the production Chrome run");
  }
  if (
    JSON.stringify(evidence.axeExclusions) !==
    JSON.stringify(createAxeExclusionPolicy())
  ) {
    errors.push(
      "axe exclusion policy must contain only the exact audited Base UI focus guard selector",
    );
  }
  const matrixErrors = validateInteractionScenarioMatrix(evidence.matrix);
  errors.push(...matrixErrors.map((error) => "evidence matrix: " + error));
  if (
    JSON.stringify(evidence.matrix) !==
    JSON.stringify(createInteractionScenarioMatrix())
  ) {
    errors.push("evidence must contain the exact interaction scenario matrix");
  }
  errors.push(...validateRuntimeGates(evidence.runtimeGates));
  const previewOrigin = evidence.runtimeGates?.find(
    (gate) => gate?.environment === "preview",
  )?.origin;
  const hasCompleteGitProvenance =
    isRecord(evidence.git) &&
    /^[a-f0-9]{40}$/u.test(evidence.git.sha ?? "") &&
    typeof evidence.git.dirty === "boolean" &&
    Array.isArray(evidence.git.status) &&
    evidence.git.rechecked === true;
  if (!hasCompleteGitProvenance) {
    errors.push("git provenance is incomplete");
  } else if (evidence.git.dirty || evidence.git.status.length > 0) {
    errors.push("browser evidence must come from a clean committed checkout");
  }

  const expectedScenarioIds = interactionScenarioMatrix.map(({ id }) => id);
  const scenarioResults = Array.isArray(evidence.scenarioResults)
    ? evidence.scenarioResults
    : [];
  const resultIds = scenarioResults.map((result) => result?.id);
  if (
    scenarioResults.length !== expectedScenarioIds.length ||
    new Set(resultIds).size !== expectedScenarioIds.length ||
    expectedScenarioIds.some((id) => !resultIds.includes(id))
  ) {
    errors.push("scenario result set must match the exact matrix");
  }
  for (const result of scenarioResults) {
    if (!Array.isArray(result?.errors) || result.errors.length > 0) {
      errors.push("scenario " + String(result?.id) + " must have no errors");
    }
    errors.push(
      ...assessInteractionMeasurements(result?.metrics).map(
        (error) => "scenario " + String(result?.id) + ": " + error,
      ),
      ...diagnosticErrors(result?.diagnostics).map(
        (error) => "scenario " + String(result?.id) + ": " + error,
      ),
    );
    const matrixEntry = interactionScenarioMatrix.find(
      ({ id }) => id === result?.id,
    );
    if (
      matrixEntry !== undefined &&
      !measurementsMatchViewport(
        result?.metrics,
        matrixEntry.viewport.width,
        matrixEntry.viewport.height,
      )
    ) {
      errors.push(
        "scenario " + String(result?.id) + " document viewport is inconsistent",
      );
    }
    const expectedDocumentLanguage =
      result?.id === "interaction-390x844-en-to-ja"
        ? "ja"
        : matrixEntry?.locale;
    const expectedDocumentDirection = matrixEntry?.direction ?? "";
    if (
      matrixEntry !== undefined &&
      (result.locale !== matrixEntry.locale ||
        result.documentLanguage !== expectedDocumentLanguage ||
        result.documentDirection !== expectedDocumentDirection ||
        !hasFixturePath(result.fixtureUrl, matrixEntry.locale, previewOrigin) ||
        result.screenshot !== matrixEntry.screenshot ||
        JSON.stringify(result.viewport) !==
          JSON.stringify(matrixEntry.viewport))
    ) {
      errors.push("scenario " + result.id + " metadata does not match matrix");
    }
  }

  const interaction = scenarioResults.find(
    (result) => result?.id === "interaction-390x844-en-to-ja",
  );
  for (const [key, label] of [
    ["dialog", "dialog"],
    ["drawer", "drawer"],
    ["menu", "menu"],
    ["toast", "toast"],
    ["localeRegion", "locale and region"],
  ]) {
    if (interaction?.checks?.[key]?.passed !== true) {
      errors.push(label + " interaction proof must pass");
    }
  }
  const dialog = interaction?.checks?.dialog;
  const drawer = interaction?.checks?.drawer;
  for (const [overlay, label, expectedCloseMethod] of [
    [dialog, "Dialog", "outside"],
    [drawer, "Drawer", "button"],
  ]) {
    if (!hasOverlayLifecycleProof(overlay, expectedCloseMethod)) {
      errors.push(label + " focus and scroll lifecycle proof is incomplete");
    }
  }
  const menu = interaction?.checks?.menu;
  if (!hasMenuLifecycleProof(menu)) {
    errors.push("Menu keyboard and scroll lifecycle proof is incomplete");
  }
  const localeRegion = interaction?.checks?.localeRegion;
  if (
    localeRegion?.preservedOpaqueQuery !== true ||
    localeRegion?.preservedTransactionContext !== true ||
    localeRegion?.businessRequests !== 0
  ) {
    errors.push("locale and region isolation proof is incomplete");
  }
  const toast = interaction?.checks?.toast;
  if (
    toast?.announcementMutationCount !== 0 ||
    toast?.countAfterStableIdUpsert !== 1 ||
    toast?.focusStayedOnTrigger !== true ||
    toast?.hoverPauseReleased !== true ||
    toast?.keyboardManualDismissed !== true ||
    toast?.pointerOutsideViewport !== true ||
    toast?.timeoutDismissed !== true ||
    toast?.live !== "polite" ||
    toast?.role !== "dialog"
  ) {
    errors.push("Toast lifecycle proof is incomplete");
  }
  if (
    toast?.totalAfterLimit !== 4 ||
    toast?.limitedAfterLimit !== 1 ||
    toast?.visibleAfterLimit !== 3
  ) {
    errors.push("Toast limit proof must show exactly three of four items");
  }
  const touchMenu = scenarioResults.find(
    (result) => result?.id === "touch-menu-390x844-en",
  );
  if (touchMenu?.checks?.touchMenu?.passed !== true) {
    errors.push("touch Menu scroll-lock proof must pass");
  }
  if (
    touchMenu?.checks?.touchMenu?.closeRestoredFocus !== true ||
    !hasScrollLockProof(touchMenu?.checks?.touchMenu?.wheel) ||
    !hasTouchScrollProof(touchMenu?.checks?.touchMenu?.touch) ||
    !hasScrollReleaseProof(touchMenu?.checks?.touchMenu?.scrollReleased)
  ) {
    errors.push("touch Menu close lifecycle proof is incomplete");
  }
  const thaiPortal = scenarioResults.find(
    (result) => result?.id === "viewport-768x1024-th",
  );
  if (
    thaiPortal?.checks?.portalLanguage?.passed !== true ||
    thaiPortal.checks.portalLanguage.inheritedLanguage !== "th"
  ) {
    errors.push("Thai portal language inheritance proof must pass");
  }
  const desktopDrawer = scenarioResults.find(
    (result) => result?.id === "viewport-1440x900-ja",
  );
  if (
    desktopDrawer?.checks?.drawerOutside?.passed !== true ||
    !hasScrollLockProof(desktopDrawer?.checks?.drawerOutside?.scrollLock) ||
    !hasScrollReleaseProof(desktopDrawer?.checks?.drawerOutside?.scrollReleased)
  ) {
    errors.push("desktop Drawer outside-dismissal proof must pass");
  }
  const rtl = scenarioResults.find(
    (result) => result?.id === "rtl-1440x900-en",
  );
  const rtlProof = rtl?.checks?.rtl;
  const rtlDrawer = rtlProof?.drawer;
  const rtlMenu = rtlProof?.menu;
  const drawerEdgeGap = rtlDrawer?.edgeGap;
  const drawerOppositeGap = rtlDrawer?.oppositeGap;
  const drawerWidth = rtlDrawer?.width;
  const drawerViewportWidth = rtlDrawer?.viewportWidth;
  const drawerLeft = rtlDrawer?.left;
  const drawerRight = rtlDrawer?.right;
  const menuAlignmentDelta = rtlMenu?.alignmentDelta;
  const menuTriggerRight = rtlMenu?.triggerRight;
  const menuPopupRight = rtlMenu?.popupRight;
  const indicatorCenterX = rtlMenu?.indicatorCenterX;
  const copyCenterX = rtlMenu?.copyCenterX;
  if (
    rtlProof?.passed !== true ||
    rtlProof?.direction !== "rtl" ||
    rtlDrawer?.dataSide !== "inline-end" ||
    rtlDrawer?.direction !== "rtl" ||
    rtlDrawer?.inlineEndPhysicalSide !== "left" ||
    !isFiniteNumber(drawerEdgeGap) ||
    drawerEdgeGap < 0 ||
    drawerEdgeGap > 1 ||
    !isFiniteNumber(drawerOppositeGap) ||
    drawerOppositeGap <= 1 ||
    !isFiniteNumber(drawerWidth) ||
    !isFiniteNumber(drawerViewportWidth) ||
    !isFiniteNumber(drawerLeft) ||
    !isFiniteNumber(drawerRight) ||
    drawerWidth <= 0 ||
    drawerWidth >= drawerViewportWidth - 1 ||
    Math.abs(Math.abs(drawerLeft) - drawerEdgeGap) > 0.1 ||
    Math.abs(Math.abs(drawerViewportWidth - drawerRight) - drawerOppositeGap) >
      0.1 ||
    Math.abs(drawerRight - drawerLeft - drawerWidth) > 0.1 ||
    rtlDrawer?.focusInside !== true ||
    rtlDrawer?.focusVisible !== true ||
    rtlDrawer?.escapeRestoredFocus !== true ||
    !hasScrollLockProof(rtlDrawer?.scrollLock) ||
    !hasScrollReleaseProof(rtlDrawer?.scrollReleased) ||
    assessInteractionMeasurements(rtlDrawer?.metrics).length > 0 ||
    !measurementsMatchViewport(
      rtlDrawer?.metrics,
      rtl?.viewport?.width,
      rtl?.viewport?.height,
    ) ||
    !rtlDrawer?.metrics?.surfaces?.some(
      (surface) => surface?.label === "fs-drawer__popup",
    ) ||
    rtlMenu?.direction !== "rtl" ||
    rtlMenu?.activeItemDirection !== "rtl" ||
    rtlMenu?.itemCount !== 3 ||
    rtlMenu?.indicatorCount !== 3 ||
    rtlMenu?.selectedIndicatorVisible !== true ||
    rtlMenu?.uncheckedIndicatorCount !== 2 ||
    rtlMenu?.uncheckedIndicatorsHidden !== true ||
    rtlMenu?.indicatorPhysicalSide !== "right" ||
    rtlMenu?.indicatorInlineStart !== true ||
    !isFiniteNumber(indicatorCenterX) ||
    !isFiniteNumber(copyCenterX) ||
    indicatorCenterX <= copyCenterX ||
    rtlMenu?.highlightLogicalRail !== true ||
    rtlMenu?.highlightPhysicalSide !== "right" ||
    rtlMenu?.highlightInsetInlineStart !== "0px" ||
    rtlMenu?.highlightRight !== "0px" ||
    rtlMenu?.popupStartAligned !== true ||
    !isFiniteNumber(menuAlignmentDelta) ||
    menuAlignmentDelta > 2 ||
    !isFiniteNumber(menuTriggerRight) ||
    !isFiniteNumber(menuPopupRight) ||
    Math.abs(Math.abs(menuPopupRight - menuTriggerRight) - menuAlignmentDelta) >
      0.1 ||
    rtlMenu?.activeItemMoved !== true ||
    rtlMenu?.activeHighlighted !== true ||
    rtlMenu?.focusInside !== true ||
    rtlMenu?.focusVisible !== true ||
    rtlMenu?.escapeRestoredFocus !== true ||
    !hasScrollLockProof(rtlMenu?.scrollLock) ||
    !hasScrollReleaseProof(rtlMenu?.scrollReleased) ||
    assessInteractionMeasurements(rtlMenu?.metrics).length > 0 ||
    !measurementsMatchViewport(
      rtlMenu?.metrics,
      rtl?.viewport?.width,
      rtl?.viewport?.height,
    ) ||
    !rtlMenu?.metrics?.surfaces?.some(
      (surface) => surface?.label === "fs-menu__popup",
    )
  ) {
    errors.push("RTL interaction proof must cover Drawer and Menu semantics");
  }
  for (const entry of interactionScenarioMatrix.filter(
    ({ reducedMotion }) => reducedMotion === true,
  )) {
    const result = scenarioResults.find(
      (candidate) => candidate?.id === entry.id,
    );
    const reducedMotion = result?.checks?.reducedMotion;
    const labels = new Set(
      Array.isArray(reducedMotion?.styles)
        ? reducedMotion.styles.map((style) => style?.label)
        : [],
    );
    if (
      reducedMotion?.passed !== true ||
      assessReducedMotionMeasurements(reducedMotion).length > 0
    ) {
      errors.push(entry.id + " reduced motion proof must pass");
    }
    if (
      !["dialog", "drawer", "menu", "toast"].every((label) => labels.has(label))
    ) {
      errors.push(entry.id + " must cover all interaction surfaces");
    }
    if (
      !["dialog", "drawer", "menu", "toast"].every((label) =>
        reducedMotion?.styles?.some(
          (style) =>
            style?.label === label && style?.startingTransform === "none",
        ),
      )
    ) {
      errors.push(
        entry.id + " reduced motion proof must remove start transforms",
      );
    }
  }

  const expectedAxe = interactionScenarioMatrix.flatMap((entry) =>
    entry.axe.map(({ id, state }) => ({ id, scenarioId: entry.id, state })),
  );
  const axeSummaries = Array.isArray(evidence.axeSummaries)
    ? evidence.axeSummaries
    : [];
  if (
    axeSummaries.length !== expectedAxe.length ||
    new Set(axeSummaries.map((summary) => summary?.id)).size !==
      expectedAxe.length
  ) {
    errors.push("axe summary set must contain all eight unique scans");
  }
  for (const expected of expectedAxe) {
    const summary = axeSummaries.find(
      (candidate) => candidate?.id === expected.id,
    );
    if (
      summary?.scenarioId !== expected.scenarioId ||
      summary?.state !== expected.state ||
      summary?.artifact !== `axe-results/${expected.id}.json` ||
      !Array.isArray(summary?.blocking) ||
      summary.blocking.length > 0 ||
      !isRecord(summary?.counts)
    ) {
      errors.push("axe scan " + expected.id + " is incomplete or blocking");
    }
  }

  const expectedScreenshotPaths = [
    ...interactionScenarioMatrix.map(({ screenshot }) => screenshot),
    ...Object.values(nativeZoomScreenshots),
  ];
  const screenshots = Array.isArray(evidence.screenshots)
    ? evidence.screenshots
    : [];
  const screenshotPaths = screenshots.map((screenshot) => screenshot?.path);
  if (
    screenshots.length !== expectedScreenshotPaths.length ||
    new Set(screenshotPaths).size !== expectedScreenshotPaths.length ||
    expectedScreenshotPaths.some(
      (screenshotPath) => !screenshotPaths.includes(screenshotPath),
    )
  ) {
    errors.push("screenshot set must match all scenarios and native zoom");
  }
  for (const screenshot of screenshots) {
    if (
      !isSafeRelativeArtifactPath(screenshot?.path, ".png") ||
      !/^[a-f0-9]{64}$/u.test(screenshot?.sha256 ?? "")
    ) {
      errors.push("screenshot evidence contains an unsafe path or hash");
    }
  }

  const nativeZoom = evidence.nativeZoom;
  if (
    !isRecord(nativeZoom) ||
    nativeZoom.zoomPercent !== nativeZoomPercent ||
    nativeZoom.profileRemoved !== true ||
    !Array.isArray(nativeZoom.screenshots) ||
    nativeZoom.screenshots.length !== 2
  ) {
    errors.push("native 200% zoom proof is incomplete");
  } else {
    const expectedBaselineZoomLevel =
      createNativeZoomProfilePreferences(100).partition.default_zoom_level.x;
    const expectedZoomLevel =
      createNativeZoomProfilePreferences(nativeZoomPercent).partition
        .default_zoom_level.x;
    if (
      nativeZoom.method !== nativeZoomMethod ||
      !isFiniteNumber(nativeZoom.preference?.baselineZoomLevel) ||
      !isFiniteNumber(nativeZoom.preference?.zoomLevel) ||
      Math.abs(
        nativeZoom.preference.baselineZoomLevel - expectedBaselineZoomLevel,
      ) > 1e-12 ||
      Math.abs(nativeZoom.preference.zoomLevel - expectedZoomLevel) > 1e-12
    ) {
      errors.push("native zoom method and HostZoomMap preference are invalid");
    }
    if (
      !hasFiniteNativeMeasurement(nativeZoom.baseline) ||
      !hasFiniteNativeMeasurement(nativeZoom.zoomed)
    ) {
      errors.push("native zoom measurement values must be finite numbers");
    }
    errors.push(
      ...assessNativeZoomMeasurements({
        baseline: nativeZoom.baseline,
        expectedPercent: nativeZoomPercent,
        zoomed: nativeZoom.zoomed,
      }).map((error) => "native zoom: " + error),
    );
    if (
      !isFiniteNumber(nativeZoom.detectedPercent) ||
      Math.abs(nativeZoom.detectedPercent - nativeZoomPercent) > 8
    ) {
      errors.push("native zoom detected percent must be approximately 200%");
    }
    if (nativeZoom.browser !== versions?.browser) {
      errors.push(
        "native zoom browser must match toolchain browser provenance",
      );
    }
    const nativePaths = nativeZoom.screenshots.map(
      (screenshot) => screenshot?.path,
    );
    if (
      Object.values(nativeZoomScreenshots).some(
        (screenshotPath) => !nativePaths.includes(screenshotPath),
      )
    ) {
      errors.push("native zoom screenshot set is incomplete");
    }
    errors.push(
      ...assessNativeScreenshotEvidence({
        baseline: {
          measurement: nativeZoom.baseline,
          screenshot: nativeZoom.baseline?.screenshotEvidence,
        },
        zoomed: {
          measurement: nativeZoom.zoomed,
          screenshot: nativeZoom.zoomed?.screenshotEvidence,
        },
      }).map((error) => "native zoom screenshot: " + error),
    );
    for (const [label, expectedPath] of Object.entries(nativeZoomScreenshots)) {
      const pass = nativeZoom[label];
      const nestedScreenshot = pass?.screenshotEvidence;
      const nativeScreenshot = nativeZoom.screenshots.find(
        (screenshot) => screenshot?.path === expectedPath,
      );
      const topLevelScreenshot = screenshots.find(
        (screenshot) => screenshot?.path === expectedPath,
      );
      errors.push(
        ...diagnosticErrors(pass?.diagnostics).map(
          (error) => "native zoom diagnostics " + label + ": " + error,
        ),
        ...assessInteractionMeasurements(pass?.metrics).map(
          (error) => "native zoom metrics " + label + ": " + error,
        ),
      );
      if (
        !measurementsMatchViewport(
          pass?.metrics,
          pass?.innerWidth,
          pass?.innerHeight,
        )
      ) {
        errors.push(
          "native zoom metrics " + label + " use an inconsistent viewport",
        );
      }
      if (!hasNativeFixturePath(pass?.fixtureUrl, previewOrigin)) {
        errors.push("native zoom fixture " + label + " must use pt");
      }
      if (
        pass?.screenshot !== expectedPath ||
        nestedScreenshot?.path !== expectedPath ||
        !screenshotEvidenceMatches(nestedScreenshot, nativeScreenshot) ||
        !screenshotEvidenceMatches(nestedScreenshot, topLevelScreenshot)
      ) {
        errors.push(
          "native zoom screenshot binding " + label + " is inconsistent",
        );
      }
      if (
        nestedScreenshot?.localeMarker?.changedFromHidden !== true ||
        nestedScreenshot?.localeMarker?.text?.toLowerCase() !== nativeZoomLocale
      ) {
        errors.push("native zoom locale marker " + label + " is incomplete");
      }
    }
    const languageMenu = nativeZoom.zoomed?.checks?.languageMenu;
    if (
      !hasOverlayLifecycleProof(nativeZoom.zoomed?.checks?.dialog, "outside")
    ) {
      errors.push("native zoom Dialog lifecycle proof is incomplete");
    }
    if (!hasMenuLifecycleProof(nativeZoom.zoomed?.checks?.menu)) {
      errors.push("native zoom Menu lifecycle proof is incomplete");
    }
    if (
      languageMenu?.passed !== true ||
      languageMenu?.itemCount !== 7 ||
      assessInteractionMeasurements(languageMenu?.metrics).length > 0 ||
      !measurementsMatchViewport(
        languageMenu?.metrics,
        nativeZoom.zoomed?.innerWidth,
        nativeZoom.zoomed?.innerHeight,
      ) ||
      !Array.isArray(languageMenu?.metrics?.surfaces) ||
      languageMenu.metrics.surfaces.length === 0
    ) {
      errors.push("native zoom Language menu proof is incomplete");
    }
  }

  return errors;
}

export function createEvidenceReadme({
  axeExclusions = [],
  axeSummaries = [],
  generatedAt,
  git,
  nativeZoom,
  runtimeGates = [],
  scenarioResults = [],
  screenshots = [],
  versions,
}) {
  const tick = String.fromCharCode(96);
  const lines = [
    "# P2-03 UI interaction browser verification",
    "",
    "Generated at " + generatedAt + ".",
    "",
    "## Provenance",
    "",
    "- Git SHA: " + tick + git.sha + tick,
    "- dirty: " + String(git.dirty),
    "- clean checkout rechecked after run: " + String(git.rechecked),
    "- Node " + tick + versions.node + tick,
    "- pnpm " + tick + versions.pnpm + tick,
    "- Next.js " + tick + versions.next + tick,
    "- React " + tick + versions.react + tick,
    "- Playwright " + tick + versions.playwright + tick,
    "- axe " + tick + versions.axe + tick,
    "- Browser " + tick + versions.browser + tick,
    "",
    "## Re-run",
    "",
    tick + tick + tick + "sh",
    rerunCommand,
    tick + tick + tick,
    "",
    "## Runtime gates",
    "",
  ];
  for (const gate of runtimeGates) {
    lines.push(
      "- " +
        gate.environment +
        ": fixture " +
        String(gate.fixtureStatus) +
        ", healthz " +
        String(gate.healthStatus) +
        ", all 8 preview locales verified",
    );
  }
  lines.push(
    "",
    "## Native Google Chrome zoom",
    "",
    "- Method: " + nativeZoom.method + ".",
    "- Zoom: " + String(nativeZoom.zoomPercent) + "%.",
    "- CSS viewport: " +
      String(nativeZoom.baseline.innerWidth) +
      "×" +
      String(nativeZoom.baseline.innerHeight) +
      " → " +
      String(nativeZoom.zoomed.innerWidth) +
      "×" +
      String(nativeZoom.zoomed.innerHeight) +
      ".",
    "- DPR: " +
      String(nativeZoom.baseline.devicePixelRatio) +
      " → " +
      String(nativeZoom.zoomed.devicePixelRatio) +
      ".",
    "- Isolated profile removed: " + String(nativeZoom.profileRemoved) + ".",
    "",
    "## Scenario results",
    "",
  );
  for (const result of scenarioResults) {
    lines.push(
      "- " +
        tick +
        result.id +
        tick +
        ": " +
        (result.errors.length === 0 ? "PASS" : "FAIL"),
    );
  }
  lines.push("", "## axe results", "");
  for (const scan of axeSummaries) {
    lines.push(
      "- " +
        tick +
        scan.id +
        tick +
        ": critical/serious " +
        String(scan.blocking.length) +
        ", full result " +
        tick +
        scan.artifact +
        tick,
    );
  }
  lines.push("", "## axe exclusions", "");
  for (const exclusion of axeExclusions) {
    lines.push(
      "- " +
        tick +
        exclusion.selector +
        tick +
        ": " +
        exclusion.rationale +
        " ([upstream](" +
        exclusion.upstream +
        "))",
    );
  }
  lines.push(
    "",
    "## Screenshot SHA-256",
    "",
    "| Evidence | SHA-256 |",
    "|:--|:--|",
  );
  for (const screenshot of screenshots) {
    lines.push(
      "| " +
        tick +
        screenshot.path +
        tick +
        " | " +
        tick +
        screenshot.sha256 +
        tick +
        " |",
    );
  }
  lines.push(
    "",
    "This is local production-build evidence under the preview gate. It is not staging or production deployment evidence, formal brand approval, or real-device performance evidence.",
    "",
  );
  return lines.join("\n");
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatError(error) {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

async function readJson(workspaceRoot, relativePath) {
  return JSON.parse(
    await readFile(path.join(workspaceRoot, relativePath), "utf8"),
  );
}

async function runCommand(
  command,
  arguments_,
  { cwd, env = process.env, logPath, stream = true },
) {
  const child = spawn(command, arguments_, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const capture = (chunk) => {
    const text = chunk.toString();
    output.push(text);
    if (stream) {
      process.stdout.write(text);
    }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const combinedOutput = output.join("");
  if (logPath !== undefined) {
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, combinedOutput, "utf8");
  }
  if (result.code !== 0) {
    throw new Error(
      [
        "command failed: " + [command, ...arguments_].join(" "),
        "exit=" + String(result.code) + " signal=" + String(result.signal),
        combinedOutput.slice(-4_000),
      ].join("\n"),
    );
  }
  return combinedOutput.trim();
}

async function captureCommand(command, arguments_, cwd) {
  return runCommand(command, arguments_, { cwd, stream: false });
}

async function collectToolchain(workspaceRoot) {
  const [rootManifest, storefrontManifest, playwrightPackage, axePackage] =
    await Promise.all([
      readJson(workspaceRoot, "package.json"),
      readJson(workspaceRoot, "apps/storefront/package.json"),
      readJson(workspaceRoot, "node_modules/@playwright/test/package.json"),
      readJson(workspaceRoot, "node_modules/@axe-core/playwright/package.json"),
    ]);
  const [expectedNode, pnpmVersion, nextPackage, reactPackage] =
    await Promise.all([
      readFile(path.join(workspaceRoot, ".node-version"), "utf8").then(
        (value) => value.trim(),
      ),
      captureCommand("corepack", ["pnpm", "--version"], workspaceRoot),
      readJson(workspaceRoot, "apps/storefront/node_modules/next/package.json"),
      readJson(
        workspaceRoot,
        "apps/storefront/node_modules/react/package.json",
      ),
    ]);
  const expectedPnpm = String(rootManifest.packageManager).replace(
    /^pnpm@/u,
    "",
  );
  invariant(
    process.versions.node === expectedNode,
    "runner requires Node " +
      expectedNode +
      ", received " +
      process.versions.node,
  );
  invariant(
    pnpmVersion === expectedPnpm,
    "runner requires pnpm " + expectedPnpm + ", received " + pnpmVersion,
  );
  invariant(
    playwrightPackage.version ===
      rootManifest.devDependencies?.["@playwright/test"],
    "installed Playwright must match the exact root manifest version",
  );
  invariant(
    axePackage.version ===
      rootManifest.devDependencies?.["@axe-core/playwright"],
    "installed axe adapter must match the exact root manifest version",
  );
  invariant(
    nextPackage.version === storefrontManifest.dependencies?.next,
    "installed Next.js must match the exact storefront manifest version",
  );
  invariant(
    reactPackage.version === storefrontManifest.dependencies?.react,
    "installed React must match the exact storefront manifest version",
  );
  return {
    axe: axePackage.version,
    browser: "pending",
    next: nextPackage.version,
    node: process.version,
    playwright: playwrightPackage.version,
    pnpm: pnpmVersion,
    react: reactPackage.version,
  };
}

async function collectGitProvenance(workspaceRoot, ignoredPath) {
  const [sha, status] = await Promise.all([
    captureCommand("git", ["rev-parse", "HEAD"], workspaceRoot),
    captureCommand(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      workspaceRoot,
    ),
  ]);
  const ignoredPrefix =
    ignoredPath === undefined
      ? undefined
      : path.relative(workspaceRoot, ignoredPath).split(path.sep).join("/") +
        "/";
  const statusEntries =
    status.length === 0
      ? []
      : status
          .split("\n")
          .filter(
            (entry) =>
              ignoredPrefix === undefined ||
              !entry.slice(3).startsWith(ignoredPrefix),
          );
  return {
    dirty: statusEntries.length > 0,
    sha,
    status: statusEntries,
  };
}

async function prepareProductionBuild(workspaceRoot, candidate) {
  const logsDirectory = path.join(candidate, "logs");
  for (const workspaceDirectory of ["apps", "packages"]) {
    const units = await readdir(path.join(workspaceRoot, workspaceDirectory), {
      withFileTypes: true,
    });
    await Promise.all(
      units
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          rm(path.join(workspaceRoot, workspaceDirectory, entry.name, "dist"), {
            force: true,
            recursive: true,
          }),
        ),
    );
  }
  await rm(path.join(workspaceRoot, "apps/storefront/.next"), {
    force: true,
    recursive: true,
  });
  await runCommand(
    "corepack",
    [
      "pnpm",
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@fan-support/storefront...",
      "--force",
      "--output-logs=full",
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
        FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
        NODE_ENV: "production",
      },
      logPath: path.join(logsDirectory, "build-storefront-closure.log"),
    },
  );

  const storefrontRoot = path.join(workspaceRoot, "apps/storefront");
  const standaloneAppRoot = path.join(
    storefrontRoot,
    ".next/standalone/apps/storefront",
  );
  const serverPath = path.join(standaloneAppRoot, "server.js");
  invariant(
    await pathExists(serverPath),
    "Next.js build did not create the standalone storefront server",
  );

  const staticSource = path.join(storefrontRoot, ".next/static");
  const staticTarget = path.join(standaloneAppRoot, ".next/static");
  await rm(staticTarget, { force: true, recursive: true });
  await mkdir(path.dirname(staticTarget), { recursive: true });
  await cp(staticSource, staticTarget, { recursive: true });
  const publicSource = path.join(storefrontRoot, "public");
  if (await pathExists(publicSource)) {
    const publicTarget = path.join(standaloneAppRoot, "public");
    await rm(publicTarget, { force: true, recursive: true });
    await cp(publicSource, publicTarget, { recursive: true });
  }
  return { standaloneAppRoot };
}

async function reserveLoopbackPort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  invariant(
    address !== null && typeof address === "object",
    "could not reserve a loopback port",
  );
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

function runtimeSiteOrigin(environment) {
  return environment === "preview"
    ? "https://localhost:3443"
    : "https://shop.example.invalid";
}

async function startStorefrontServer({
  candidate,
  environment,
  standaloneAppRoot,
}) {
  const port = await reserveLoopbackPort();
  const origin = "http://127.0.0.1:" + String(port);
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
    const text = chunk.toString();
    chunks.push(text);
    process.stdout.write(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  completion.catch(() => undefined);
  const server = {
    candidate,
    child,
    chunks,
    completion,
    environment,
    origin,
  };
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      if (child.exitCode !== null) {
        throw new Error(
          environment +
            " storefront exited before readiness\n" +
            chunks.join("").slice(-4_000),
        );
      }
      try {
        const response = await fetch(origin + "/healthz", {
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(2_000),
        });
        await response.body?.cancel();
        if (response.status === 200) {
          return server;
        }
      } catch {
        // Connection failures are expected until Next binds the reserved port.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      environment + " storefront did not become ready within 30s",
    );
  } catch (error) {
    await stopStorefrontServer(server).catch(() => undefined);
    throw error;
  }
}

async function stopStorefrontServer(server) {
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
    "server-" + server.environment + ".log",
  );
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, server.chunks.join(""), "utf8");
}

function fixturePath(locale) {
  return fixtureRoot + "/" + encodeURIComponent(locale) + fixtureSuffix;
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

async function fetchFixtureEvidence(origin, locale) {
  const response = await fetch(origin + fixturePath(locale), {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  return {
    containsFixtureMarker: body.includes("data-interaction-workspace"),
    locale,
    status: response.status,
  };
}

async function probeRuntime(server) {
  const [fixtures, healthStatus] = await Promise.all([
    Promise.all(
      supportedPreviewLocaleList.map((locale) =>
        fetchFixtureEvidence(server.origin, locale),
      ),
    ),
    fetchStatus(server.origin + "/healthz"),
  ]);
  const fixtureStatus = fixtures.find(({ locale }) => locale === "en")?.status;
  return {
    environment: server.environment,
    fixtures,
    fixtureStatus,
    healthStatus,
    origin: server.origin,
  };
}

function safeDiagnosticValue(value) {
  return String(value)
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 1_000);
}

async function observePage(page, context, expectedOrigin) {
  const diagnostics = {
    console: [],
    externalResources: [],
    httpErrors: [],
    pageErrors: [],
    requestFailures: [],
    requests: [],
  };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const classification = classifyBrowserResource(
      request.url(),
      expectedOrigin,
    );
    diagnostics.requests.push({
      allowed: classification.allowed,
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
    if (!classification.allowed) {
      diagnostics.externalResources.push({
        reason: classification.reason,
        url: request.url(),
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      diagnostics.console.push({
        text: safeDiagnosticValue(message.text()),
        type: message.type(),
      });
    }
  });
  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(safeDiagnosticValue(error.message));
  });
  page.on("requestfailed", (request) => {
    diagnostics.requestFailures.push({
      errorText: safeDiagnosticValue(
        request.failure()?.errorText ?? "unknown request failure",
      ),
      method: request.method(),
      url: request.url(),
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.httpErrors.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });
  return diagnostics;
}

async function settleFixturePage(page, locale, query = "") {
  const relativeUrl = fixturePath(locale) + query;
  const response = await page.goto(relativeUrl, {
    waitUntil: "domcontentloaded",
  });
  invariant(
    response?.status() === 200,
    "fixture " + locale + " must return 200",
  );
  const specimen = page.locator('main[data-ui-interactions="v1"]');
  await specimen.waitFor({ state: "visible" });
  invariant(
    (await specimen.getAttribute("lang")) === locale,
    "fixture locale marker must be " + locale,
  );
  await page.waitForFunction(
    (expectedLocale) => document.documentElement.lang === expectedLocale,
    locale,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return page.url();
}

async function waitForSurfaceMotion(locator) {
  await locator.waitFor({ state: "visible" });
  await locator.evaluate(async (element) => {
    const startedAt = Date.now();
    while (
      (element.hasAttribute("data-starting-style") ||
        Number.parseFloat(getComputedStyle(element).opacity) === 0) &&
      Date.now() - startedAt < 2_000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    if (
      element.hasAttribute("data-starting-style") ||
      Number.parseFloat(getComputedStyle(element).opacity) === 0
    ) {
      throw new Error("surface did not leave its starting motion state");
    }
    const animations = element
      .getAnimations({ subtree: false })
      .filter(
        ({ playState }) => playState === "pending" || playState === "running",
      );
    await Promise.race([
      Promise.allSettled(animations.map(({ finished }) => finished)),
      new Promise((_, reject) =>
        window.setTimeout(
          () => reject(new Error("surface motion did not finish")),
          2_000,
        ),
      ),
    ]);
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    );
    if (
      element
        .getAnimations({ subtree: false })
        .some(
          ({ playState }) => playState === "pending" || playState === "running",
        )
    ) {
      throw new Error("surface motion remained active after settling");
    }
  });
}

async function outsidePointForPopup(page, selector) {
  return page.evaluate((popupSelector) => {
    const popup = document.querySelector(popupSelector);
    if (!(popup instanceof HTMLElement)) {
      throw new Error("popup is missing: " + popupSelector);
    }
    const points = [
      { x: 2, y: 2 },
      { x: window.innerWidth - 2, y: 2 },
      { x: 2, y: window.innerHeight - 2 },
      { x: window.innerWidth - 2, y: window.innerHeight - 2 },
    ];
    return (
      points.find(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        return target !== null && !popup.contains(target);
      }) ?? null
    );
  }, selector);
}

async function releaseToastHoverPause(page, viewport) {
  const pointerReleasePoint = await outsidePointForPopup(
    page,
    ".fs-toast__viewport",
  );
  invariant(
    pointerReleasePoint !== null,
    "Toast timeout check needs a pointer position outside its viewport",
  );
  await page.mouse.move(pointerReleasePoint.x, pointerReleasePoint.y);
  await page.waitForFunction(
    () =>
      document
        .querySelector(".fs-toast__viewport")
        ?.hasAttribute("data-expanded") === false,
    undefined,
    { timeout: 1_000 },
  );
  const pointerOutsideViewport = await viewport.evaluate((element, point) => {
    const bounds = element.getBoundingClientRect();
    return (
      point.x < bounds.left ||
      point.x > bounds.right ||
      point.y < bounds.top ||
      point.y > bounds.bottom
    );
  }, pointerReleasePoint);
  invariant(
    pointerOutsideViewport,
    "Toast pointer must leave the viewport before timeout verification",
  );
  return pointerOutsideViewport;
}

async function collectInteractionMeasurements(page) {
  return page.evaluate((textRootSelector) => {
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity) > 0 &&
        bounds.width > 0 &&
        bounds.height > 0
      );
    };
    const controls = [
      ...document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="menuitemradio"]',
      ),
    ]
      .filter(isVisible)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          height: bounds.height,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().slice(0, 120) ??
            element.tagName.toLowerCase(),
          width: bounds.width,
        };
      });
    const clippedText = [
      ...document.querySelectorAll(
        [
          "main h1",
          "main h2",
          "main p",
          "main dt",
          "main dd",
          ".fs-menu__label",
          ".fs-menu__value",
          ".fs-menu__detail",
          ".fs-menu__item-label",
          ".fs-menu__item-detail",
          ".fs-overlay__title",
          ".fs-overlay__description",
          ".fs-toast__title",
          ".fs-toast__description",
        ].join(","),
      ),
    ]
      .filter(isVisible)
      .flatMap((element, index) => {
        const style = getComputedStyle(element);
        const reasons = [];
        if (
          element.scrollWidth > element.clientWidth + 1 &&
          ["clip", "hidden"].includes(style.overflowX)
        ) {
          reasons.push("inline");
        }
        if (
          element.scrollHeight > element.clientHeight + 1 &&
          ["clip", "hidden"].includes(style.overflowY)
        ) {
          reasons.push("block");
        }
        return reasons.map((reason) => ({
          reason,
          selector:
            element.id === ""
              ? element.tagName.toLowerCase() +
                ":nth-match(" +
                String(index + 1) +
                ")"
              : "#" + CSS.escape(element.id),
        }));
      });
    const visibleTextRoots = [...document.querySelectorAll(textRootSelector)]
      .filter(isVisible)
      .filter(
        (candidate) =>
          ![...document.querySelectorAll(textRootSelector)].some(
            (other) => other !== candidate && other.contains(candidate),
          ),
      );
    const visibleText = visibleTextRoots
      .map((element) => element.textContent ?? "")
      .join("");
    const surfaces = [
      ...document.querySelectorAll(
        ".fs-menu__popup, .fs-dialog__popup, .fs-drawer__popup, .fs-toast",
      ),
    ]
      .filter(isVisible)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          bottom: bounds.bottom,
          clientHeight: element.clientHeight,
          label:
            [...element.classList].find((className) =>
              className.endsWith("__popup"),
            ) ?? [...element.classList].join("."),
          left: bounds.left,
          overflowY: style.overflowY,
          right: bounds.right,
          scrollHeight: element.scrollHeight,
          top: bounds.top,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      });
    return {
      clippedText,
      controls,
      document: {
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      fontsStatus: document.fonts.status,
      replacementGlyphs: [...visibleText].filter(
        (character) => character === "�",
      ).length,
      surfaces,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  }, createInteractionTextRootSelector());
}

async function collectScrollLockProof(page) {
  const before = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    documentOverflow: getComputedStyle(document.documentElement).overflow,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    scrollY: window.scrollY,
  }));
  const delta = before.scrollY + 200 < before.maxScroll ? 600 : -600;
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(120);
  const afterScrollY = await page.evaluate(() => window.scrollY);
  const styleLocked = [before.bodyOverflow, before.documentOverflow].some(
    (value) => value === "hidden" || value === "clip",
  );
  invariant(before.maxScroll > 0, "scroll-lock fixture must be scrollable");
  invariant(
    Math.abs(afterScrollY - before.scrollY) <= 1,
    "modal layer must prevent background wheel scrolling",
  );
  invariant(styleLocked, "modal layer must apply hidden or clip overflow");
  return { ...before, afterScrollY, delta, styleLocked };
}

async function collectScrollReleaseProof(page, label) {
  try {
    await page.waitForFunction(
      () => {
        const bodyOverflow = getComputedStyle(document.body).overflow;
        const documentOverflow = getComputedStyle(
          document.documentElement,
        ).overflow;
        return (
          !document.documentElement.hasAttribute("data-fs-menu-scroll-lock") &&
          ![bodyOverflow, documentOverflow].some((value) =>
            ["hidden", "clip"].includes(value),
          )
        );
      },
      undefined,
      { timeout: 1_000 },
    );
  } catch {
    throw new Error(label + " must restore document scrolling within 1000ms");
  }
  const proof = await page.evaluate(() => {
    const bodyOverflow = getComputedStyle(document.body).overflow;
    const documentOverflow = getComputedStyle(
      document.documentElement,
    ).overflow;
    return {
      attributeRemoved: !document.documentElement.hasAttribute(
        "data-fs-menu-scroll-lock",
      ),
      bodyOverflow,
      documentOverflow,
      released: ![bodyOverflow, documentOverflow].some(
        (value) => value === "hidden" || value === "clip",
      ),
    };
  });
  invariant(
    isScrollReleaseMeasurement(proof),
    label + " must remove every document scroll lock",
  );
  return proof;
}

async function assertFocusInside(page, selector, label) {
  const focus = await page.evaluate((popupSelector) => {
    const popup = document.querySelector(popupSelector);
    const activeElement = document.activeElement;
    return {
      baseUiFocusGuard:
        activeElement instanceof HTMLElement &&
        activeElement.hasAttribute("data-base-ui-focus-guard"),
      focusGuardType:
        activeElement instanceof HTMLElement
          ? activeElement.getAttribute("data-type")
          : null,
      popupContainsActive: popup?.contains(activeElement) === true,
    };
  }, selector);
  const focusLocation = classifyOverlayFocus(focus);
  invariant(
    focusLocation !== "outside",
    label + " must keep focus inside its popup",
  );
  if (focusLocation === "transient-inside-guard") {
    await page.waitForFunction(
      (popupSelector) =>
        document
          .querySelector(popupSelector)
          ?.contains(document.activeElement) === true,
      selector,
      { timeout: 500 },
    );
  }
}

async function runOverlayCheck(page, kind) {
  const trigger = page.locator(`[data-overlay-trigger="${kind}"]`);
  const selector = `[data-overlay-popup="${kind}"]`;
  const popup = page.locator(selector);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await waitForSurfaceMotion(popup);
  invariant(
    (await popup.getAttribute("role")) === "dialog",
    kind + " popup must expose role=dialog",
  );
  await assertFocusInside(page, selector, kind);
  const scrollLock = await collectScrollLockProof(page);
  const focusableCount = await popup
    .locator(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    .count();
  invariant(focusableCount > 0, kind + " needs a focusable control");
  for (let index = 0; index < focusableCount + 2; index += 1) {
    await page.keyboard.press("Tab");
    await assertFocusInside(page, selector, kind);
  }
  for (let index = 0; index < focusableCount + 2; index += 1) {
    await page.keyboard.press("Shift+Tab");
    await assertFocusInside(page, selector, kind);
  }
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "detached" });
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    kind + " Escape must restore trigger focus",
  );
  const scrollReleasedAfterEscape = await collectScrollReleaseProof(
    page,
    kind + " Escape",
  );

  await trigger.click();
  await waitForSurfaceMotion(popup);
  if (kind === "drawer") {
    await popup.locator(".fs-overlay__close").click();
  } else {
    const point = await outsidePointForPopup(page, selector);
    invariant(point !== null, kind + " needs an outside dismissal target");
    await page.mouse.click(point.x, point.y);
  }
  await popup.waitFor({ state: "detached" });
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    kind + " secondary close must restore trigger focus",
  );
  const scrollReleasedAfterSecondaryClose = await collectScrollReleaseProof(
    page,
    kind + " secondary close",
  );
  return {
    backwardTrap: true,
    closeMethod: kind === "drawer" ? "button" : "outside",
    escapeRestoredFocus: true,
    focusableCount,
    forwardTrap: true,
    passed: true,
    scrollLock,
    scrollReleasedAfterEscape,
    scrollReleasedAfterSecondaryClose,
    secondaryCloseRestoredFocus: true,
  };
}

async function runOverlayOutsideCheck(page, kind) {
  const trigger = page.locator(`[data-overlay-trigger="${kind}"]`);
  const selector = `[data-overlay-popup="${kind}"]`;
  const popup = page.locator(selector);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await waitForSurfaceMotion(popup);
  const scrollLock = await collectScrollLockProof(page);
  const point = await outsidePointForPopup(page, selector);
  invariant(point !== null, kind + " needs a desktop outside dismissal target");
  await page.mouse.click(point.x, point.y);
  await popup.waitFor({ state: "detached" });
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    kind + " outside close must restore trigger focus",
  );
  const scrollReleased = await collectScrollReleaseProof(
    page,
    kind + " desktop outside close",
  );
  return { passed: true, point, scrollLock, scrollReleased };
}

async function waitForActiveMenuItem(page, expectedText) {
  const deadline = Date.now() + 500;
  do {
    const item = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        role: active?.getAttribute("role") ?? null,
        text: active?.textContent?.trim() ?? "",
      };
    });
    if (matchesActiveMenuItem(item, expectedText)) {
      return item.text;
    }
    await page.waitForTimeout(10);
  } while (Date.now() < deadline);
  throw new Error("Menu focus did not reach expected item: " + expectedText);
}

async function runMenuCheck(page) {
  const trigger = page.locator(
    '[data-interaction-workspace="menu"] .fs-menu__trigger',
  );
  const popup = page.locator('.fs-menu__popup[role="menu"]');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await waitForSurfaceMotion(popup);
  const items = popup.locator('[role="menuitemradio"]');
  invariant((await items.count()) === 3, "menu must expose three radio items");
  const [expectedFirst = "", expectedSecond = "", expectedDisabled = ""] = (
    await items.allTextContents()
  ).map((text) => text.trim());
  invariant(
    (await items.nth(2).getAttribute("aria-disabled")) === "true",
    "menu fixture disabled item must expose aria-disabled=true",
  );
  const scrollLock = await collectScrollLockProof(page);
  const first = await waitForActiveMenuItem(page, expectedFirst);
  await page.keyboard.press("ArrowDown");
  const second = await waitForActiveMenuItem(page, expectedSecond);
  invariant(
    second !== "" && second !== first,
    "ArrowDown must move to next item",
  );
  await page.keyboard.press("ArrowDown");
  const disabled = await waitForActiveMenuItem(page, expectedDisabled);
  invariant(
    disabled !== "" && disabled !== first && disabled !== second,
    "ArrowDown must allow focus on the disabled item",
  );
  const selectionBeforeDisabledActivation = await trigger.textContent();
  await page.keyboard.press("Enter");
  invariant(await popup.isVisible(), "disabled item must not close the menu");
  invariant(
    (await trigger.textContent()) === selectionBeforeDisabledActivation,
    "disabled item must not change the selected value",
  );
  await page.keyboard.press("ArrowDown");
  invariant(
    (await waitForActiveMenuItem(page, first)) === first,
    "ArrowDown must loop from the disabled final item",
  );
  await page.keyboard.press("End");
  invariant(
    (await waitForActiveMenuItem(page, disabled)) === disabled,
    "End must focus the final item, including when disabled",
  );
  await page.keyboard.press("Home");
  invariant(
    (await waitForActiveMenuItem(page, first)) === first,
    "Home must focus the first item",
  );
  await page.keyboard.type("compa");
  invariant(
    (await waitForActiveMenuItem(page, second)) === second,
    "typeahead must focus Compact",
  );
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "detached" });
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    "menu Escape must restore trigger focus",
  );
  const scrollReleased = await collectScrollReleaseProof(page, "Menu Escape");
  return {
    arrowNavigation: [first, second, disabled, first],
    disabledActivationBlocked: true,
    disabledAria: true,
    disabledFocusable: true,
    escapeRestoredFocus: true,
    homeEnd: true,
    passed: true,
    scrollLock,
    scrollReleased,
    typeahead: second,
  };
}

async function runRtlCheck(page) {
  const direction = await page
    .locator("html")
    .evaluate((element) => getComputedStyle(element).direction);
  invariant(direction === "rtl", "RTL scenario must compute direction=rtl");

  const drawerTrigger = page.locator('[data-overlay-trigger="drawer"]');
  const drawerSelector = '[data-overlay-popup="drawer"]';
  const drawerPopup = page.locator(drawerSelector);
  await drawerTrigger.scrollIntoViewIfNeeded();
  await drawerTrigger.focus();
  await page.keyboard.press("Enter");
  await waitForSurfaceMotion(drawerPopup);
  await assertFocusInside(page, drawerSelector, "RTL Drawer");
  const drawerGeometry = await drawerPopup.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const active = document.activeElement;
    return {
      dataSide: element.getAttribute("data-side"),
      direction: getComputedStyle(element).direction,
      edgeGap: Math.abs(bounds.left),
      focusVisible:
        active instanceof HTMLElement && active.matches(":focus-visible"),
      left: bounds.left,
      oppositeGap: Math.abs(window.innerWidth - bounds.right),
      right: bounds.right,
      viewportWidth: window.innerWidth,
      width: bounds.width,
    };
  });
  invariant(
    drawerGeometry.dataSide === "inline-end" &&
      drawerGeometry.direction === "rtl" &&
      drawerGeometry.edgeGap <= 1 &&
      drawerGeometry.oppositeGap > 1 &&
      drawerGeometry.focusVisible &&
      drawerGeometry.width < drawerGeometry.viewportWidth - 1,
    "RTL inline-end Drawer must occupy the physical left edge",
  );
  const drawerScrollLock = await collectScrollLockProof(page);
  const drawerMetrics = await collectInteractionMeasurements(page);
  const drawerMetricErrors = assessInteractionMeasurements(drawerMetrics);
  invariant(
    drawerMetricErrors.length === 0,
    "RTL Drawer metrics: " + drawerMetricErrors.join("; "),
  );
  await page.keyboard.press("Escape");
  await drawerPopup.waitFor({ state: "detached" });
  invariant(
    await drawerTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    "RTL Drawer Escape must restore trigger focus",
  );
  const drawerScrollReleased = await collectScrollReleaseProof(
    page,
    "RTL Drawer Escape",
  );

  const menuTrigger = page.locator(
    '[data-interaction-workspace="menu"] .fs-menu__trigger',
  );
  const menuSelector = '.fs-menu__popup[role="menu"]';
  const menuPopup = page.locator(menuSelector);
  await menuTrigger.scrollIntoViewIfNeeded();
  await menuTrigger.focus();
  await page.keyboard.press("ArrowDown");
  await waitForSurfaceMotion(menuPopup);
  await assertFocusInside(page, menuSelector, "RTL Menu");
  const rtlItemTexts = (
    await menuPopup.locator('[role="menuitemradio"]').allTextContents()
  ).map((text) => text.trim());
  const firstActiveItem = await waitForActiveMenuItem(
    page,
    rtlItemTexts[0] ?? "",
  );
  await page.keyboard.press("ArrowDown");
  const secondActiveItem = await waitForActiveMenuItem(
    page,
    rtlItemTexts[1] ?? "",
  );
  invariant(
    firstActiveItem !== "" &&
      secondActiveItem !== "" &&
      firstActiveItem !== secondActiveItem,
    "RTL Menu keyboard focus must move between items",
  );
  const menuGeometry = await page.evaluate(() => {
    const trigger = document.querySelector(
      '[data-interaction-workspace="menu"] .fs-menu__trigger',
    );
    const popup = document.querySelector('.fs-menu__popup[role="menu"]');
    if (!(trigger instanceof HTMLElement) || !(popup instanceof HTMLElement)) {
      throw new Error("RTL Menu geometry requires trigger and popup");
    }
    const items = [...popup.querySelectorAll('[role="menuitemradio"]')];
    const indicators = [...popup.querySelectorAll(".fs-menu__indicator")];
    const selectedItem = items.find(
      (item) => item.getAttribute("aria-checked") === "true",
    );
    const selectedIndicator = selectedItem?.querySelector(
      ".fs-menu__indicator",
    );
    const selectedCopy = selectedItem?.querySelector(".fs-menu__item-copy");
    if (
      !(selectedIndicator instanceof HTMLElement) ||
      !(selectedCopy instanceof HTMLElement)
    ) {
      throw new Error("RTL Menu selected indicator is missing");
    }
    const triggerBounds = trigger.getBoundingClientRect();
    const popupBounds = popup.getBoundingClientRect();
    const indicatorBounds = selectedIndicator.getBoundingClientRect();
    const copyBounds = selectedCopy.getBoundingClientRect();
    const activeItem = document.activeElement;
    if (!(activeItem instanceof HTMLElement) || !popup.contains(activeItem)) {
      throw new Error("RTL Menu active item is missing");
    }
    const highlightStyle = getComputedStyle(activeItem, "::before");
    const unchecked = indicators.filter((indicator) =>
      indicator.hasAttribute("data-unchecked"),
    );
    const alignmentDelta = Math.abs(popupBounds.right - triggerBounds.right);
    const indicatorInlineStart =
      indicatorBounds.left + indicatorBounds.width / 2 >
      copyBounds.left + copyBounds.width / 2;
    return {
      alignmentDelta,
      activeHighlighted: activeItem.hasAttribute("data-highlighted"),
      activeItemDirection: getComputedStyle(activeItem).direction,
      focusVisible: activeItem.matches(":focus-visible"),
      direction: getComputedStyle(popup).direction,
      highlightInsetInlineStart: highlightStyle.insetInlineStart,
      highlightLeft: highlightStyle.left,
      highlightLogicalRail:
        highlightStyle.insetInlineStart === "0px" &&
        highlightStyle.inlineSize !== "0px",
      highlightPhysicalSide:
        highlightStyle.right === "0px" ? "right" : "not-right",
      highlightRight: highlightStyle.right,
      indicatorCenterX: indicatorBounds.left + indicatorBounds.width / 2,
      indicatorCount: indicators.length,
      indicatorInlineStart,
      itemCount: items.length,
      copyCenterX: copyBounds.left + copyBounds.width / 2,
      popupRight: popupBounds.right,
      popupStartAligned: alignmentDelta <= 2,
      selectedIndicatorVisible:
        getComputedStyle(selectedIndicator).visibility !== "hidden",
      uncheckedIndicatorCount: unchecked.length,
      uncheckedIndicatorsHidden: unchecked.every(
        (indicator) => getComputedStyle(indicator).visibility === "hidden",
      ),
      triggerRight: triggerBounds.right,
    };
  });
  invariant(
    menuGeometry.direction === "rtl" &&
      menuGeometry.activeItemDirection === "rtl" &&
      menuGeometry.activeHighlighted &&
      menuGeometry.focusVisible &&
      menuGeometry.highlightLogicalRail &&
      menuGeometry.highlightPhysicalSide === "right" &&
      menuGeometry.itemCount === 3 &&
      menuGeometry.indicatorCount === 3 &&
      menuGeometry.selectedIndicatorVisible &&
      menuGeometry.uncheckedIndicatorCount === 2 &&
      menuGeometry.uncheckedIndicatorsHidden &&
      menuGeometry.indicatorInlineStart &&
      menuGeometry.popupStartAligned,
    "RTL Menu must align to logical start and place indicators inline-start",
  );
  const menuScrollLock = await collectScrollLockProof(page);
  const menuMetrics = await collectInteractionMeasurements(page);
  const menuMetricErrors = assessInteractionMeasurements(menuMetrics);
  invariant(
    menuMetricErrors.length === 0,
    "RTL Menu metrics: " + menuMetricErrors.join("; "),
  );
  await page.keyboard.press("Escape");
  await menuPopup.waitFor({ state: "detached" });
  invariant(
    await menuTrigger.evaluate((element) => element === document.activeElement),
    "RTL Menu Escape must restore trigger focus",
  );
  const menuScrollReleased = await collectScrollReleaseProof(
    page,
    "RTL Menu Escape",
  );

  return {
    direction,
    drawer: {
      ...drawerGeometry,
      escapeRestoredFocus: true,
      focusInside: true,
      inlineEndPhysicalSide: "left",
      metrics: drawerMetrics,
      scrollLock: drawerScrollLock,
      scrollReleased: drawerScrollReleased,
    },
    menu: {
      ...menuGeometry,
      activeItemMoved: true,
      escapeRestoredFocus: true,
      focusInside: true,
      indicatorPhysicalSide: "right",
      metrics: menuMetrics,
      scrollLock: menuScrollLock,
      scrollReleased: menuScrollReleased,
    },
    passed: true,
  };
}

async function collectTouchScrollLockProof(page, popup) {
  const beforeScrollY = await page.evaluate(() => window.scrollY);
  const viewport = page.viewportSize();
  invariant(viewport !== null, "touch context must expose a viewport");
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.synthesizeScrollGesture", {
      gestureSourceType: "touch",
      speed: 800,
      x: 8,
      xDistance: 0,
      y: Math.min(120, viewport.height - 1),
      yDistance: -500,
    });
  } finally {
    await session.detach();
  }
  await page.waitForTimeout(160);
  const afterScrollY = await page.evaluate(() => window.scrollY);
  invariant(
    Math.abs(afterScrollY - beforeScrollY) <= 1,
    "touch Menu must prevent background touch scrolling",
  );
  invariant(
    await popup.isVisible(),
    "touch scroll gesture must keep Menu open",
  );
  return { afterScrollY, beforeScrollY };
}

async function runTouchMenuCheck(page) {
  const trigger = page.locator(
    '[data-interaction-workspace="menu"] .fs-menu__trigger',
  );
  const popup = page.locator('.fs-menu__popup[role="menu"]');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.tap();
  await waitForSurfaceMotion(popup);
  const wheel = await collectScrollLockProof(page);
  const touch = await collectTouchScrollLockProof(page, popup);
  await page.touchscreen.tap(2, 2);
  await popup.waitFor({ state: "detached" });
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    "touch Menu outside close must restore trigger focus",
  );
  const scrollReleased = await collectScrollReleaseProof(
    page,
    "touch Menu outside close",
  );
  return {
    closeRestoredFocus: true,
    passed: true,
    scrollReleased,
    touch,
    wheel,
  };
}

async function runToastCheck(page) {
  const trigger = page.locator('[data-testid="create-toast"]');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await trigger.click();
  const toast = page.locator(".fs-toast");
  await waitForSurfaceMotion(toast);
  const announcementMutationCount = await page.evaluate(async () => {
    const viewport = document.querySelector(".fs-toast__viewport");
    const duplicateTrigger = document.querySelector(
      '[data-testid="create-toast"]',
    );
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("toast viewport is missing");
    }
    if (!(duplicateTrigger instanceof HTMLElement)) {
      throw new Error("toast trigger is missing");
    }
    let count = 0;
    const observer = new globalThis.MutationObserver((records) => {
      count += records.filter(
        ({ type }) => type === "childList" || type === "characterData",
      ).length;
    });
    observer.observe(viewport, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    duplicateTrigger.click();
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    observer.disconnect();
    return count;
  });
  invariant(
    (await toast.count()) === 1,
    "stable toast id must upsert, not stack",
  );
  invariant(
    announcementMutationCount === 0,
    "stable toast id must not repeat its live-region announcement",
  );
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    "toast creation must not steal focus",
  );
  const viewport = page.locator(".fs-toast__viewport");
  invariant(
    (await viewport.getAttribute("role")) === "region" &&
      (await viewport.getAttribute("aria-live")) === "polite" &&
      (await viewport.getAttribute("aria-atomic")) === "false",
    "toast viewport must expose polite live-region semantics",
  );
  invariant(
    (await toast.getAttribute("role")) === "dialog",
    "low-priority toast must expose dialog semantics",
  );
  const title = (await toast.locator(".fs-toast__title").textContent())?.trim();
  const description = (
    await toast.locator(".fs-toast__description").textContent()
  )?.trim();
  invariant(title !== "" && description !== "", "toast copy must be rendered");
  await releaseToastHoverPause(page, viewport);
  await toast.waitFor({ state: "detached", timeout: 8_000 });
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    "toast timeout must preserve trigger focus",
  );

  await trigger.click();
  await waitForSurfaceMotion(toast);
  await page.keyboard.press("F6");
  invariant(
    await viewport.evaluate((element) => element === document.activeElement),
    "F6 must move focus to the toast viewport",
  );
  await page.keyboard.press("Tab");
  invariant(
    await toast.evaluate((element) => element === document.activeElement),
    "Tab from the viewport must enter the toast",
  );
  await page.keyboard.press("Escape");
  await toast.waitFor({ state: "detached" });
  invariant(
    await trigger.evaluate((element) => element === document.activeElement),
    "keyboard toast close must restore trigger focus",
  );

  const limitTrigger = page.locator('[data-testid="create-toast-limit"]');
  await limitTrigger.focus();
  await limitTrigger.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".fs-toast").length === 4,
  );
  await waitForSurfaceMotion(
    page.locator(".fs-toast:not([data-limited])").first(),
  );
  const totalAfterLimit = await toast.count();
  const limitedAfterLimit = await page
    .locator(".fs-toast[data-limited]")
    .count();
  const visibleAfterLimit = await page.locator(".fs-toast:visible").count();
  invariant(
    totalAfterLimit === 4 && limitedAfterLimit === 1 && visibleAfterLimit === 3,
    "Toast limit must display exactly three of four unique items",
  );
  invariant(
    await limitTrigger.evaluate(
      (element) => element === document.activeElement,
    ),
    "creating a limited Toast stack must not steal focus",
  );
  const pointerOutsideViewport = await releaseToastHoverPause(page, viewport);
  await page.waitForFunction(
    () => document.querySelectorAll(".fs-toast").length === 0,
    undefined,
    { timeout: 8_000 },
  );
  return {
    announcementMutationCount,
    countAfterStableIdUpsert: 1,
    focusStayedOnTrigger: true,
    hoverPauseReleased: true,
    keyboardManualDismissed: true,
    limitedAfterLimit,
    live: "polite",
    passed: true,
    pointerOutsideViewport,
    role: "dialog",
    timeoutDismissed: true,
    totalAfterLimit,
    visibleAfterLimit,
  };
}

async function readTransactionContext(page) {
  const context = page.locator('[data-testid="transaction-context"]');
  await context.waitFor({ state: "visible" });
  const serialized = await context.getAttribute("data-context-json");
  invariant(serialized !== null, "transaction context marker is missing");
  return JSON.parse(serialized);
}

async function waitForTransactionContext(page, expected) {
  await page.waitForFunction(
    (serialized) =>
      document
        .querySelector('[data-testid="transaction-context"]')
        ?.getAttribute("data-context-json") === serialized,
    JSON.stringify(expected),
  );
}

async function selectMenuOption(trigger, page, optionText) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const popup = page.locator('.fs-menu__popup[role="menu"]');
  await waitForSurfaceMotion(popup);
  const option = popup
    .locator('[role="menuitemradio"]')
    .filter({ hasText: optionText });
  invariant(
    (await option.count()) === 1,
    "menu option must be unique: " + optionText,
  );
  await option.click();
  await popup.waitFor({ state: "detached" });
  await collectScrollReleaseProof(page, "Menu selection");
}

async function runLocaleRegionCheck(page, diagnostics) {
  const workspace = page.locator(
    '[data-interaction-workspace="locale-region"]',
  );
  const triggers = workspace.locator(".fs-menu__trigger");
  invariant((await triggers.count()) === 2, "locale/region needs two controls");
  const initialUrl = new URL(page.url());
  const expectedInitialContext = {
    amountMinor: "2599",
    cart: "cart_alpha",
    currency: "CAD",
    market: "Canada",
    paymentAttempt: "attempt_alpha",
    region: "CA",
  };
  await waitForTransactionContext(page, expectedInitialContext);
  const initialContext = await readTransactionContext(page);
  invariant(
    JSON.stringify(initialContext) === JSON.stringify(expectedInitialContext),
    "fixture must hydrate the exact simulated transaction context",
  );

  await selectMenuOption(triggers.nth(0), page, "Português");
  await page.waitForURL((value) => value.pathname === fixturePath("pt"));
  const portugueseUrl = new URL(page.url());
  invariant(
    portugueseUrl.search === initialUrl.search &&
      portugueseUrl.hash === initialUrl.hash,
    "language change must preserve query and hash exactly",
  );
  await waitForTransactionContext(page, initialContext);
  invariant(
    (await page.context().cookies()).some(
      (cookie) =>
        cookie.name === "site_locale" &&
        cookie.value === "pt" &&
        cookie.domain === initialUrl.hostname &&
        cookie.path === "/" &&
        cookie.sameSite === "Lax",
    ),
    "language change must persist a host-only site_locale cookie",
  );

  const localizedWorkspace = page.locator(
    '[data-interaction-workspace="locale-region"]',
  );
  const localizedTriggers = localizedWorkspace.locator(".fs-menu__trigger");
  await selectMenuOption(localizedTriggers.nth(1), page, "Brasil");
  const regionContext = {
    ...initialContext,
    currency: "BRL",
    market: "Brazil",
    region: "BR",
  };
  await waitForTransactionContext(page, regionContext);
  const regionUrl = new URL(page.url());
  invariant(
    regionUrl.pathname === fixturePath("pt"),
    "region change must not change the presentation locale",
  );
  invariant(
    regionUrl.searchParams.get("region") === "BR" &&
      regionUrl.searchParams.get("market") === "Brazil" &&
      regionUrl.searchParams.get("currency") === "BRL",
    "region must update only its explicit fixture context",
  );
  const preservedOpaqueQuery = [
    "amount",
    "cart",
    "paymentAttempt",
    "note",
    "duplicate",
  ].every(
    (name) =>
      JSON.stringify(regionUrl.searchParams.getAll(name)) ===
      JSON.stringify(initialUrl.searchParams.getAll(name)),
  );
  invariant(
    preservedOpaqueQuery && regionUrl.hash === initialUrl.hash,
    "region change must preserve amount, cart, payment attempt, opaque query, and hash",
  );
  invariant(
    (await page.locator(".fs-live-region").textContent())?.trim() !== "",
    "region change must be announced",
  );

  await selectMenuOption(localizedTriggers.nth(0), page, "日本語");
  await page.waitForURL((value) => value.pathname === fixturePath("ja"));
  const japaneseUrl = new URL(page.url());
  invariant(
    japaneseUrl.search === regionUrl.search &&
      japaneseUrl.hash === regionUrl.hash,
    "language change after region selection must preserve URL context",
  );
  await waitForTransactionContext(page, regionContext);
  invariant(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "site_locale" && cookie.value === "ja",
    ),
    "second language change must replace the site_locale cookie",
  );

  const businessRequests = diagnostics.requests.filter((request) => {
    if (request.resourceType !== "fetch" && request.resourceType !== "xhr") {
      return false;
    }
    const pathname = new URL(request.url).pathname;
    return /\/(?:api|carts?|orders?|payments?)(?:\/|$)/iu.test(pathname);
  });
  invariant(
    businessRequests.length === 0,
    "locale/region controls must not call business APIs",
  );
  return {
    businessRequests: businessRequests.length,
    passed: true,
    preservedOpaqueQuery,
    preservedTransactionContext: true,
  };
}

async function readReducedMotionStyles(page, selectors) {
  return page.evaluate((entries) => {
    return entries.map(([label, selector, inspectStartingTransform]) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error("missing reduced-motion element " + selector);
      }
      const style = getComputedStyle(element);
      const measurement = {
        animationDelay: style.animationDelay,
        animationDuration: style.animationDuration,
        label,
        transitionDelay: style.transitionDelay,
        transitionDuration: style.transitionDuration,
      };
      if (inspectStartingTransform) {
        const alreadyStarting = element.hasAttribute("data-starting-style");
        element.setAttribute("data-starting-style", "");
        measurement.startingTransform = getComputedStyle(element).transform;
        if (!alreadyStarting) {
          element.removeAttribute("data-starting-style");
        }
      }
      return measurement;
    });
  }, selectors);
}

async function runReducedMotionCheck(page) {
  const matches = await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const styles = [];

  for (const kind of ["dialog", "drawer"]) {
    const trigger = page.locator(`[data-overlay-trigger="${kind}"]`);
    const popup = page.locator(`[data-overlay-popup="${kind}"]`);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await waitForSurfaceMotion(popup);
    styles.push(
      ...(await readReducedMotionStyles(page, [
        [`${kind}-trigger`, `[data-overlay-trigger="${kind}"]`],
        [`${kind}-backdrop`, ".fs-overlay__backdrop"],
        [kind, `[data-overlay-popup="${kind}"]`, true],
      ])),
    );
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "detached" });
    await collectScrollReleaseProof(page, kind + " reduced-motion close");
  }

  const menuTrigger = page.locator(
    '[data-interaction-workspace="menu"] .fs-menu__trigger',
  );
  const menuPopup = page.locator('.fs-menu__popup[role="menu"]');
  await menuTrigger.scrollIntoViewIfNeeded();
  await menuTrigger.focus();
  await page.keyboard.press("ArrowDown");
  await waitForSurfaceMotion(menuPopup);
  styles.push(
    ...(await readReducedMotionStyles(page, [
      ["menu-trigger", '[data-interaction-workspace="menu"] .fs-menu__trigger'],
      ["menu", '.fs-menu__popup[role="menu"]', true],
    ])),
  );
  await page.keyboard.press("Escape");
  await menuPopup.waitFor({ state: "detached" });
  await collectScrollReleaseProof(page, "Menu reduced-motion close");

  const toastTrigger = page.locator('[data-testid="create-toast"]');
  const toast = page.locator(".fs-toast");
  await toastTrigger.scrollIntoViewIfNeeded();
  await toastTrigger.click();
  await waitForSurfaceMotion(toast);
  styles.push(
    ...(await readReducedMotionStyles(page, [
      ["toast-trigger", '[data-testid="create-toast"]'],
      ["toast", ".fs-toast", true],
    ])),
  );
  await toast.locator(".fs-toast__close").click();
  await toast.waitFor({ state: "detached" });

  const measurement = { matches, styles };
  const errors = assessReducedMotionMeasurements(measurement);
  invariant(errors.length === 0, errors.join("; "));
  return { ...measurement, passed: true };
}

async function openEvidenceState(page, state) {
  if (state === "default") {
    return async () => undefined;
  }
  if (state === "dialog" || state === "drawer") {
    const trigger = page.locator(`[data-overlay-trigger="${state}"]`);
    const popup = page.locator(`[data-overlay-popup="${state}"]`);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await waitForSurfaceMotion(popup);
    return async () => {
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "detached" });
      await collectScrollReleaseProof(page, state + " axe cleanup");
    };
  }
  if (state === "menu") {
    const trigger = page.locator(
      '[data-interaction-workspace="menu"] .fs-menu__trigger',
    );
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const popup = page.locator('.fs-menu__popup[role="menu"]');
    await waitForSurfaceMotion(popup);
    return async () => {
      await page.keyboard.press("Escape");
      await popup.waitFor({ state: "detached" });
      await collectScrollReleaseProof(page, "Menu axe cleanup");
    };
  }
  if (state === "touch-menu") {
    const trigger = page.locator(
      '[data-interaction-workspace="menu"] .fs-menu__trigger',
    );
    await trigger.scrollIntoViewIfNeeded();
    await trigger.tap();
    const popup = page.locator('.fs-menu__popup[role="menu"]');
    await waitForSurfaceMotion(popup);
    return async () => {
      await page.touchscreen.tap(2, 2);
      await popup.waitFor({ state: "detached" });
      await collectScrollReleaseProof(page, "touch Menu screenshot cleanup");
    };
  }
  if (state === "toast") {
    const trigger = page.locator('[data-testid="create-toast"]');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const toast = page.locator(".fs-toast");
    await waitForSurfaceMotion(toast);
    return async () => {
      await toast.locator(".fs-toast__close").click();
      await toast.waitFor({ state: "detached" });
    };
  }
  throw new Error("unknown evidence state " + state);
}

async function writeAxeResult(candidate, scenarioId, scan, axeResult) {
  const relativePath = path.posix.join("axe-results", scan.id + ".json");
  const outputPath = path.join(candidate, ...relativePath.split("/"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        exclusions: createAxeExclusionPolicy(),
        result: axeResult,
        scan: { id: scan.id, scenarioId, state: scan.state },
        schemaVersion: 1,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return relativePath;
}

async function captureScenarioScreenshot(page, candidate, relativePath) {
  const outputPath = path.join(candidate, ...relativePath.split("/"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: outputPath,
  });
  const buffer = await readFile(outputPath);
  const dimensions = readPngDimensions(buffer);
  return {
    bytes: buffer.length,
    path: relativePath,
    pixelHeight: dimensions.height,
    pixelWidth: dimensions.width,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function runScenario({
  AxeBuilder,
  browser,
  candidate,
  origin,
  scenario: entry,
}) {
  const context = await browser.newContext({
    baseURL: origin,
    colorScheme: "dark",
    deviceScaleFactor: 1,
    hasTouch: entry.hasTouch === true,
    isMobile: entry.isMobile === true,
    locale: "en-US",
    reducedMotion: entry.reducedMotion ? "reduce" : "no-preference",
    serviceWorkers: "block",
    viewport: entry.viewport,
  });
  const page = await context.newPage();
  const diagnostics = await observePage(page, context, origin);
  const axeSummaries = [];
  const checks = {};
  try {
    const interactionQuery = entry.checks.includes("locale-region")
      ? "?amount=2599&cart=cart_alpha&region=CA&market=Canada&currency=CAD&paymentAttempt=attempt_alpha&note=a%2Bb&duplicate=one&duplicate=two#retained"
      : "";
    const url = await settleFixturePage(page, entry.locale, interactionQuery);
    if (entry.direction !== undefined) {
      await page.locator("html").evaluate((element, direction) => {
        element.setAttribute("dir", direction);
      }, entry.direction);
      await page.waitForFunction(
        (direction) =>
          getComputedStyle(document.documentElement).direction === direction,
        entry.direction,
      );
    }
    if (entry.checks.includes("dialog")) {
      checks.dialog = await runOverlayCheck(page, "dialog");
    }
    if (entry.checks.includes("drawer")) {
      checks.drawer = await runOverlayCheck(page, "drawer");
    }
    if (entry.checks.includes("menu")) {
      checks.menu = await runMenuCheck(page);
    }
    if (entry.checks.includes("toast")) {
      checks.toast = await runToastCheck(page);
    }
    if (entry.checks.includes("touch-menu")) {
      checks.touchMenu = await runTouchMenuCheck(page);
    }
    if (entry.checks.includes("drawer-outside")) {
      checks.drawerOutside = await runOverlayOutsideCheck(page, "drawer");
    }
    if (entry.checks.includes("rtl")) {
      checks.rtl = await runRtlCheck(page);
    }
    if (entry.checks.includes("locale-region")) {
      checks.localeRegion = await runLocaleRegionCheck(page, diagnostics);
    }
    if (entry.reducedMotion === true) {
      checks.reducedMotion = await runReducedMotionCheck(page);
    }

    for (const scan of entry.axe) {
      const closeState = await openEvidenceState(page, scan.state);
      let axeResult;
      try {
        const axeBuilder = new AxeBuilder({ page });
        for (const { selector } of createAxeExclusionPolicy()) {
          axeBuilder.exclude(selector);
        }
        axeResult = await axeBuilder.analyze();
      } finally {
        await closeState();
      }
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
        state: scan.state,
      });
    }

    const closeScreenshotState = await openEvidenceState(
      page,
      entry.screenshotState ?? "default",
    );
    let metrics;
    let screenshot;
    try {
      metrics = await collectInteractionMeasurements(page);
      if (["th", "zh-CN"].includes(entry.locale)) {
        const portal = page.locator(
          ".fs-menu__popup, .fs-dialog__popup, .fs-drawer__popup, .fs-toast",
        );
        if ((await portal.count()) > 0) {
          const inheritedLanguage = await portal
            .first()
            .evaluate((element) =>
              element.closest("[lang]")?.getAttribute("lang"),
            );
          invariant(
            inheritedLanguage === entry.locale,
            "portal surface must inherit document locale " + entry.locale,
          );
          checks.portalLanguage = {
            inheritedLanguage,
            passed: true,
          };
        }
      }
      screenshot = await captureScenarioScreenshot(
        page,
        candidate,
        entry.screenshot,
      );
    } finally {
      await closeScreenshotState();
    }
    const diagnosticEvidence = createDiagnosticEvidence(diagnostics);
    const errors = [
      ...assessInteractionMeasurements(metrics),
      ...diagnosticErrors(diagnosticEvidence),
    ];
    for (const summary of axeSummaries) {
      for (const violation of summary.blocking) {
        errors.push(
          "axe " +
            summary.id +
            " " +
            violation.impact +
            " violation " +
            violation.id +
            " (" +
            String(violation.nodeCount) +
            " nodes)",
        );
      }
    }
    const documentLanguage = await page.locator("html").getAttribute("lang");
    const documentDirection =
      (await page.locator("html").getAttribute("dir")) ?? "";
    return {
      axeSummaries,
      result: {
        checks,
        diagnostics: diagnosticEvidence,
        documentDirection,
        documentLanguage,
        errors,
        fixtureUrl: createFixtureEvidenceUrl(url),
        group: entry.group,
        id: entry.id,
        locale: entry.locale,
        metrics,
        reducedMotion: entry.reducedMotion === true,
        screenshot: entry.screenshot,
        viewport: entry.viewport,
      },
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function runBrowserMatrix({ candidate, origin, versions }) {
  const [{ chromium }, axeModule] = await Promise.all([
    import("@playwright/test"),
    import("@axe-core/playwright"),
  ]);
  const AxeBuilder = axeModule.default;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  versions.browser = "Google Chrome " + browser.version();
  const axeSummaries = [];
  const scenarioResults = [];
  const screenshots = [];
  try {
    for (const entry of createInteractionScenarioMatrix()) {
      process.stdout.write("\n[p2-03 browser] " + entry.id + "\n");
      const result = await runScenario({
        AxeBuilder,
        browser,
        candidate,
        origin,
        scenario: entry,
      });
      axeSummaries.push(...result.axeSummaries);
      scenarioResults.push(result.result);
      screenshots.push(result.screenshot);
      invariant(
        result.result.errors.length === 0,
        entry.id + " failed:\n- " + result.result.errors.join("\n- "),
      );
    }
  } finally {
    await browser.close();
  }
  return { axeSummaries, scenarioResults, screenshots };
}

async function resolveInstalledGoogleChrome(workspaceRoot) {
  const override = process.env.FAN_SUPPORT_GOOGLE_CHROME_PATH?.trim();
  const candidates = [];
  if (override !== undefined && override.length > 0) {
    candidates.push(override);
  }
  if (process.platform === "darwin") {
    try {
      const applications = await captureCommand(
        "mdfind",
        ["kMDItemCFBundleIdentifier == 'com.google.Chrome'"],
        workspaceRoot,
      );
      for (const application of applications.split("\n").filter(Boolean)) {
        candidates.push(
          path.join(application, "Contents", "MacOS", "Google Chrome"),
        );
      }
    } catch {
      // Keep checking the explicit and conventional paths.
    }
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
        // Continue through installed command candidates.
      }
    }
  } else if (process.platform === "win32") {
    for (const parent of [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ]) {
      if (parent !== undefined) {
        candidates.push(
          path.join(parent, "Google", "Chrome", "Application", "chrome.exe"),
        );
      }
    }
  }
  for (const candidate of new Set(candidates)) {
    if (!(await pathExists(candidate))) {
      continue;
    }
    let version;
    try {
      version = await captureCommand(candidate, ["--version"], workspaceRoot);
    } catch {
      continue;
    }
    if (/^Google Chrome \d/u.test(version)) {
      return { executablePath: candidate, version };
    }
  }
  throw new Error(
    "installed Google Chrome was not found; set FAN_SUPPORT_GOOGLE_CHROME_PATH",
  );
}

async function writeNativeZoomPreferences(profileRoot, zoomPercent) {
  const defaultProfile = path.join(profileRoot, "Default");
  const preferencesPath = path.join(defaultProfile, "Preferences");
  await mkdir(defaultProfile, { recursive: true });
  let current = {};
  if (await pathExists(preferencesPath)) {
    current = JSON.parse(await readFile(preferencesPath, "utf8"));
  }
  const desired = createNativeZoomProfilePreferences(zoomPercent);
  await writeFile(
    preferencesPath,
    JSON.stringify({
      ...current,
      browser: { ...current.browser, ...desired.browser },
      partition: { ...current.partition, ...desired.partition },
      profile: { ...current.profile, ...desired.profile },
    }),
    "utf8",
  );
  return {
    preferencesPath,
    zoomLevel: desired.partition.default_zoom_level.x,
  };
}

async function collectNativeWindowMeasurement(page) {
  return page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    outerHeight: window.outerHeight,
    outerWidth: window.outerWidth,
    screen: {
      availHeight: window.screen.availHeight,
      availWidth: window.screen.availWidth,
      height: window.screen.height,
      width: window.screen.width,
    },
    visualViewport:
      window.visualViewport === null
        ? null
        : {
            height: window.visualViewport.height,
            offsetLeft: window.visualViewport.offsetLeft,
            offsetTop: window.visualViewport.offsetTop,
            scale: window.visualViewport.scale,
            width: window.visualViewport.width,
          },
  }));
}

async function captureNativeViewportPng(session) {
  const result = await session.send("Page.captureScreenshot", {
    captureBeyondViewport: false,
    format: "png",
    fromSurface: true,
  });
  invariant(
    typeof result?.data === "string" && result.data.length > 0,
    "Chrome did not return native screenshot data",
  );
  return Buffer.from(result.data, "base64");
}

async function writeNativeViewportScreenshot({
  candidate,
  context,
  measurement,
  page,
  relativePath,
}) {
  const screenshotPath = path.join(candidate, ...relativePath.split("/"));
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.bringToFront();
  await page.evaluate(() => {
    let style = document.querySelector("style[data-native-capture-freeze]");
    if (!(style instanceof HTMLElement)) {
      style = document.createElement("style");
      style.dataset.nativeCaptureFreeze = "true";
      style.textContent =
        "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
      document.head.append(style);
    }
    for (const animation of document.getAnimations()) {
      animation.pause();
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.waitForTimeout(100);

  const marker = page.locator("main > header > p:last-child");
  invariant(
    (await marker.count()) === 1,
    "native zoom locale marker is missing",
  );
  const markerState = await marker.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      height: bounds.height,
      previousVisibility: element.style.visibility,
      text: element.textContent?.trim() ?? "",
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    };
  });
  invariant(
    markerState.text.toLowerCase() === nativeZoomLocale.toLowerCase(),
    "native zoom locale marker must identify " + nativeZoomLocale,
  );

  const session = await context.newCDPSession(page);
  let buffer;
  let hiddenBuffer;
  let repeatedHiddenBuffer;
  try {
    buffer = await captureNativeViewportPng(session);
    await marker.evaluate((element) => {
      element.style.visibility = "hidden";
    });
    hiddenBuffer = await captureNativeViewportPng(session);
    repeatedHiddenBuffer = await captureNativeViewportPng(session);
  } finally {
    await marker.evaluate((element, previousVisibility) => {
      if (previousVisibility === "") {
        element.style.removeProperty("visibility");
      } else {
        element.style.visibility = previousVisibility;
      }
    }, markerState.previousVisibility);
    await session.detach();
  }
  invariant(
    createHash("sha256").update(hiddenBuffer).digest("hex") ===
      createHash("sha256").update(repeatedHiddenBuffer).digest("hex"),
    "native screenshot pixels changed while the fixture was frozen",
  );
  const dimensions = readPngDimensions(buffer);
  const hiddenDimensions = readPngDimensions(hiddenBuffer);
  invariant(
    dimensions.width === hiddenDimensions.width &&
      dimensions.height === hiddenDimensions.height,
    "native screenshot dimensions changed while probing the locale marker",
  );
  await writeFile(screenshotPath, buffer);
  const pixelRatio = measurement.devicePixelRatio;
  return {
    bytes: buffer.length,
    captureMethod:
      "CDP Page.captureScreenshot with fromSurface=true, captureBeyondViewport=false, no clip, and no Emulation commands",
    localeMarker: {
      changedFromHidden:
        createHash("sha256").update(buffer).digest("hex") !==
        createHash("sha256").update(hiddenBuffer).digest("hex"),
      height: Math.ceil(markerState.height * pixelRatio),
      text: markerState.text,
      width: Math.ceil(markerState.width * pixelRatio),
      x: Math.floor(markerState.x * pixelRatio),
      y: Math.floor(markerState.y * pixelRatio),
    },
    path: relativePath,
    pixelHeight: dimensions.height,
    pixelWidth: dimensions.width,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function runNativeLanguageMenuCheck(page) {
  const trigger = page
    .locator('[data-interaction-workspace="locale-region"] .fs-menu__trigger')
    .first();
  const popup = page.locator('.fs-menu__popup[role="menu"]');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await waitForSurfaceMotion(popup);
  const itemCount = await popup.locator('[role="menuitemradio"]').count();
  invariant(itemCount === 7, "Language menu must expose all seven locales");
  const metrics = await collectInteractionMeasurements(page);
  const errors = assessInteractionMeasurements(metrics);
  invariant(
    metrics.surfaces.length > 0 && errors.length === 0,
    "native zoom Language menu: " + errors.join("; "),
  );
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "detached" });
  await collectScrollReleaseProof(page, "native zoom Language menu close");
  return { itemCount, metrics, passed: true };
}

async function runNativeZoomPass({
  candidate,
  chromium,
  executablePath,
  origin,
  profileRoot,
  screenshot,
  verifyInteractions,
}) {
  let context;
  try {
    context = await chromium.launchPersistentContext(
      profileRoot,
      createNativeZoomLaunchOptions(executablePath, origin),
    );
    const page = await context.newPage();
    const diagnostics = await observePage(page, context, origin);
    const url = await settleFixturePage(page, nativeZoomLocale);
    const measurement = await collectNativeWindowMeasurement(page);
    const checks = {};
    if (verifyInteractions) {
      checks.dialog = await runOverlayCheck(page, "dialog");
      checks.menu = await runMenuCheck(page);
      checks.languageMenu = await runNativeLanguageMenuCheck(page);
    }
    const metrics = await collectInteractionMeasurements(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshotEvidence = await writeNativeViewportScreenshot({
      candidate,
      context,
      measurement,
      page,
      relativePath: screenshot,
    });
    await page.waitForTimeout(100);
    const diagnosticEvidence = createDiagnosticEvidence(diagnostics);
    const errors = [
      ...assessInteractionMeasurements(metrics),
      ...diagnosticErrors(diagnosticEvidence),
    ];
    invariant(errors.length === 0, errors.join("; "));
    return {
      checks,
      diagnostics: diagnosticEvidence,
      fixtureUrl: url,
      measurement,
      metrics,
      screenshot: screenshotEvidence,
    };
  } finally {
    await context?.close();
  }
}

function approximatelyEqual(actual, expected, tolerance) {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <= tolerance
  );
}

async function runNativeChromeZoomVerification({
  candidate,
  origin,
  workspaceRoot,
}) {
  const { chromium } = await import("@playwright/test");
  const chrome = await resolveInstalledGoogleChrome(workspaceRoot);
  const profileRoot = await mkdtemp(
    path.join(os.tmpdir(), "fan-support-p2-03-chrome-zoom-"),
  );
  let result;
  try {
    const baselinePreference = await writeNativeZoomPreferences(
      profileRoot,
      100,
    );
    const baseline = await runNativeZoomPass({
      candidate,
      chromium,
      executablePath: chrome.executablePath,
      origin,
      profileRoot,
      screenshot: nativeZoomScreenshots.baseline,
      verifyInteractions: false,
    });
    const zoomPreference = await writeNativeZoomPreferences(
      profileRoot,
      nativeZoomPercent,
    );
    const zoomed = await runNativeZoomPass({
      candidate,
      chromium,
      executablePath: chrome.executablePath,
      origin,
      profileRoot,
      screenshot: nativeZoomScreenshots.zoomed,
      verifyInteractions: true,
    });
    const measurementErrors = assessNativeZoomMeasurements({
      baseline: baseline.measurement,
      expectedPercent: nativeZoomPercent,
      zoomed: zoomed.measurement,
    });
    invariant(measurementErrors.length === 0, measurementErrors.join("; "));
    const screenshotErrors = assessNativeScreenshotEvidence({
      baseline,
      zoomed,
    });
    invariant(screenshotErrors.length === 0, screenshotErrors.join("; "));
    const persistedPreferences = JSON.parse(
      await readFile(zoomPreference.preferencesPath, "utf8"),
    );
    invariant(
      approximatelyEqual(
        persistedPreferences?.partition?.default_zoom_level?.x,
        zoomPreference.zoomLevel,
        1e-12,
      ),
      "Chrome did not persist the expected HostZoomMap zoom level",
    );
    result = {
      baseline: {
        ...baseline.measurement,
        checks: baseline.checks,
        diagnostics: baseline.diagnostics,
        fixtureUrl: baseline.fixtureUrl,
        metrics: baseline.metrics,
        screenshot: baseline.screenshot.path,
        screenshotEvidence: baseline.screenshot,
      },
      browser: chrome.version,
      detectedPercent:
        (zoomed.measurement.devicePixelRatio /
          baseline.measurement.devicePixelRatio) *
        100,
      method: nativeZoomMethod,
      preference: {
        baselineZoomLevel: baselinePreference.zoomLevel,
        zoomLevel: zoomPreference.zoomLevel,
      },
      profileRemoved: false,
      screenshots: [baseline.screenshot, zoomed.screenshot],
      zoomPercent: nativeZoomPercent,
      zoomed: {
        ...zoomed.measurement,
        checks: zoomed.checks,
        diagnostics: zoomed.diagnostics,
        fixtureUrl: zoomed.fixtureUrl,
        metrics: zoomed.metrics,
        screenshot: zoomed.screenshot.path,
        screenshotEvidence: zoomed.screenshot,
      },
    };
  } finally {
    await rm(profileRoot, { force: true, recursive: true });
  }
  invariant(
    !(await pathExists(profileRoot)),
    "isolated Chrome profile was not removed",
  );
  result.profileRemoved = true;
  return result;
}

async function requireRegularFile(candidate, relativePath, label) {
  const targetPath = path.join(candidate, ...relativePath.split("/"));
  let stat;
  try {
    stat = await lstat(targetPath);
  } catch {
    throw new Error("candidate evidence is missing " + label);
  }
  invariant(
    stat.isFile() && !stat.isSymbolicLink(),
    "candidate " + label + " must be a regular file",
  );
  return targetPath;
}

async function validateEvidenceCandidate(candidate) {
  const readmePath = await requireRegularFile(candidate, "README.md", "README");
  const resultsPath = await requireRegularFile(
    candidate,
    "browser-results.json",
    "browser results",
  );
  const manifestPath = await requireRegularFile(
    candidate,
    "screenshots.sha256",
    "screenshot manifest",
  );
  invariant(
    (await readFile(readmePath, "utf8")).startsWith(
      "# P2-03 UI interaction browser verification",
    ),
    "candidate README must identify P2-03",
  );
  let evidence;
  try {
    evidence = JSON.parse(await readFile(resultsPath, "utf8"));
  } catch {
    throw new Error("candidate browser-results.json must contain valid JSON");
  }
  const bundleErrors = validateEvidenceBundle(evidence);
  invariant(
    bundleErrors.length === 0,
    "candidate evidence is invalid:\n- " + bundleErrors.join("\n- "),
  );

  const manifestEntries = new Map();
  for (const line of (await readFile(manifestPath, "utf8"))
    .split("\n")
    .filter(Boolean)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    invariant(
      match !== null && isSafeRelativeArtifactPath(match[2], ".png"),
      "candidate screenshot manifest has an invalid entry",
    );
    invariant(
      !manifestEntries.has(match[2]),
      "candidate screenshot manifest has a duplicate path",
    );
    manifestEntries.set(match[2], match[1]);
  }
  invariant(
    manifestEntries.size === evidence.screenshots.length,
    "candidate screenshot manifest count does not match results",
  );
  for (const screenshot of evidence.screenshots) {
    const screenshotPath = await requireRegularFile(
      candidate,
      screenshot.path,
      "screenshot " + screenshot.path,
    );
    const buffer = await readFile(screenshotPath);
    const actualHash = createHash("sha256").update(buffer).digest("hex");
    invariant(
      actualHash === screenshot.sha256 &&
        manifestEntries.get(screenshot.path) === screenshot.sha256,
      "candidate screenshot hash mismatch for " + screenshot.path,
    );
    const dimensions = readPngDimensions(buffer);
    invariant(
      dimensions.width === screenshot.pixelWidth &&
        dimensions.height === screenshot.pixelHeight,
      "candidate screenshot dimensions mismatch for " + screenshot.path,
    );
  }

  for (const summary of evidence.axeSummaries) {
    const artifactPath = await requireRegularFile(
      candidate,
      summary.artifact,
      "axe artifact " + summary.artifact,
    );
    let artifact;
    try {
      artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    } catch {
      throw new Error(
        "axe artifact must contain valid JSON: " + summary.artifact,
      );
    }
    invariant(
      artifact?.schemaVersion === 1 &&
        JSON.stringify(artifact?.exclusions) ===
          JSON.stringify(createAxeExclusionPolicy()) &&
        artifact?.scan?.id === summary.id &&
        artifact?.scan?.scenarioId === summary.scenarioId &&
        artifact?.scan?.state === summary.state,
      "axe artifact metadata mismatch for " + summary.id,
    );
    const inventories = [
      artifact?.result?.inapplicable,
      artifact?.result?.incomplete,
      artifact?.result?.passes,
      artifact?.result?.violations,
    ];
    invariant(
      inventories.every(Array.isArray) &&
        inventories.reduce((total, entries) => total + entries.length, 0) > 0,
      "axe artifact must contain a non-empty rule inventory for " + summary.id,
    );
    const actualSummary = summarizeAxeResult(artifact.result);
    invariant(
      JSON.stringify(actualSummary.blocking) ===
        JSON.stringify(summary.blocking) &&
        JSON.stringify(actualSummary.counts) === JSON.stringify(summary.counts),
      "axe artifact summary mismatch for " + summary.id,
    );
  }
}

async function replaceEvidenceDirectory(candidate, target) {
  invariant(
    path.dirname(candidate) === path.dirname(target),
    "candidate and target evidence directories must be siblings",
  );
  const candidateStat = await lstat(candidate);
  invariant(
    candidateStat.isDirectory() && !candidateStat.isSymbolicLink(),
    "candidate evidence path must be a directory",
  );
  await validateEvidenceCandidate(candidate);
  if (!(await pathExists(target))) {
    await rename(candidate, target);
    return;
  }
  const backup = path.join(
    path.dirname(target),
    "." + path.basename(target) + "-backup-" + process.pid + "-" + randomUUID(),
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

async function runClosedRuntimeGate({
  candidate,
  environment,
  standaloneAppRoot,
}) {
  let server;
  try {
    server = await startStorefrontServer({
      candidate,
      environment,
      standaloneAppRoot,
    });
    const gate = await probeRuntime(server);
    invariant(
      gate.fixtureStatus === 404 &&
        gate.fixtures.every(
          ({ containsFixtureMarker, status }) =>
            status === 404 && containsFixtureMarker === false,
        ),
      environment + " must close every locale fixture without fixture HTML",
    );
    invariant(
      gate.healthStatus === 200,
      environment + " must keep healthz 200, received " + gate.healthStatus,
    );
    return gate;
  } finally {
    await stopStorefrontServer(server);
  }
}

export async function runUiInteractionsBrowserVerification({
  workspaceRoot = defaultWorkspaceRoot,
} = {}) {
  const matrixErrors = validateInteractionScenarioMatrix(
    createInteractionScenarioMatrix(),
  );
  invariant(
    matrixErrors.length === 0,
    "invalid interaction matrix:\n- " + matrixErrors.join("\n- "),
  );
  const evidenceParent = path.join(workspaceRoot, "output/playwright");
  const target = path.join(workspaceRoot, evidenceRelativePath);
  await mkdir(evidenceParent, { recursive: true });
  const candidate = await mkdtemp(
    path.join(evidenceParent, ".p2-03-candidate-"),
  );
  let previewServer;
  let committed = false;
  try {
    const [versions, git] = await Promise.all([
      collectToolchain(workspaceRoot),
      collectGitProvenance(workspaceRoot),
    ]);
    const { standaloneAppRoot } = await prepareProductionBuild(
      workspaceRoot,
      candidate,
    );
    previewServer = await startStorefrontServer({
      candidate,
      environment: "preview",
      standaloneAppRoot,
    });
    const previewGate = await probeRuntime(previewServer);
    invariant(
      previewGate.fixtureStatus === 200 &&
        previewGate.healthStatus === 200 &&
        previewGate.fixtures.every(
          ({ containsFixtureMarker, status }) =>
            status === 200 && containsFixtureMarker === true,
        ),
      "preview must expose fixture HTML for all locales and healthz 200",
    );
    const browserResult = await runBrowserMatrix({
      candidate,
      origin: previewServer.origin,
      versions,
    });
    process.stdout.write("\n[p2-03 browser] native-chrome-200-percent-pt\n");
    const nativeZoom = await runNativeChromeZoomVerification({
      candidate,
      origin: previewServer.origin,
      workspaceRoot,
    });
    browserResult.screenshots.push(...nativeZoom.screenshots);
    await stopStorefrontServer(previewServer);
    previewServer = undefined;

    const stagingGate = await runClosedRuntimeGate({
      candidate,
      environment: "staging",
      standaloneAppRoot,
    });
    const productionGate = await runClosedRuntimeGate({
      candidate,
      environment: "production",
      standaloneAppRoot,
    });
    const runtimeGates = [previewGate, stagingGate, productionGate];
    const endingGit = await collectGitProvenance(workspaceRoot, candidate);
    invariant(
      endingGit.sha === git.sha &&
        endingGit.dirty === false &&
        endingGit.status.length === 0,
      "source checkout or HEAD changed during browser verification",
    );
    git.rechecked = true;
    const generatedAt = new Date().toISOString();
    const evidence = {
      axeExclusions: createAxeExclusionPolicy(),
      axeSummaries: browserResult.axeSummaries,
      generatedAt,
      git,
      launch: { ...expectedLaunchProvenance },
      matrix: createInteractionScenarioMatrix(),
      nativeZoom,
      rerunCommand,
      result: "passed",
      runtimeGates,
      scenarioResults: browserResult.scenarioResults,
      schemaVersion: 1,
      screenshots: browserResult.screenshots,
      versions,
    };
    const evidenceErrors = validateEvidenceBundle(evidence);
    invariant(
      evidenceErrors.length === 0,
      "generated evidence is invalid:\n- " + evidenceErrors.join("\n- "),
    );
    await writeFile(
      path.join(candidate, "screenshots.sha256"),
      browserResult.screenshots
        .map((entry) => entry.sha256 + "  " + entry.path)
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
    await replaceEvidenceDirectory(candidate, target);
    committed = true;
    process.stdout.write(
      "\nP2-03 browser verification passed; evidence: " + target + "\n",
    );
    return evidence;
  } finally {
    await stopStorefrontServer(previewServer);
    if (!committed) {
      await rm(candidate, { force: true, recursive: true });
    }
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === scriptPath
) {
  runUiInteractionsBrowserVerification().catch((error) => {
    process.stderr.write(
      "P2-03 browser verification failed\n" + formatError(error) + "\n",
    );
    process.exitCode = 1;
  });
}
