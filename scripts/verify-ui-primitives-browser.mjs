/* global AbortSignal, CSS, HTMLImageElement, HTMLElement, URL, document, fetch, getComputedStyle, innerHeight, innerWidth, matchMedia, setTimeout, window */

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

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const evidenceRelativePath = "output/playwright/p2-02";
const fixturePath = "/_internal/design-foundations/en/primitives";
const rerunCommand =
  "mise exec node@24.20.0 -- node scripts/verify-ui-primitives-browser.mjs";
const nativeZoomLocale = "pt";
const nativeZoomPercent = 200;
const nativeZoomScreenshots = Object.freeze({
  baseline: "zoom/google-chrome-baseline-pt.png",
  zoomed: "zoom/google-chrome-200-percent-pt.png",
});

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
  "default-desktop",
  "default-mobile",
  "error",
  "loading",
  "pseudo-320",
  "rtl",
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

const browserScenarioMatrix = Object.freeze([
  scenario({
    axe: [],
    group: "baseline",
    id: "viewport-360x800-en",
    locale: "en",
    screenshot: "viewports/360x800-en.png",
    viewport: { height: 800, width: 360 },
  }),
  scenario({
    axe: [axeScan("default-mobile")],
    group: "baseline",
    id: "viewport-390x844-vi",
    locale: "vi",
    screenshot: "viewports/390x844-vi.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    group: "baseline",
    id: "viewport-768x1024-th",
    locale: "th",
    screenshot: "viewports/768x1024-th.png",
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
    axe: [axeScan("default-desktop")],
    group: "baseline",
    id: "viewport-1440x900-ja",
    locale: "ja",
    screenshot: "viewports/1440x900-ja.png",
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
    screenshot: "stress/320x800-en-XA.png",
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
      axeScan("error", '[data-media-state="error"]'),
      axeScan("loading", '[data-loading="true"]'),
    ],
    checks: [
      "keyboard",
      "disabled",
      "loading",
      "field",
      "quantity",
      "media-error",
    ],
    group: "interaction",
    id: "interaction-390x844-en",
    locale: "en",
    screenshot: "interactions/390x844-en-keyboard.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    checks: ["hover"],
    group: "hover",
    id: "hover-1440x900-en",
    locale: "en",
    screenshot: "interactions/1440x900-en-hover.png",
    viewport: { height: 900, width: 1440 },
  }),
  scenario({
    axe: [axeScan("rtl", '[data-rtl-probe="true"]')],
    checks: ["rtl-quantity"],
    group: "rtl",
    id: "rtl-390x844-en",
    locale: "en",
    screenshot: "rtl/390x844-en-rtl.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    group: "reduced-motion",
    id: "reduced-motion-390x844-en",
    locale: "en",
    reducedMotion: true,
    screenshot: "reduced-motion/390x844-en-reduce.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    axe: [],
    group: "reduced-motion",
    id: "reduced-motion-1440x900-en",
    locale: "en",
    reducedMotion: true,
    screenshot: "reduced-motion/1440x900-en-reduce.png",
    viewport: { height: 900, width: 1440 },
  }),
]);

export function createBrowserScenarioMatrix() {
  return browserScenarioMatrix;
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

export function validateScenarioMatrix(matrix) {
  const errors = [];
  if (!Array.isArray(matrix)) {
    return ["browser scenario matrix must be an array"];
  }

  const ids = new Set();
  const screenshots = new Set();
  const axeIds = [];
  const seenAxeIds = new Set();
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
      if (scan === null || typeof scan !== "object") {
        errors.push(
          "scenario " + String(entry.id) + " has an invalid axe scan",
        );
        continue;
      }
      if (
        typeof scan.id !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(scan.id)
      ) {
        errors.push(
          "scenario " +
            String(entry.id) +
            " needs a safe lowercase axe scan id",
        );
        continue;
      }
      axeIds.push(scan.id);
      if (seenAxeIds.has(scan.id)) {
        errors.push("duplicate axe scan id " + scan.id);
      } else {
        seenAxeIds.add(scan.id);
      }
      if (!requiredAxeScanSet.has(scan.id)) {
        errors.push("scenario " + entry.id + " has an unapproved axe scan id");
      }
    }
  }

  const baselineKeys = matrix
    .filter((entry) => entry?.group === "baseline")
    .map((entry) =>
      caseKey(entry.viewport?.width, entry.viewport?.height, entry.locale),
    );
  const expectedBaselineKeys = requiredBaselineCases.map(
    ([width, height, locale]) => caseKey(width, height, locale),
  );
  if (
    baselineKeys.length !== expectedBaselineKeys.length ||
    expectedBaselineKeys.some((key) => !baselineKeys.includes(key))
  ) {
    errors.push("matrix must contain all six exact baseline viewport cases");
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
  const interaction = matrix.find(
    (entry) => entry?.id === "interaction-390x844-en",
  );
  for (const check of [
    "keyboard",
    "disabled",
    "loading",
    "field",
    "quantity",
    "media-error",
  ]) {
    if (!interaction?.checks?.includes(check)) {
      errors.push("390px interaction scenario must include " + check);
    }
  }
  if (
    !matrix.some(
      (entry) =>
        entry?.viewport?.width === 1440 &&
        entry.viewport.height === 900 &&
        entry.checks?.includes("hover"),
    )
  ) {
    errors.push("matrix must contain the 1440px hover case");
  }
  if (!matrix.some((entry) => entry?.checks?.includes("rtl-quantity"))) {
    errors.push("matrix must contain an explicit RTL Quantity case");
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
  for (const requiredScan of requiredAxeScans) {
    if (axeIds.filter((id) => id === requiredScan).length !== 1) {
      errors.push("matrix must contain one axe scan named " + requiredScan);
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
  if (parsed.protocol === "data:" || parsed.protocol === "about:") {
    return { allowed: true, reason: "embedded" };
  }
  if (parsed.protocol === "blob:") {
    return parsed.origin === origin
      ? { allowed: true, reason: "embedded" }
      : { allowed: false, reason: "external-origin" };
  }
  if (parsed.origin === origin) {
    return { allowed: true, reason: "same-origin" };
  }
  return { allowed: false, reason: "external-origin" };
}

export function assessPageMetrics(metrics) {
  const errors = [];
  const clientWidth = Number(metrics?.document?.clientWidth ?? 0);
  const scrollWidth = Math.max(
    Number(metrics?.document?.scrollWidth ?? 0),
    Number(metrics?.document?.bodyScrollWidth ?? 0),
  );
  if (clientWidth <= 0 || scrollWidth > clientWidth + 0.5) {
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
    if (control.width < 48 || control.height < 48) {
      errors.push(
        "control below 48px: " +
          String(control.label) +
          " is " +
          String(control.width) +
          "x" +
          String(control.height),
      );
    }
  }
  for (const contrast of metrics?.contrastChecks ?? []) {
    if (
      !Number.isFinite(contrast.ratio) ||
      !Number.isFinite(contrast.required) ||
      contrast.ratio < contrast.required
    ) {
      errors.push(
        "non-text contrast below " +
          String(contrast.required) +
          ":1: " +
          String(contrast.label) +
          " is " +
          String(contrast.ratio) +
          ":1",
      );
    }
  }
  if (Number(metrics?.replacementGlyphs ?? 0) > 0) {
    errors.push(
      "replacement glyph count: " + String(metrics.replacementGlyphs),
    );
  }
  if (metrics?.fontsStatus !== undefined && metrics.fontsStatus !== "loaded") {
    errors.push(
      "document fonts are not loaded: " + String(metrics.fontsStatus),
    );
  }
  return errors;
}

export function assessLoadingButtonLayout(layout) {
  const errors = [];
  const button = layout?.button;
  const label = layout?.label;
  if (
    !Number.isFinite(label?.width) ||
    !Number.isFinite(label?.height) ||
    label?.width <= 0 ||
    label?.height <= 0 ||
    label?.display === "none"
  ) {
    errors.push("loading Button label footprint must remain non-zero");
  }
  if (Number.parseFloat(String(label?.opacity)) !== 0) {
    errors.push("loading Button label opacity must be zero");
  }
  if (label?.position === "absolute" || label?.position === "fixed") {
    errors.push("loading Button label must remain in normal layout flow");
  }
  const bounds = [
    button?.x,
    button?.y,
    button?.width,
    button?.height,
    label?.x,
    label?.y,
    label?.width,
    label?.height,
  ];
  const buttonRight = button?.x + button?.width;
  const buttonBottom = button?.y + button?.height;
  const labelRight = label?.x + label?.width;
  const labelBottom = label?.y + label?.height;
  if (
    bounds.some((value) => !Number.isFinite(value)) ||
    label?.x < button?.x - 0.5 ||
    label?.y < button?.y - 0.5 ||
    labelRight > buttonRight + 0.5 ||
    labelBottom > buttonBottom + 0.5
  ) {
    errors.push(
      "loading Button label footprint must stay inside Button bounds",
    );
  }
  if (layout?.spinner?.position !== "absolute") {
    errors.push("loading Button spinner must use an absolute overlay");
  }
  return errors;
}

export function createNativeZoomProfilePreferences(zoomPercent) {
  if (!Number.isFinite(zoomPercent) || zoomPercent < 25 || zoomPercent > 500) {
    throw new Error("Chrome default zoom must be between 25 and 500 percent");
  }
  return {
    browser: {
      check_default_browser: false,
    },
    partition: {
      default_zoom_level: {
        x: Math.log(zoomPercent / 100) / Math.log(1.2),
      },
    },
    profile: {
      exit_type: "Normal",
      exited_cleanly: true,
    },
  };
}

export function createNativeZoomLaunchOptions(executablePath, baseURL) {
  return {
    args: [
      "--no-default-browser-check",
      "--no-first-run",
      "--window-position=0,0",
      "--window-size=1710,929",
    ],
    baseURL,
    colorScheme: "dark",
    executablePath,
    headless: false,
    locale: "pt",
    serviceWorkers: "block",
    viewport: null,
  };
}

function approximatelyEqual(actual, expected, tolerance) {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <= tolerance
  );
}

export function assessNativeZoomMeasurements({
  baseline,
  expectedPercent,
  zoomed,
}) {
  const errors = [];
  const expectedRatio = expectedPercent / 100;
  const outerWidthTolerance = Math.max(4, baseline?.outerWidth * 0.01);
  const outerHeightTolerance = Math.max(4, baseline?.outerHeight * 0.01);
  if (
    !approximatelyEqual(
      zoomed?.outerWidth,
      baseline?.outerWidth,
      outerWidthTolerance,
    ) ||
    !approximatelyEqual(
      zoomed?.outerHeight,
      baseline?.outerHeight,
      outerHeightTolerance,
    )
  ) {
    errors.push("native zoom must keep the outer window dimensions stable");
  }
  const expectedViewportRatio = 1 / expectedRatio;
  const widthRatio = zoomed?.innerWidth / baseline?.innerWidth;
  const heightRatio = zoomed?.innerHeight / baseline?.innerHeight;
  if (!approximatelyEqual(widthRatio, expectedViewportRatio, 0.04)) {
    errors.push("native zoom must reduce the CSS viewport width by 200%");
  }
  if (!approximatelyEqual(heightRatio, expectedViewportRatio, 0.04)) {
    errors.push("native zoom must reduce the CSS viewport height by 200%");
  }
  const pixelRatio = zoomed?.devicePixelRatio / baseline?.devicePixelRatio;
  if (!approximatelyEqual(pixelRatio, expectedRatio, 0.08)) {
    errors.push("native zoom must multiply the device pixel ratio by 200%");
  }
  if (
    !approximatelyEqual(baseline?.visualViewport?.scale, 1, 0.01) ||
    !approximatelyEqual(zoomed?.visualViewport?.scale, 1, 0.01)
  ) {
    errors.push("native browser zoom must keep visual viewport scale at one");
  }
  for (const [label, measurement] of [
    ["baseline", baseline],
    ["zoomed", zoomed],
  ]) {
    if (
      !approximatelyEqual(
        measurement?.visualViewport?.width,
        measurement?.innerWidth,
        2,
      ) ||
      !approximatelyEqual(
        measurement?.visualViewport?.height,
        measurement?.innerHeight,
        2,
      )
    ) {
      errors.push(label + " visual viewport must match the CSS viewport");
    }
  }
  return errors;
}

export function readPngDimensions(value) {
  if (
    !Buffer.isBuffer(value) ||
    value.length < 24 ||
    value.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    value.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("native screenshot must be a PNG with an IHDR header");
  }
  const width = value.readUInt32BE(16);
  const height = value.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error("native screenshot PNG dimensions must be positive");
  }
  return { height, width };
}

export function assessNativeScreenshotEvidence({ baseline, zoomed }) {
  const errors = [];
  for (const [label, pass] of [
    ["baseline", baseline],
    ["zoomed", zoomed],
  ]) {
    const expectedWidth = Math.round(
      pass?.measurement?.innerWidth * pass?.measurement?.devicePixelRatio,
    );
    const expectedHeight = Math.round(
      pass?.measurement?.innerHeight * pass?.measurement?.devicePixelRatio,
    );
    if (
      !Number.isSafeInteger(expectedWidth) ||
      !Number.isSafeInteger(expectedHeight) ||
      pass?.screenshot?.pixelWidth !== expectedWidth ||
      pass?.screenshot?.pixelHeight !== expectedHeight
    ) {
      errors.push(
        label +
          " native screenshot must cover the complete physical viewport " +
          String(expectedWidth) +
          "x" +
          String(expectedHeight),
      );
    }
    if (
      typeof pass?.screenshot?.captureMethod !== "string" ||
      !pass.screenshot.captureMethod.includes("Page.captureScreenshot")
    ) {
      errors.push(label + " native screenshot must record its capture method");
    }
    const marker = pass?.screenshot?.localeMarker;
    const markerValues = [marker?.x, marker?.y, marker?.width, marker?.height];
    if (
      marker?.changedFromHidden !== true ||
      markerValues.some((value) => !Number.isFinite(value)) ||
      marker.width <= 0 ||
      marker.height <= 0 ||
      marker.x < pass.screenshot.pixelWidth / 2 ||
      marker.y < 0 ||
      marker.x + marker.width > pass.screenshot.pixelWidth + 1 ||
      marker.y + marker.height > pass.screenshot.pixelHeight + 1
    ) {
      errors.push(
        label +
          " native screenshot must visibly contain the right-edge locale marker",
      );
    }
  }
  if (
    baseline?.screenshot?.pixelWidth !== zoomed?.screenshot?.pixelWidth ||
    baseline?.screenshot?.pixelHeight !== zoomed?.screenshot?.pixelHeight
  ) {
    errors.push(
      "baseline and zoomed native screenshots must cover the same physical viewport",
    );
  }
  return errors;
}

export function summarizeAxeResult(result) {
  const inapplicable = Array.isArray(result?.inapplicable)
    ? result.inapplicable
    : [];
  const incomplete = Array.isArray(result?.incomplete) ? result.incomplete : [];
  const passes = Array.isArray(result?.passes) ? result.passes : [];
  const violations = Array.isArray(result?.violations) ? result.violations : [];
  return {
    blocking: violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodeCount: Array.isArray(violation.nodes) ? violation.nodes.length : 0,
      })),
    counts: {
      inapplicable: inapplicable.length,
      incomplete: incomplete.length,
      passes: passes.length,
      violations: violations.length,
    },
  };
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createEvidenceReadme({
  axeSummaries = [],
  generatedAt,
  git,
  nativeZoom,
  rerunCommand: command,
  runtimeGates,
  scenarioResults = [],
  screenshots,
  versions,
}) {
  const tick = String.fromCharCode(96);
  const lines = [
    "# P2-02 UI primitive browser verification",
    "",
    "Generated at " + generatedAt + ".",
    "",
    "## Provenance",
    "",
    "- Git SHA: " + tick + git.sha + tick,
    "- dirty: " + String(git.dirty),
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
    command,
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
        String(gate.healthStatus),
    );
  }
  if (nativeZoom !== undefined) {
    lines.push(
      "",
      "## Native Google Chrome zoom",
      "",
      "- Method: " + nativeZoom.method + ".",
      "- Zoom: " + String(nativeZoom.zoomPercent) + "%.",
      "- Baseline CSS viewport " +
        String(nativeZoom.baseline.innerWidth) +
        "×" +
        String(nativeZoom.baseline.innerHeight) +
        "; zoomed CSS viewport " +
        String(nativeZoom.zoomed.innerWidth) +
        "×" +
        String(nativeZoom.zoomed.innerHeight) +
        ".",
      "- DPR " +
        String(nativeZoom.baseline.devicePixelRatio) +
        " → " +
        String(nativeZoom.zoomed.devicePixelRatio) +
        "; outer window " +
        String(nativeZoom.baseline.outerWidth) +
        "×" +
        String(nativeZoom.baseline.outerHeight) +
        " → " +
        String(nativeZoom.zoomed.outerWidth) +
        "×" +
        String(nativeZoom.zoomed.outerHeight) +
        ".",
      "- The isolated temporary profile was removed: " +
        String(nativeZoom.profileRemoved) +
        ".",
    );
  }
  if (scenarioResults.length > 0) {
    lines.push("", "## Scenario results", "");
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
  }
  if (axeSummaries.length > 0) {
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
    "This is local production-build evidence under the preview gate. It is not staging, production deployment, formal brand approval, or real-device performance evidence.",
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

export async function replaceEvidenceDirectory(candidate, target) {
  if (path.dirname(candidate) !== path.dirname(target)) {
    throw new Error(
      "candidate and target evidence directories must be siblings",
    );
  }
  const candidateStat = await lstat(candidate);
  if (!candidateStat.isDirectory()) {
    throw new Error("candidate evidence path must be a directory");
  }
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

async function requireCandidateFile(candidate, relativePath, label) {
  const targetPath = path.join(candidate, ...relativePath.split("/"));
  let targetStat;
  try {
    targetStat = await lstat(targetPath);
  } catch {
    throw new Error("candidate evidence is missing " + label);
  }
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
    throw new Error("candidate " + label + " must be a regular file");
  }
  return targetPath;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assessDiagnosticsEvidence(diagnostics, expectedFixtureUrl) {
  const errors = [];
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
    return ["diagnostics must contain all six result arrays"];
  }
  if (
    diagnostics.requests.length === 0 ||
    !diagnostics.requests.some((request) => {
      if (request?.resourceType !== "document") {
        return false;
      }
      try {
        return new URL(request.url).pathname === expectedFixtureUrl;
      } catch {
        return false;
      }
    }) ||
    diagnostics.requests.some(
      (request) =>
        request?.allowed !== true ||
        typeof request.method !== "string" ||
        typeof request.resourceType !== "string" ||
        typeof request.url !== "string",
    )
  ) {
    errors.push("diagnostics must contain allowed browser requests");
  }
  errors.push(...diagnosticsErrors(diagnostics));
  return errors;
}

function assessMetricsEvidence(metrics, expectedClientWidth) {
  const errors = [];
  if (
    !isRecord(metrics) ||
    !Array.isArray(metrics.clippedText) ||
    !Array.isArray(metrics.contrastChecks) ||
    !Array.isArray(metrics.controls) ||
    !isRecord(metrics.document)
  ) {
    return [
      "metrics must contain clipping, contrast, controls, and document data",
    ];
  }
  if (
    metrics.controls.length < 8 ||
    metrics.controls.some(
      (control) =>
        !Number.isFinite(control?.width) ||
        !Number.isFinite(control?.height) ||
        typeof control?.label !== "string" ||
        typeof control?.selector !== "string",
    )
  ) {
    errors.push("metrics must contain the primitive control inventory");
  }
  const contrastLabels = new Set(
    metrics.contrastChecks.map((contrast) => contrast?.label),
  );
  if (
    metrics.contrastChecks.length !== 3 ||
    !["Field", "Quantity", "Secondary Button"].every((label) =>
      contrastLabels.has(label),
    ) ||
    metrics.contrastChecks.some(
      (contrast) =>
        typeof contrast?.background !== "string" ||
        typeof contrast?.border !== "string" ||
        !Number.isFinite(contrast?.ratio) ||
        contrast?.required !== 3,
    )
  ) {
    errors.push("metrics must contain all three non-text contrast probes");
  }
  if (
    !Number.isFinite(metrics.document.clientWidth) ||
    !Number.isFinite(metrics.document.scrollWidth) ||
    !Number.isFinite(metrics.document.bodyScrollWidth) ||
    !approximatelyEqual(metrics.document.clientWidth, expectedClientWidth, 0.5)
  ) {
    errors.push(
      "metrics document widths must be finite and match the measured viewport",
    );
  }
  if (metrics.fontsStatus !== "loaded") {
    errors.push("metrics must prove document fonts are loaded");
  }
  if (metrics.replacementGlyphs !== 0) {
    errors.push("metrics must prove there are no replacement glyphs");
  }
  errors.push(...assessPageMetrics(metrics));
  return errors;
}

function assessInteractionEvidence(checks, viewport) {
  const errors = [];
  if (!isRecord(checks)) {
    return ["interaction checks must be an object"];
  }
  if (
    !Array.isArray(checks.tabOrder) ||
    !checks.tabOrder.some((entry) => entry?.testId === "primary-action") ||
    !checks.tabOrder.some(
      (entry) =>
        entry?.testId === "media-error-trigger" && entry?.disabled === false,
    ) ||
    checks.tabOrder.some((entry) => entry?.loading === "true")
  ) {
    errors.push("interaction checks must prove the keyboard tab order");
  }
  const focus = checks.keyboard?.focusStyle;
  if (
    checks.keyboard?.activationCount !== 2 ||
    focus?.focusVisible !== true ||
    focus?.outlineStyle === "none" ||
    !(Number.parseFloat(String(focus?.outlineWidth)) > 0) ||
    !approximatelyEqual(focus?.viewportWidth, viewport?.width, 0.5) ||
    !approximatelyEqual(focus?.viewportHeight, viewport?.height, 0.5) ||
    !(focus?.x >= 0 && focus?.x < viewport?.width) ||
    !(focus?.y >= 0 && focus?.y < viewport?.height)
  ) {
    errors.push("interaction checks must prove keyboard activation and focus");
  }
  if (
    checks.disabled?.disabled !== true ||
    checks.disabled?.skippedByTab !== true
  ) {
    errors.push("interaction checks must prove disabled Button behavior");
  }
  if (
    checks.loading?.ariaBusy !== true ||
    checks.loading?.disabled !== true ||
    checks.loading?.skippedByTab !== true ||
    assessLoadingButtonLayout(checks.loading?.layout).length > 0
  ) {
    errors.push("interaction checks must prove loading Button behavior");
  }
  const describedBy = checks.field?.describedBy;
  if (
    checks.field?.invalid !== true ||
    checks.field?.labelAssociated !== true ||
    !Array.isArray(describedBy) ||
    !["primitive-display-name-hint", "primitive-display-name-error"].every(
      (id) => describedBy.includes(id),
    )
  ) {
    errors.push("interaction checks must prove Field semantics");
  }
  if (
    checks.quantity?.arrowDown !== 2 ||
    checks.quantity?.arrowUp !== 3 ||
    checks.quantity?.end !== 5 ||
    checks.quantity?.home !== 1 ||
    checks.quantity?.semantics !== "number spinbutton"
  ) {
    errors.push("interaction checks must prove Quantity behavior");
  }
  const beforeFrames = checks.mediaError?.frameBefore;
  const afterFrames = checks.mediaError?.frameAfter;
  if (
    checks.mediaError?.accessibleFallback !== true ||
    checks.mediaError?.browserDecodeFailed !== true ||
    checks.mediaError?.sourceChanged !== true ||
    checks.mediaError?.triggerClicked !== true ||
    typeof checks.mediaError?.initialSrc !== "string" ||
    checks.mediaError.initialSrc.length === 0 ||
    typeof checks.mediaError?.requestedSrc !== "string" ||
    checks.mediaError.requestedSrc.length === 0 ||
    checks.mediaError.requestedSrc === checks.mediaError.initialSrc ||
    !Array.isArray(beforeFrames) ||
    !Array.isArray(afterFrames) ||
    beforeFrames.length === 0 ||
    beforeFrames.length !== afterFrames.length ||
    beforeFrames.some(
      (before, index) =>
        !Number.isFinite(before?.width) ||
        !Number.isFinite(before?.height) ||
        before.width <= 0 ||
        before.height <= 0 ||
        !approximatelyEqual(before.width, afterFrames[index]?.width, 0.5) ||
        !approximatelyEqual(before.height, afterFrames[index]?.height, 0.5),
    )
  ) {
    errors.push("interaction checks must prove Media fallback stability");
  }
  return errors;
}

function assessScenarioChecksEvidence(checks, expected) {
  if (!isRecord(checks)) {
    return ["scenario checks must be an object"];
  }
  const errors = [];
  if (expected.checks.includes("keyboard")) {
    errors.push(...assessInteractionEvidence(checks, expected.viewport));
  }
  if (expected.checks.includes("hover")) {
    const hover = checks.hover;
    if (
      !isRecord(hover) ||
      hover.buttonAfter === hover.buttonBefore ||
      hover.buttonAfter === "none" ||
      hover.fieldAfter === hover.fieldBefore ||
      hover.linkAfter === hover.linkBefore
    ) {
      errors.push("scenario checks must prove hover state changes");
    }
  }
  if (expected.checks.includes("rtl-quantity")) {
    const rtl = checks.rtlQuantity;
    if (
      rtl?.probeDirection !== "rtl" ||
      rtl?.controlsDirection !== "ltr" ||
      JSON.stringify(rtl?.actionOrder) !==
        JSON.stringify(["decrease", "true", "increase"]) ||
      rtl?.arrowUp !== 3 ||
      rtl?.arrowDown !== 2
    ) {
      errors.push("scenario checks must prove RTL Quantity behavior");
    }
  }
  if (expected.reducedMotion === true) {
    if (
      checks.reducedMotion?.mediaQuery !== true ||
      assessReducedMotionStyles(checks.reducedMotion).length > 0
    ) {
      errors.push("scenario checks must prove reduced motion behavior");
    }
  }
  if (
    expected.checks.length === 0 &&
    expected.reducedMotion !== true &&
    Object.keys(checks).length !== 0
  ) {
    errors.push("scenario without interactions must have empty checks");
  }
  return errors;
}

function assessScenarioResultEvidence(result, expected) {
  const expectedFixtureUrl =
    "/_internal/design-foundations/" +
    encodeURIComponent(expected.locale) +
    "/primitives";
  const errors = [];
  if (
    result?.group !== expected.group ||
    result?.locale !== expected.locale ||
    result?.fixtureUrl !== expectedFixtureUrl ||
    result?.reducedMotion !== (expected.reducedMotion === true) ||
    JSON.stringify(result?.viewport) !== JSON.stringify(expected.viewport)
  ) {
    errors.push("scenario metadata does not match the matrix");
  }
  errors.push(
    ...assessMetricsEvidence(result?.metrics, expected.viewport.width),
    ...assessDiagnosticsEvidence(result?.diagnostics, expectedFixtureUrl),
    ...assessScenarioChecksEvidence(result?.checks, expected),
  );
  return errors;
}

function assessPrimitiveCountEvidence(primitiveCounts) {
  const primitives = [
    "button",
    "link",
    "icon",
    "media",
    "price",
    "status",
    "field",
    "quantity",
  ];
  if (
    !isRecord(primitiveCounts) ||
    Object.keys(primitiveCounts).length !== primitives.length ||
    primitives.some(
      (primitive) =>
        !Number.isSafeInteger(primitiveCounts[primitive]) ||
        primitiveCounts[primitive] <= 0,
    )
  ) {
    return ["primitive counts must prove all eight primitives are present"];
  }
  return [];
}

function assessNativePassEvidence(pass, { interaction }) {
  const expectedFixtureUrl =
    "/_internal/design-foundations/" + nativeZoomLocale + "/primitives";
  const errors = [
    ...assessMetricsEvidence(pass?.metrics, pass?.innerWidth),
    ...assessDiagnosticsEvidence(pass?.diagnostics, expectedFixtureUrl),
    ...assessPrimitiveCountEvidence(pass?.primitiveCounts),
  ];
  if (pass?.fixtureUrl !== expectedFixtureUrl) {
    errors.push("native pass fixture URL is invalid");
  }
  if (interaction) {
    errors.push(
      ...assessInteractionEvidence(pass?.checks, {
        height: pass?.innerHeight,
        width: pass?.innerWidth,
      }),
    );
  } else if (!isRecord(pass?.checks) || Object.keys(pass.checks).length !== 0) {
    errors.push("native baseline checks must be empty");
  }
  return errors;
}

async function validateEvidenceCandidate(candidate) {
  const resultsPath = await requireCandidateFile(
    candidate,
    "browser-results.json",
    "browser-results.json",
  );
  await requireCandidateFile(candidate, "README.md", "README.md");
  const manifestPath = await requireCandidateFile(
    candidate,
    "screenshots.sha256",
    "screenshots.sha256",
  );

  let results;
  try {
    results = JSON.parse(await readFile(resultsPath, "utf8"));
  } catch {
    throw new Error("candidate browser-results.json must be valid JSON");
  }
  if (
    results?.schemaVersion !== 1 ||
    results.result !== "passed" ||
    !Array.isArray(results.screenshots) ||
    !Array.isArray(results.axeSummaries) ||
    !Array.isArray(results.matrix) ||
    !Array.isArray(results.scenarioResults) ||
    !Array.isArray(results.runtimeGates)
  ) {
    throw new Error("candidate browser-results.json is incomplete");
  }

  const expectedScenarios = createBrowserScenarioMatrix();
  if (JSON.stringify(results.matrix) !== JSON.stringify(expectedScenarios)) {
    throw new Error(
      "candidate browser-results.json must contain the exact scenario matrix",
    );
  }
  const expectedScenarioById = new Map(
    expectedScenarios.map((entry) => [entry.id, entry]),
  );
  const scenarioIds = results.scenarioResults.map((entry) => entry?.id);
  if (
    results.scenarioResults.length !== expectedScenarios.length ||
    new Set(scenarioIds).size !== expectedScenarios.length ||
    [...expectedScenarioById.keys()].some((id) => !scenarioIds.includes(id)) ||
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
    throw new Error(
      "candidate browser-results.json must contain exactly 13 scenario results",
    );
  }
  for (const scenarioResult of results.scenarioResults) {
    const scenarioErrors = assessScenarioResultEvidence(
      scenarioResult,
      expectedScenarioById.get(scenarioResult.id),
    );
    if (scenarioErrors.length > 0) {
      throw new Error(
        "candidate scenario evidence is invalid for " +
          scenarioResult.id +
          ": " +
          scenarioErrors.join("; "),
      );
    }
  }

  const expectedAxeById = new Map(
    expectedScenarios.flatMap((entry) =>
      entry.axe.map((scan) => [scan.id, { scenarioId: entry.id }]),
    ),
  );
  const axeIds = results.axeSummaries.map((summary) => summary?.id);
  if (
    results.axeSummaries.length !== requiredAxeScans.length ||
    new Set(axeIds).size !== requiredAxeScans.length ||
    requiredAxeScans.some((id) => !axeIds.includes(id)) ||
    results.axeSummaries.some((summary) => {
      const expected = expectedAxeById.get(summary?.id);
      return (
        expected === undefined || summary.scenarioId !== expected.scenarioId
      );
    })
  ) {
    throw new Error(
      "candidate browser-results.json must contain exactly six axe summaries",
    );
  }

  const expectedRuntimeGates = new Map([
    ["preview", { fixtureStatus: 200, healthStatus: 200 }],
    ["staging", { fixtureStatus: 404, healthStatus: 200 }],
    ["production", { fixtureStatus: 404, healthStatus: 200 }],
  ]);
  const runtimeEnvironments = results.runtimeGates.map(
    (gate) => gate?.environment,
  );
  if (
    results.runtimeGates.length !== expectedRuntimeGates.size ||
    new Set(runtimeEnvironments).size !== expectedRuntimeGates.size ||
    results.runtimeGates.some((gate) => {
      const expected = expectedRuntimeGates.get(gate?.environment);
      return (
        expected === undefined ||
        gate.fixtureStatus !== expected.fixtureStatus ||
        gate.healthStatus !== expected.healthStatus
      );
    })
  ) {
    throw new Error(
      "candidate browser-results.json must contain exactly three runtime gates",
    );
  }

  if (
    results.nativeZoom === null ||
    typeof results.nativeZoom !== "object" ||
    results.nativeZoom.zoomPercent !== nativeZoomPercent ||
    !approximatelyEqual(
      results.nativeZoom.detectedPercent,
      nativeZoomPercent,
      0.5,
    ) ||
    !Array.isArray(results.nativeZoom.screenshots)
  ) {
    throw new Error(
      "candidate browser-results.json is missing the native zoom proof",
    );
  }
  if (results.nativeZoom.profileRemoved !== true) {
    throw new Error(
      "candidate browser-results.json must prove native zoom profile removal",
    );
  }
  const nativeMeasurementErrors = assessNativeZoomMeasurements({
    baseline: results.nativeZoom.baseline,
    expectedPercent: nativeZoomPercent,
    zoomed: results.nativeZoom.zoomed,
  });
  if (nativeMeasurementErrors.length > 0) {
    throw new Error(
      "candidate native zoom measurements are invalid: " +
        nativeMeasurementErrors.join("; "),
    );
  }
  for (const [label, pass, interaction] of [
    ["baseline", results.nativeZoom.baseline, false],
    ["zoomed", results.nativeZoom.zoomed, true],
  ]) {
    const passErrors = assessNativePassEvidence(pass, { interaction });
    if (passErrors.length > 0) {
      throw new Error(
        "candidate native " +
          label +
          " evidence is invalid: " +
          passErrors.join("; "),
      );
    }
  }

  const expectedScreenshotPaths = [
    ...expectedScenarios.map((entry) => entry.screenshot),
    nativeZoomScreenshots.baseline,
    nativeZoomScreenshots.zoomed,
  ];
  const declaredScreenshotPaths = results.screenshots.map(
    (screenshot) => screenshot?.path,
  );
  if (
    results.screenshots.length !== expectedScreenshotPaths.length ||
    new Set(declaredScreenshotPaths).size !== expectedScreenshotPaths.length ||
    expectedScreenshotPaths.some(
      (screenshotPath) => !declaredScreenshotPaths.includes(screenshotPath),
    )
  ) {
    throw new Error(
      "candidate browser-results.json must contain exactly 15 screenshots",
    );
  }
  const nativeScreenshotPaths = Object.values(nativeZoomScreenshots);
  const nativeDeclaredPaths = results.nativeZoom.screenshots.map(
    (screenshot) => screenshot?.path,
  );
  if (
    results.nativeZoom.screenshots.length !== nativeScreenshotPaths.length ||
    new Set(nativeDeclaredPaths).size !== nativeScreenshotPaths.length ||
    nativeScreenshotPaths.some(
      (screenshotPath) => !nativeDeclaredPaths.includes(screenshotPath),
    )
  ) {
    throw new Error(
      "candidate browser-results.json has an invalid native screenshot set",
    );
  }

  const mainScreenshotByPath = new Map(
    results.screenshots.map((screenshot) => [screenshot.path, screenshot]),
  );
  for (const nativeScreenshot of results.nativeZoom.screenshots) {
    const mainScreenshot = mainScreenshotByPath.get(nativeScreenshot.path);
    if (
      mainScreenshot === undefined ||
      JSON.stringify(mainScreenshot) !== JSON.stringify(nativeScreenshot)
    ) {
      throw new Error(
        "candidate native screenshot evidence must match the screenshot manifest",
      );
    }
  }
  const baselineScreenshot = mainScreenshotByPath.get(
    nativeZoomScreenshots.baseline,
  );
  const zoomedScreenshot = mainScreenshotByPath.get(
    nativeZoomScreenshots.zoomed,
  );
  if (
    JSON.stringify(results.nativeZoom.baseline?.screenshotEvidence) !==
      JSON.stringify(baselineScreenshot) ||
    JSON.stringify(results.nativeZoom.zoomed?.screenshotEvidence) !==
      JSON.stringify(zoomedScreenshot)
  ) {
    throw new Error(
      "candidate native zoom passes must reference their screenshot evidence",
    );
  }
  const nativeScreenshotErrors = assessNativeScreenshotEvidence({
    baseline: {
      measurement: results.nativeZoom.baseline,
      screenshot: baselineScreenshot,
    },
    zoomed: {
      measurement: results.nativeZoom.zoomed,
      screenshot: zoomedScreenshot,
    },
  });
  if (nativeScreenshotErrors.length > 0) {
    throw new Error(
      "candidate native screenshots are invalid: " +
        nativeScreenshotErrors.join("; "),
    );
  }

  const manifestEntries = new Map();
  for (const line of (await readFile(manifestPath, "utf8"))
    .split("\n")
    .filter(Boolean)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (match === null || !isSafeRelativeArtifactPath(match[2], ".png")) {
      throw new Error("candidate screenshots.sha256 has an invalid entry");
    }
    if (manifestEntries.has(match[2])) {
      throw new Error("candidate screenshots.sha256 has a duplicate path");
    }
    manifestEntries.set(match[2], match[1]);
  }

  const seenScreenshots = new Set();
  for (const screenshot of results.screenshots) {
    if (
      !isSafeRelativeArtifactPath(screenshot?.path, ".png") ||
      !/^[a-f0-9]{64}$/u.test(screenshot?.sha256 ?? "") ||
      seenScreenshots.has(screenshot.path)
    ) {
      throw new Error(
        "candidate browser-results.json has an invalid screenshot",
      );
    }
    seenScreenshots.add(screenshot.path);
    const screenshotPath = await requireCandidateFile(
      candidate,
      screenshot.path,
      "screenshot artifact " + screenshot.path,
    );
    const actualHash = createHash("sha256")
      .update(await readFile(screenshotPath))
      .digest("hex");
    if (
      actualHash !== screenshot.sha256 ||
      manifestEntries.get(screenshot.path) !== screenshot.sha256
    ) {
      throw new Error(
        "candidate screenshot SHA-256 mismatch for " + screenshot.path,
      );
    }
    if (nativeScreenshotPaths.includes(screenshot.path)) {
      const actualDimensions = readPngDimensions(
        await readFile(screenshotPath),
      );
      if (
        actualDimensions.width !== screenshot.pixelWidth ||
        actualDimensions.height !== screenshot.pixelHeight
      ) {
        throw new Error(
          "candidate native screenshot PNG dimensions do not match results for " +
            screenshot.path,
        );
      }
    }
  }
  if (
    manifestEntries.size !== seenScreenshots.size ||
    [...manifestEntries.keys()].some((entry) => !seenScreenshots.has(entry))
  ) {
    throw new Error("candidate screenshots.sha256 does not match results");
  }

  const seenAxeArtifacts = new Set();
  for (const summary of results.axeSummaries) {
    const expectedArtifact = path.posix.join(
      "axe-results",
      String(summary?.id) + ".json",
    );
    if (
      !requiredAxeScanSet.has(summary?.id) ||
      summary?.artifact !== expectedArtifact ||
      !isSafeRelativeArtifactPath(summary.artifact, ".json") ||
      seenAxeArtifacts.has(summary.artifact)
    ) {
      throw new Error(
        "candidate browser-results.json has an invalid axe artifact",
      );
    }
    seenAxeArtifacts.add(summary.artifact);
    const artifactPath = await requireCandidateFile(
      candidate,
      summary.artifact,
      "axe artifact " + summary.artifact,
    );
    let artifact;
    try {
      artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    } catch {
      throw new Error(
        "candidate axe artifact must contain valid JSON: " + summary.artifact,
      );
    }
    if (
      artifact?.schemaVersion !== 1 ||
      artifact?.scan?.id !== summary.id ||
      artifact?.scan?.scenarioId !== summary.scenarioId
    ) {
      throw new Error(
        "candidate axe artifact scan metadata does not match summary: " +
          summary.artifact,
      );
    }
    const axeArrays = [
      artifact?.result?.inapplicable,
      artifact?.result?.incomplete,
      artifact?.result?.passes,
      artifact?.result?.violations,
    ];
    if (
      axeArrays.some((entries) => !Array.isArray(entries)) ||
      axeArrays.reduce(
        (total, entries) =>
          total + (Array.isArray(entries) ? entries.length : 0),
        0,
      ) === 0
    ) {
      throw new Error(
        "candidate axe artifact must contain a non-empty axe rule inventory: " +
          summary.artifact,
      );
    }
    const artifactSummary = summarizeAxeResult(artifact.result);
    if (
      artifactSummary.blocking.length > 0 ||
      JSON.stringify(artifactSummary.blocking) !==
        JSON.stringify(summary.blocking) ||
      JSON.stringify(artifactSummary.counts) !== JSON.stringify(summary.counts)
    ) {
      throw new Error(
        "candidate axe artifact result does not match summary: " +
          summary.artifact,
      );
    }
  }
}

function formatError(error) {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  return runCommand(command, arguments_, {
    cwd,
    stream: false,
  });
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
    "installed axe Playwright adapter must match the exact root manifest version",
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

async function collectGitProvenance(workspaceRoot) {
  const [sha, status] = await Promise.all([
    captureCommand("git", ["rev-parse", "HEAD"], workspaceRoot),
    captureCommand(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      workspaceRoot,
    ),
  ]);
  return {
    dirty: status.length > 0,
    sha,
    status: status.length === 0 ? [] : status.split("\n"),
  };
}

async function prepareProductionBuild(workspaceRoot, candidate) {
  const logsDirectory = path.join(candidate, "logs");
  await runCommand(
    "corepack",
    ["pnpm", "--filter", "@fan-support/ui", "build"],
    {
      cwd: workspaceRoot,
      logPath: path.join(logsDirectory, "build-ui.log"),
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
      logPath: path.join(logsDirectory, "build-storefront.log"),
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
    "Next.js build did not create the expected standalone storefront server",
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

  return { serverPath, standaloneAppRoot };
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
    port,
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
        // Startup connection failures are expected until Next binds the port.
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

async function probeRuntime(server) {
  const [fixtureStatus, healthStatus] = await Promise.all([
    fetchStatus(server.origin + fixturePath),
    fetchStatus(server.origin + "/healthz"),
  ]);
  return {
    environment: server.environment,
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

export async function observePage(page, context, expectedOrigin) {
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

async function settleFixturePage(page, locale) {
  const fixtureUrl =
    "/_internal/design-foundations/" +
    encodeURIComponent(locale) +
    "/primitives";
  const response = await page.goto(fixtureUrl, {
    waitUntil: "load",
  });
  invariant(response !== null, "fixture navigation returned no main response");
  invariant(
    response.status() === 200,
    fixtureUrl + " returned HTTP " + String(response.status()),
  );
  const marker = page.locator('main[data-ui-primitives="v1"]');
  await marker.waitFor({ state: "visible" });
  invariant(
    (await marker.getAttribute("lang")) === locale,
    "fixture main lang does not match " + locale,
  );
  invariant(
    (await page.locator('meta[name="robots"]').getAttribute("content"))
      ?.toLowerCase()
      .includes("noindex") === true,
    "fixture must remain noindex",
  );
  await page.evaluate(async () => document.fonts.ready);
  const media = page.locator(".fs-media");
  await media.last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".fs-media img")].every(
      (image) => image instanceof HTMLImageElement && image.complete,
    ),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  return fixtureUrl;
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const parseColor = (value) => {
      const channels = value.match(/[\d.]+/gu)?.map(Number) ?? [];
      if (channels.length < 3) {
        return null;
      }
      return {
        alpha: channels[3] ?? 1,
        blue: channels[2],
        green: channels[1],
        red: channels[0],
      };
    };
    const composite = (foreground, background) => ({
      alpha: 1,
      blue:
        foreground.blue * foreground.alpha +
        background.blue * (1 - foreground.alpha),
      green:
        foreground.green * foreground.alpha +
        background.green * (1 - foreground.alpha),
      red:
        foreground.red * foreground.alpha +
        background.red * (1 - foreground.alpha),
    });
    const luminance = (color) => {
      const linear = [color.red, color.green, color.blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrastRatio = (foregroundValue, backgroundValue) => {
      const parsedForeground = parseColor(foregroundValue);
      const parsedBackground = parseColor(backgroundValue);
      if (parsedForeground === null || parsedBackground === null) {
        return 0;
      }
      const background =
        parsedBackground.alpha === 1
          ? parsedBackground
          : composite(parsedBackground, {
              alpha: 1,
              blue: 255,
              green: 255,
              red: 255,
            });
      const foreground =
        parsedForeground.alpha === 1
          ? parsedForeground
          : composite(parsedForeground, background);
      const first = luminance(foreground);
      const second = luminance(background);
      return (
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      );
    };
    const selectorFor = (element) => {
      if (element.id !== "") {
        return "#" + CSS.escape(element.id);
      }
      const className =
        typeof element.className === "string"
          ? element.className.trim().split(/\s+/u).filter(Boolean)[0]
          : undefined;
      return (
        element.tagName.toLowerCase() +
        (className === undefined ? "" : "." + CSS.escape(className))
      );
    };
    const clippedText = [];
    const viewportWidth = document.documentElement.clientWidth;
    const textElements = [...document.body.querySelectorAll("*")].filter(
      (element) => {
        if (
          !(element instanceof HTMLElement) ||
          element.childElementCount > 0
        ) {
          return false;
        }
        const style = getComputedStyle(element);
        return (
          (element.textContent ?? "").trim().length > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0
        );
      },
    );
    for (const element of textElements) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const reasons = [];
      if (rect.left < -0.5 || rect.right > viewportWidth + 0.5) {
        reasons.push("outside-horizontal-viewport");
      }
      const clipsX = ["auto", "clip", "hidden", "scroll"].includes(
        style.overflowX,
      );
      const clipsY = ["auto", "clip", "hidden", "scroll"].includes(
        style.overflowY,
      );
      if (
        element.clientWidth > 0 &&
        element.scrollWidth > element.clientWidth + 0.5 &&
        clipsX
      ) {
        reasons.push("horizontal-clip");
      }
      if (
        element.clientHeight > 0 &&
        element.scrollHeight > element.clientHeight + 0.5 &&
        clipsY
      ) {
        reasons.push("vertical-clip");
      }
      if (style.textOverflow === "ellipsis") {
        reasons.push("ellipsis");
      }
      if (style.webkitLineClamp !== "none") {
        reasons.push("line-clamp");
      }
      if (reasons.length > 0) {
        clippedText.push({
          reason: reasons.join(","),
          selector: selectorFor(element),
          text: (element.textContent ?? "").trim().slice(0, 160),
        });
      }
    }

    const controlSelector = [
      ".fs-button",
      ".fs-link--standalone",
      ".fs-field__input",
      ".fs-quantity__button",
      ".fs-quantity__input",
    ].join(",");
    const controls = [...document.querySelectorAll(controlSelector)].map(
      (element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim() ??
            selectorFor(element),
          selector: selectorFor(element),
          width: rect.width,
        };
      },
    );
    const contrastChecks = [
      ["Field", ".fs-field__input"],
      ["Quantity", ".fs-quantity__controls"],
      ["Secondary Button", ".fs-button--secondary"],
    ].map(([label, selector]) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return {
          background: "missing",
          border: "missing",
          label,
          ratio: 0,
          required: 3,
        };
      }
      const style = getComputedStyle(element);
      const ratio = contrastRatio(style.borderTopColor, style.backgroundColor);
      return {
        background: style.backgroundColor,
        border: style.borderTopColor,
        label,
        ratio,
        required: 3,
      };
    });
    const text = document.body.innerText;
    return {
      clippedText,
      contrastChecks,
      controls,
      document: {
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      fontsStatus: document.fonts.status,
      replacementGlyphs: [...text].filter((character) => character === "�")
        .length,
    };
  });
}

async function focusPrimaryWithTab(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
  });
  const visited = [];
  let found = false;
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      return {
        className: element.className,
        loading: element.getAttribute("data-loading"),
        testId: element.getAttribute("data-testid"),
      };
    });
    visited.push(focused);
    if (focused?.testId === "primary-action") {
      found = true;
      break;
    }
  }
  invariant(found, "Tab navigation did not reach the primary Button");
  invariant(
    !visited.some((entry) => entry?.loading === "true"),
    "Tab navigation focused the loading Button",
  );
  await page.keyboard.press("Tab");
  const nextFocus = await page.evaluate(() => {
    const element = document.activeElement;
    return element instanceof HTMLElement
      ? {
          disabled: element.matches(":disabled"),
          loading: element.getAttribute("data-loading"),
          testId: element.getAttribute("data-testid"),
        }
      : null;
  });
  invariant(
    nextFocus?.testId === "media-error-trigger" &&
      nextFocus.disabled === false &&
      nextFocus.loading !== "true",
    "disabled/loading Buttons must be skipped in sequential Tab order",
  );
  visited.push(nextFocus);
  await page.keyboard.press("Shift+Tab");
  invariant(
    (await page
      .getByTestId("primary-action")
      .evaluate((element) => document.activeElement === element)) === true,
    "Shift+Tab did not restore primary Button focus",
  );
  return visited;
}

async function runInteractionChecks(page) {
  const checks = {};
  checks.tabOrder = await focusPrimaryWithTab(page);
  const primary = page.getByTestId("primary-action");
  const focusStyle = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      focusVisible: element.matches(":focus-visible"),
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
      x: rect.x,
      y: rect.y,
    };
  });
  invariant(
    focusStyle.outlineStyle !== "none" &&
      Number.parseFloat(focusStyle.outlineWidth) > 0 &&
      focusStyle.focusVisible,
    "keyboard focus ring is not visible on the primary Button",
  );
  invariant(
    focusStyle.x >= 0 &&
      focusStyle.y >= 0 &&
      focusStyle.x < focusStyle.viewportWidth &&
      focusStyle.y < focusStyle.viewportHeight,
    "keyboard-focused primary Button is outside the viewport",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  invariant(
    (await page
      .locator("[data-button-count]")
      .getAttribute("data-button-count")) === "2",
    "Enter and Space must both activate the primary Button",
  );
  checks.keyboard = { activationCount: 2, focusStyle };

  const disabledButton = page.locator(
    ".fs-button:disabled:not([data-loading])",
  );
  const loadingButton = page.locator('.fs-button[data-loading="true"]');
  invariant(
    await disabledButton.isDisabled(),
    "disabled Button is not disabled",
  );
  invariant(await loadingButton.isDisabled(), "loading Button is not disabled");
  invariant(
    (await loadingButton.getAttribute("aria-busy")) === "true",
    "loading Button must expose aria-busy=true",
  );
  const loadingLayout = await loadingButton.evaluate((element) => {
    const label = element.querySelector(".fs-button__label");
    const spinner = element.querySelector(".fs-button__spinner");
    if (!(label instanceof HTMLElement) || !(spinner instanceof HTMLElement)) {
      return null;
    }
    const buttonRect = element.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    return {
      button: {
        height: buttonRect.height,
        width: buttonRect.width,
        x: buttonRect.x,
        y: buttonRect.y,
      },
      label: {
        display: getComputedStyle(label).display,
        height: labelRect.height,
        opacity: Number.parseFloat(getComputedStyle(label).opacity),
        position: getComputedStyle(label).position,
        width: labelRect.width,
        x: labelRect.x,
        y: labelRect.y,
      },
      spinner: { position: getComputedStyle(spinner).position },
    };
  });
  invariant(loadingLayout !== null, "loading Button internals are missing");
  const loadingLayoutErrors = assessLoadingButtonLayout(loadingLayout);
  invariant(loadingLayoutErrors.length === 0, loadingLayoutErrors.join("; "));
  checks.disabled = { disabled: true, skippedByTab: true };
  checks.loading = {
    ariaBusy: true,
    disabled: true,
    layout: loadingLayout,
    skippedByTab: true,
  };

  const field = page.locator("#primitive-display-name");
  const describedBy =
    (await field.getAttribute("aria-describedby"))?.split(/\s+/u) ?? [];
  invariant(
    (await field.getAttribute("aria-invalid")) === "true",
    "invalid Field must expose aria-invalid=true",
  );
  invariant(
    (await page.locator('label[for="primitive-display-name"]').count()) === 1,
    "Field label must target its input",
  );
  for (const id of [
    "primitive-display-name-hint",
    "primitive-display-name-error",
  ]) {
    invariant(
      describedBy.includes(id),
      "Field aria-describedby is missing " + id,
    );
    invariant((await page.locator("#" + id).count()) === 1, id + " is missing");
  }
  invariant(
    (await page
      .locator("#primitive-display-name-error")
      .getAttribute("role")) === "alert",
    "Field error must use role=alert",
  );
  checks.field = { describedBy, invalid: true, labelAssociated: true };

  const quantity = page.locator("#primitive-quantity");
  invariant(
    (await quantity.getAttribute("type")) === "number" &&
      (await quantity.getAttribute("role")) === "spinbutton",
    "Quantity input must be a number spinbutton",
  );
  invariant(
    (await quantity.getAttribute("min")) === "1" &&
      (await quantity.getAttribute("max")) === "5" &&
      (await quantity.getAttribute("step")) === "1",
    "Quantity min/max/step semantics are incorrect",
  );
  const quantityRoot = quantity.locator(
    "xpath=ancestor::*[contains(@class, 'fs-quantity')][1]",
  );
  const decrease = quantityRoot.locator('[data-quantity-action="decrease"]');
  const increase = quantityRoot.locator('[data-quantity-action="increase"]');
  for (const [button, action] of [
    [decrease, "decrease"],
    [increase, "increase"],
  ]) {
    invariant(
      (await button.getAttribute("type")) === "button" &&
        (await button.getAttribute("aria-controls")) === "primitive-quantity" &&
        (await button.getAttribute("aria-label"))?.trim().length > 0,
      "Quantity " + action + " Button semantics are incomplete",
    );
  }
  await quantity.focus();
  await quantity.press("ArrowUp");
  invariant(
    (await quantity.inputValue()) === "3",
    "ArrowUp must increment Quantity",
  );
  await quantity.press("ArrowDown");
  invariant(
    (await quantity.inputValue()) === "2",
    "ArrowDown must decrement Quantity",
  );
  await quantity.press("End");
  invariant(
    (await quantity.inputValue()) === "5" && (await increase.isDisabled()),
    "End must clamp Quantity to max and disable increment",
  );
  await quantity.press("Home");
  invariant(
    (await quantity.inputValue()) === "1" && (await decrease.isDisabled()),
    "Home must clamp Quantity to min and disable decrement",
  );
  checks.quantity = {
    arrowDown: 2,
    arrowUp: 3,
    end: 5,
    home: 1,
    semantics: "number spinbutton",
  };

  const frames = page.locator(".fs-media");
  const beforeFrames = await frames.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    }),
  );
  const errorFrame = frames.nth(1);
  const errorImage = errorFrame.locator("img");
  invariant(
    (await errorImage.count()) === 1,
    "Media error probe image is missing",
  );
  const initialSrc = await errorImage.getAttribute("src");
  invariant(
    typeof initialSrc === "string" && initialSrc.length > 0,
    "Media error probe initial src is missing",
  );
  await errorFrame.evaluate((element, expectedInitialSrc) => {
    const image = element.querySelector("img");
    if (!(image instanceof HTMLImageElement)) {
      throw new Error("Media error probe image is missing");
    }
    element.dataset.mediaErrorSourceChanged = "false";
    element.dataset.mediaErrorBrowserDecodeFailed = "false";
    element.dataset.mediaErrorObservedSrc = "";
    image.addEventListener(
      "error",
      () => {
        const observedSrc = image.getAttribute("src") ?? "";
        element.dataset.mediaErrorObservedSrc = observedSrc;
        element.dataset.mediaErrorSourceChanged = String(
          observedSrc !== "" && observedSrc !== expectedInitialSrc,
        );
        element.dataset.mediaErrorBrowserDecodeFailed = "true";
      },
      { once: true },
    );
  }, initialSrc);
  await page.getByTestId("media-error-trigger").click();
  await page.waitForFunction(() => {
    const frame = document.querySelectorAll(".fs-media")[1];
    return (
      frame instanceof HTMLElement &&
      frame.getAttribute("data-media-state") === "error" &&
      frame.dataset.mediaErrorSourceChanged === "true" &&
      frame.dataset.mediaErrorBrowserDecodeFailed === "true"
    );
  });
  const mediaTransition = await errorFrame.evaluate((element) => ({
    browserDecodeFailed:
      element.dataset.mediaErrorBrowserDecodeFailed === "true",
    requestedSrc: element.dataset.mediaErrorObservedSrc ?? "",
    sourceChanged: element.dataset.mediaErrorSourceChanged === "true",
  }));
  const fallback = errorFrame.locator('[data-media-fallback="informative"]');
  invariant(
    (await fallback.getAttribute("role")) === "img" &&
      (await fallback.getAttribute("aria-label"))?.trim().length > 0,
    "Media error fallback must retain an informative accessible image name",
  );
  const afterFrames = await frames.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    }),
  );
  invariant(
    beforeFrames.length === afterFrames.length,
    "Media frame count changed",
  );
  for (let index = 0; index < beforeFrames.length; index += 1) {
    invariant(
      Math.abs(beforeFrames[index].height - afterFrames[index].height) <= 0.5 &&
        Math.abs(beforeFrames[index].width - afterFrames[index].width) <= 0.5,
      "Media fallback changed the declared aspect-ratio footprint",
    );
  }
  checks.mediaError = {
    accessibleFallback: true,
    browserDecodeFailed: mediaTransition.browserDecodeFailed,
    frameAfter: afterFrames,
    frameBefore: beforeFrames,
    initialSrc,
    requestedSrc: mediaTransition.requestedSrc,
    sourceChanged: mediaTransition.sourceChanged,
    triggerClicked: true,
  };

  await focusPrimaryWithTab(page);
  return checks;
}

async function runHoverChecks(page) {
  const primary = page.getByTestId("primary-action");
  const standaloneLink = page.locator(".fs-link--standalone");
  const field = page.locator("#primitive-display-name");
  const buttonBefore = await primary.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  await primary.hover();
  await page.waitForTimeout(250);
  const buttonAfter = await primary.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  invariant(
    buttonAfter !== buttonBefore && buttonAfter !== "none",
    "primary Button hover must expose a raised shadow",
  );
  const linkBefore = await standaloneLink.evaluate(
    (element) => getComputedStyle(element).color,
  );
  await standaloneLink.hover();
  await page.waitForTimeout(150);
  const linkAfter = await standaloneLink.evaluate(
    (element) => getComputedStyle(element).color,
  );
  invariant(
    linkAfter !== linkBefore,
    "standalone Link hover color did not change",
  );
  const fieldBefore = await field.evaluate(
    (element) => getComputedStyle(element).borderTopColor,
  );
  await field.hover();
  await page.waitForTimeout(150);
  const fieldAfter = await field.evaluate(
    (element) => getComputedStyle(element).borderTopColor,
  );
  invariant(
    fieldAfter !== fieldBefore,
    "Field hover border color did not change",
  );
  await primary.hover();
  return {
    buttonAfter,
    buttonBefore,
    fieldAfter,
    fieldBefore,
    linkAfter,
    linkBefore,
  };
}

async function runRtlQuantityChecks(page) {
  const probe = page.locator('[data-rtl-probe="true"]');
  const input = page.locator("#rtl-primitive-quantity");
  const result = await probe.evaluate((element) => {
    const controls = element.querySelector(".fs-quantity__controls");
    return {
      actionOrder:
        controls === null
          ? []
          : [...controls.children].map(
              (child) =>
                child.getAttribute("data-quantity-action") ??
                child.getAttribute("data-quantity-input"),
            ),
      controlsDirection:
        controls === null ? null : getComputedStyle(controls).direction,
      probeDirection: getComputedStyle(element).direction,
    };
  });
  invariant(result.probeDirection === "rtl", "RTL probe direction must be rtl");
  invariant(
    result.controlsDirection === "ltr",
    "Quantity controls must preserve logical decrease/input/increase order in RTL",
  );
  invariant(
    JSON.stringify(result.actionOrder) ===
      JSON.stringify(["decrease", "true", "increase"]),
    "RTL Quantity DOM order must remain decrease/input/increase",
  );
  await input.focus();
  await input.press("ArrowUp");
  invariant((await input.inputValue()) === "3", "RTL ArrowUp must increment");
  await input.press("ArrowDown");
  invariant((await input.inputValue()) === "2", "RTL ArrowDown must decrement");
  return { ...result, arrowDown: 2, arrowUp: 3 };
}

function durationsAreZero(value) {
  return value
    .split(",")
    .map((duration) => Number.parseFloat(duration))
    .every((duration) => Number.isFinite(duration) && duration === 0);
}

export function assessReducedMotionStyles(computed) {
  const errors = [];
  for (const [label, value] of [
    ["Button transition", computed?.buttonTransitionDuration],
    ["Link transition", computed?.linkTransitionDuration],
    ["Field transition", computed?.fieldTransitionDuration],
    ["Quantity transition", computed?.quantityButtonTransitionDuration],
  ]) {
    if (typeof value !== "string" || !durationsAreZero(value)) {
      errors.push(label + " must be zero under reduced motion");
    }
  }
  if (computed?.spinnerAnimationName !== "none") {
    errors.push("loading spinner animation must be removed");
  }
  if (computed?.scrollBehavior !== "auto") {
    errors.push("scroll behavior must be automatic");
  }
  if (
    computed?.activeTransform !== undefined &&
    computed.activeTransform !== "none"
  ) {
    errors.push("active Button transform must be removed");
  }
  return errors;
}

async function runReducedMotionChecks(page) {
  invariant(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    "reduced-motion media query is not active",
  );
  const computed = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="primary-action"]');
    const field = document.querySelector(".fs-field__input");
    const link = document.querySelector(".fs-link--standalone");
    const quantityButton = document.querySelector(".fs-quantity__button");
    const spinner = document.querySelector(".fs-button__spinner");
    const main = document.querySelector('main[data-ui-primitives="v1"]');
    if (
      !(button instanceof HTMLElement) ||
      !(field instanceof HTMLElement) ||
      !(link instanceof HTMLElement) ||
      !(quantityButton instanceof HTMLElement) ||
      !(spinner instanceof HTMLElement) ||
      !(main instanceof HTMLElement)
    ) {
      return null;
    }
    return {
      buttonTransitionDuration: getComputedStyle(button).transitionDuration,
      fieldTransitionDuration: getComputedStyle(field).transitionDuration,
      linkTransitionDuration: getComputedStyle(link).transitionDuration,
      quantityButtonTransitionDuration:
        getComputedStyle(quantityButton).transitionDuration,
      scrollBehavior: getComputedStyle(main).scrollBehavior,
      spinnerAnimationName: getComputedStyle(spinner).animationName,
    };
  });
  invariant(computed !== null, "reduced-motion fixture elements are missing");
  const primary = page.getByTestId("primary-action");
  await primary.hover();
  await page.mouse.down();
  let activeTransform;
  try {
    activeTransform = await primary.evaluate(
      (element) => getComputedStyle(element).transform,
    );
  } finally {
    await page.mouse.up();
  }
  const result = { ...computed, activeTransform, mediaQuery: true };
  const errors = assessReducedMotionStyles(result);
  invariant(errors.length === 0, errors.join("; "));
  return result;
}

function diagnosticsErrors(diagnostics) {
  const errors = [];
  for (const entry of diagnostics.console) {
    errors.push("console " + entry.type + ": " + entry.text);
  }
  for (const entry of diagnostics.pageErrors) {
    errors.push("page error: " + entry);
  }
  for (const entry of diagnostics.requestFailures) {
    errors.push(
      "request failure: " +
        entry.method +
        " " +
        entry.url +
        " " +
        entry.errorText,
    );
  }
  for (const entry of diagnostics.httpErrors) {
    errors.push("HTTP " + String(entry.status) + ": " + entry.url);
  }
  for (const entry of diagnostics.externalResources) {
    errors.push("external resource: " + entry.url + " (" + entry.reason + ")");
  }
  return errors;
}

async function writeAxeResult(candidate, scenarioId, scan, result) {
  const relativePath = path.posix.join("axe-results", scan.id + ".json");
  const artifactPath = path.join(candidate, ...relativePath.split("/"));
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    JSON.stringify(
      {
        result,
        scan: { ...scan, scenarioId },
        schemaVersion: 1,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return relativePath;
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
    const url = await settleFixturePage(page, entry.locale);
    if (entry.checks.includes("keyboard")) {
      Object.assign(checks, await runInteractionChecks(page));
    }
    if (entry.checks.includes("hover")) {
      checks.hover = await runHoverChecks(page);
    }
    if (entry.checks.includes("rtl-quantity")) {
      checks.rtlQuantity = await runRtlQuantityChecks(page);
    }
    if (entry.reducedMotion === true) {
      checks.reducedMotion = await runReducedMotionChecks(page);
    }

    const metrics = await collectPageMetrics(page);
    const errors = assessPageMetrics(metrics);
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
          "axe " +
            scan.id +
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

    const screenshotPath = path.join(candidate, ...entry.screenshot.split("/"));
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: screenshotPath,
    });
    await page.waitForTimeout(50);
    errors.push(...diagnosticsErrors(diagnostics));
    const screenshotHash = createHash("sha256")
      .update(await readFile(screenshotPath))
      .digest("hex");

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
        viewport: entry.viewport,
      },
      screenshot: { path: entry.screenshot, sha256: screenshotHash },
    };
  } finally {
    await context.close();
  }
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
      // An explicit override remains available when Spotlight is unavailable.
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
        // Continue through the installed Chrome command candidates.
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

async function collectPrimitiveCounts(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [
        "button",
        "link",
        "icon",
        "media",
        "price",
        "status",
        "field",
        "quantity",
      ].map((primitive) => [
        primitive,
        document.querySelectorAll(".fs-" + primitive).length,
      ]),
    ),
  );
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
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      previousVisibility: element.style.visibility,
      text: element.textContent?.trim() ?? "",
      width: rect.width,
      x: rect.x,
      y: rect.y,
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
    const fixtureUrl = await settleFixturePage(page, nativeZoomLocale);
    const measurement = await collectNativeWindowMeasurement(page);
    const primitiveCounts = await collectPrimitiveCounts(page);
    for (const [primitive, count] of Object.entries(primitiveCounts)) {
      invariant(count > 0, "native zoom fixture is missing " + primitive);
    }
    const checks = verifyInteractions ? await runInteractionChecks(page) : {};
    const metrics = await collectPageMetrics(page);
    const errors = [
      ...assessPageMetrics(metrics),
      ...diagnosticsErrors(diagnostics),
    ];
    invariant(errors.length === 0, errors.join("; "));
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshotEvidence = await writeNativeViewportScreenshot({
      candidate,
      context,
      measurement,
      page,
      relativePath: screenshot,
    });
    return {
      checks,
      diagnostics,
      fixtureUrl,
      measurement,
      metrics,
      primitiveCounts,
      screenshot: screenshotEvidence,
    };
  } finally {
    await context?.close();
  }
}

async function runNativeChromeZoomVerification({
  candidate,
  origin,
  workspaceRoot,
}) {
  const { chromium } = await import("@playwright/test");
  const chrome = await resolveInstalledGoogleChrome(workspaceRoot);
  const profileRoot = await mkdtemp(
    path.join(os.tmpdir(), "fan-support-p2-02-chrome-zoom-"),
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
      "Chrome did not persist the expected HostZoomMap default zoom level",
    );
    result = {
      baseline: {
        ...baseline.measurement,
        checks: baseline.checks,
        diagnostics: baseline.diagnostics,
        fixtureUrl: baseline.fixtureUrl,
        metrics: baseline.metrics,
        primitiveCounts: baseline.primitiveCounts,
        screenshot: baseline.screenshot.path,
        screenshotEvidence: baseline.screenshot,
      },
      browser: chrome.version,
      detectedPercent:
        (zoomed.measurement.devicePixelRatio /
          baseline.measurement.devicePixelRatio) *
        100,
      method:
        "Chrome HostZoomMap default zoom preference loaded from an isolated temporary profile before navigation; no device-metrics, page-scale, or viewport emulation",
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
        primitiveCounts: zoomed.primitiveCounts,
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

async function runBrowserMatrix({ candidate, origin, versions }) {
  const [{ chromium }, axeModule] = await Promise.all([
    import("@playwright/test"),
    import("@axe-core/playwright"),
  ]);
  const AxeBuilder = axeModule.default;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  versions.browser = "Google Chrome " + browser.version();
  const scenarioResults = [];
  const axeSummaries = [];
  const screenshots = [];
  try {
    for (const entry of createBrowserScenarioMatrix()) {
      process.stdout.write("\n[p2-02 browser] " + entry.id + "\n");
      const result = await runScenario({
        AxeBuilder,
        browser,
        candidate,
        origin,
        scenario: entry,
      });
      scenarioResults.push(result.result);
      axeSummaries.push(...result.axeSummaries);
      screenshots.push(result.screenshot);
      if (result.result.errors.length > 0) {
        throw new Error(
          entry.id + " failed:\n- " + result.result.errors.join("\n- "),
        );
      }
    }
  } finally {
    await browser.close();
  }
  return { axeSummaries, scenarioResults, screenshots };
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
      gate.fixtureStatus === 404,
      environment + " must return fixture 404, received " + gate.fixtureStatus,
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

export async function runUiPrimitivesBrowserVerification({
  workspaceRoot = defaultWorkspaceRoot,
} = {}) {
  const matrixErrors = validateScenarioMatrix(createBrowserScenarioMatrix());
  invariant(
    matrixErrors.length === 0,
    "invalid browser matrix:\n- " + matrixErrors.join("\n- "),
  );

  const evidenceParent = path.join(workspaceRoot, "output/playwright");
  const target = path.join(workspaceRoot, evidenceRelativePath);
  await mkdir(evidenceParent, { recursive: true });
  const candidate = await mkdtemp(
    path.join(evidenceParent, ".p2-02-candidate-"),
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
      previewGate.fixtureStatus === 200 && previewGate.healthStatus === 200,
      "preview must return fixture 200 and healthz 200",
    );
    const browserResult = await runBrowserMatrix({
      candidate,
      origin: previewServer.origin,
      versions,
    });
    process.stdout.write("\n[p2-02 browser] native-chrome-200-percent-pt\n");
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
    const generatedAt = new Date().toISOString();
    const evidence = {
      axeSummaries: browserResult.axeSummaries,
      generatedAt,
      git,
      launch: {
        browserChannel: "chrome",
        browserEngine: "chromium",
        headless: true,
        nativeZoomHeaded: true,
        nativeZoomProfile: "isolated temporary profile",
        productionBuild: true,
        server: "Next.js standalone",
      },
      matrix: createBrowserScenarioMatrix(),
      nativeZoom,
      rerunCommand,
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
        .map((entry) => entry.sha256 + "  " + entry.path)
        .join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(candidate, "README.md"),
      createEvidenceReadme({
        axeSummaries: browserResult.axeSummaries,
        generatedAt,
        git,
        nativeZoom,
        rerunCommand,
        runtimeGates,
        scenarioResults: browserResult.scenarioResults,
        screenshots: browserResult.screenshots,
        versions,
      }),
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
      "\nP2-02 browser verification passed; evidence: " + target + "\n",
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
  runUiPrimitivesBrowserVerification().catch((error) => {
    process.stderr.write(
      "P2-02 browser verification failed\n" + formatError(error) + "\n",
    );
    process.exitCode = 1;
  });
}
