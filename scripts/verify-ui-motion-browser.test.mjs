/* global structuredClone */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";

async function loadRunner() {
  let loaded;
  try {
    loaded = await import("./verify-ui-motion-browser.mjs");
  } catch {
    loaded = undefined;
  }
  for (const exportName of [
    "assessCurrentMotionEvidence",
    "assessMotionEvidenceShape",
    "assessMotionPerformance",
    "assessReducedMotionEvidence",
    "assessRuntimeFontEvidence",
    "acquireMotionEvidenceLock",
    "collectMotionSourceFingerprint",
    "createMotionEvidenceReadme",
    "createMotionScenarioMatrix",
    "createMotionScreenshotPaths",
    "createMotionEvidenceCleanup",
    "installMotionSignalCleanup",
    "normalizeMotionWorkspaceStatus",
    "recoverMotionEvidenceSwap",
    "validateBuiltFontPolicy",
    "validateMotionEvidenceCandidate",
    "validateMotionScenarioMatrix",
  ]) {
    assert.equal(
      typeof loaded?.[exportName],
      "function",
      `${exportName} must be exported by the motion browser runner`,
    );
  }
  return loaded;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${String(pid)} did not exit`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createPng(width, height, { filter = 0, paletteChunks = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (width * 4 + 1)] = filter;
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    ...Array.from({ length: paletteChunks }, () =>
      pngChunk("PLTE", Buffer.from([0, 0, 0])),
    ),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function screenshotDimensions(relativePath) {
  const match = /(\d+)x(\d+)/u.exec(relativePath);
  if (match !== null) {
    return { height: Number(match[2]), width: Number(match[1]) };
  }
  const widthOnly = /-(390|1440)\.png$/u.exec(relativePath);
  assert.notEqual(
    widthOnly,
    null,
    `screenshot path must include a known viewport: ${relativePath}`,
  );
  const width = Number(widthOnly[1]);
  return { height: width === 390 ? 844 : 900, width };
}

async function runGit(root, arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn("git", arguments_, { cwd: root, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`git exited ${String(code)}`)),
    );
  });
}

function emptyDiagnostics(fixtureUrl) {
  return {
    console: [],
    externalResources: [],
    httpErrors: [],
    pageErrors: [],
    requestFailures: [],
    requests: [
      {
        allowed: true,
        method: "GET",
        resourceType: "document",
        url: `http://127.0.0.1${fixtureUrl}`,
      },
    ],
  };
}

function validPerformance(width) {
  return {
    clippedText: [],
    cls: 0,
    controls: [
      { height: 48, label: "Mira Vale", width: 140 },
      { height: 48, label: "Noa Aster", width: 140 },
      { height: 48, label: "Add gift", width: 140 },
    ],
    document: {
      bodyScrollWidth: width,
      clientWidth: width,
      scrollWidth: width,
    },
    fontsStatus: "loaded",
    interactionLatency: {
      maxMs: 96,
      sampleCount: 1,
      source:
        "PerformanceEventTiming duration proxy (desktop Chrome; not field INP)",
    },
    jsTransferBytes: 120_000,
    lcpMs: 1_800,
    longTasks: [],
    observers: {
      event: { installed: true, supported: true },
      layoutShift: { installed: true, supported: true },
      longTask: { installed: true, supported: true },
      lcp: { installed: true, supported: true },
    },
    raf: { maxFrameDeltaMs: 17, p95FrameDeltaMs: 16.7, sampleCount: 24 },
    rawLayoutShift: 0,
  };
}

function validRuntimeFonts(locale) {
  const families =
    locale === "ja"
      ? ["Noto Sans JP Variable"]
      : locale === "zh-CN"
        ? ["Noto Sans SC Variable"]
        : locale === "th"
          ? ["Noto Sans Thai Variable"]
          : ["Manrope Variable", "Noto Sans Variable"];
  return {
    computed: {
      fontFamily: `"${families[0]}", system-ui, sans-serif`,
      primaryFamily: families[0],
    },
    cssom: {
      displays: ["optional"],
      families,
      fontFaces: families.length,
      importantDescriptors: 0,
      imports: 0,
      styleSheets: 1,
      unreadableStyleSheets: [],
    },
    fontFaceSet: {
      displays: ["optional"],
      faceCount: families.length,
      families,
      statuses: ["loaded", "unloaded"],
    },
    source: "document.fonts + CSSOM + computedStyle",
  };
}

function validTiming(totalMs, property = "opacity") {
  return {
    items: [
      {
        activeDurationMs: totalMs,
        delayMs: 0,
        durationMs: totalMs,
        endDelayMs: 0,
        endTimeMs: totalMs,
        iterations: 1,
        property,
      },
    ],
    maxActiveDurationMs: totalMs,
    maxEndTimeMs: totalMs,
  };
}

function heroFrameStates() {
  return [
    {
      contentOpacity: "0",
      contentTransform: "matrix(1, 0, 0, 1, 0, 12)",
      mediaOpacity: "0.72",
      mediaTransform: "matrix(1.018, 0, 0, 1.018, 0, 0)",
      name: "start",
      rect: { height: 500, left: 0, top: 0, width: 390 },
    },
    {
      contentOpacity: "0.65",
      contentTransform: "matrix(1, 0, 0, 1, 0, 4)",
      mediaOpacity: "0.9",
      mediaTransform: "matrix(1.008, 0, 0, 1.008, 0, 0)",
      name: "mid",
      rect: { height: 500, left: 0, top: 0, width: 390 },
    },
    {
      contentOpacity: "1",
      contentTransform: "none",
      mediaOpacity: "1",
      mediaTransform: "none",
      name: "end",
      rect: { height: 500, left: 0, top: 0, width: 390 },
    },
  ];
}

function validMotionChecks() {
  return {
    addToCart: {
      buttonFocused: true,
      countDelta: 1,
      liveAnnouncement: true,
      pendingObserved: true,
      stateDelayMs: 48,
      timing: validTiming(220),
      interruption: {
        countStableOnError: true,
        errorLive: true,
        pendingObserved: true,
        resetToIdle: true,
      },
      visualFrames: {
        end: { actionOpacity: 0, confirmedOpacity: 1 },
        start: { actionOpacity: 1, confirmedOpacity: 0 },
      },
      visualDurationMs: 220,
    },
    hero: {
      desktop: {
        durationMs: 800,
        frameStates: heroFrameStates(),
        frames: ["start", "mid", "end"],
        layoutShift: 0,
        timing: validTiming(800, "hero"),
      },
      mobile: {
        durationMs: 800,
        frameStates: heroFrameStates(),
        frames: ["start", "mid", "end"],
        layoutShift: 0,
        timing: validTiming(800, "hero"),
      },
    },
    idolSwitch: {
      keyboard: {
        animationMs: 0,
        durationMs: 0,
        focusPreserved: true,
        mode: "instant",
        transform: "none",
        transitionMs: 0,
      },
      latestWins: {
        attempts: 10,
        cleared: true,
        outgoingCount: 0,
        selected: "mira-vale",
      },
      rapidReverse: {
        activeOpacity: 1,
        activeReady: true,
        activeVisible: true,
        blankFrame: false,
        cancelled: true,
        outgoingCount: 0,
        selected: "mira-vale",
      },
      mouse: {
        durationMs: 300,
        firstFrame: {
          activeOpacity: 0,
          coverage: true,
          outgoingOpacity: 1,
        },
        focusPreserved: true,
        mode: "spatial",
        timing: validTiming(300),
        visualFrames: {
          end: { activeOpacity: 1, outgoingOpacity: 0 },
          start: { activeOpacity: 0, outgoingOpacity: 1 },
        },
      },
      scrollPreserved: true,
      touch: {
        durationMs: 220,
        mode: "opacity",
        timing: validTiming(220),
        transitionProperties: ["opacity"],
        transform: "none",
        visualFrames: {
          end: { activeOpacity: 1, outgoingOpacity: 0 },
          start: { activeOpacity: 0, outgoingOpacity: 1 },
        },
      },
      activeImage: {
        blockedWhileLoading: true,
        complete: true,
        decodeResolvedBeforeExit: true,
        naturalWidth: 1122,
      },
      decodeRejectionFallback: {
        activeVisible: true,
        blankFrame: false,
        decodeRejected: true,
        fallbackVisible: true,
        outgoingCount: 0,
        outgoingRetainedBeforeError: true,
        prepareAfterReject: true,
        prepareBeforeReject: true,
        settledAfterFallback: true,
      },
    },
    success: {
      durationMs: 800,
      timing: validTiming(800, "success"),
      remainingAnimations: 0,
      statusClear: true,
      visualFrames: {
        end: { bodyOpacity: 1, markerOpacity: 1, markerTransform: "none" },
        start: {
          bodyOpacity: 0,
          markerOpacity: 0,
          markerTransform: "matrix(0.96, 0, 0, 0.96, 0, 8)",
        },
      },
    },
  };
}

function validReducedMotion(width) {
  const visibleState = (text) => ({
    display: "grid",
    opacity: 1,
    text,
    visibility: "visible",
  });
  return {
    add: { animationMs: 0, transitionMs: 0, transform: "none" },
    hero: { animationMs: 0, transitionMs: 0, transform: "none" },
    idol: { animationMs: 0, transitionMs: 0, transform: "none" },
    mediaQuery: true,
    positionDeltaPx: 0,
    scrollBehavior: "auto",
    scrollDeltaPx: 0,
    statusClear: true,
    stateFeedback: {
      cartCount: 1,
      confirmedLabel: visibleState("Added"),
      confirmedLabelVisible: true,
      heroContent: visibleState("Support their next milestone"),
      idolCopy: visibleState("Noa Aster"),
      liveRegionText: "Added to cart: 1",
      selectedId: "noa-aster",
      selectedLabel: visibleState("Selected"),
      selectedLabelVisible: true,
      success: visibleState("Order confirmed"),
      successVisible: true,
    },
    success: { animationMs: 0, transitionMs: 0, transform: "none" },
    viewportWidth: width,
  };
}

function validResults(matrix) {
  const fingerprintAlgorithm = "p2-05-render-inputs-v1";
  const fingerprintFiles = [
    { path: "packages/ui/src/motion.tsx", sha256: "c".repeat(64) },
  ];
  const sourceFingerprint = sha256(
    JSON.stringify({
      algorithm: fingerprintAlgorithm,
      files: fingerprintFiles,
    }),
  );
  const scenarioResults = matrix.map((entry) => {
    const fixturePath = `/_internal/design-foundations/${encodeURIComponent(entry.locale)}/motion`;
    return {
      axeSummaries: entry.axe.map((scan) => ({
        artifact: `axe-results/${scan.id}.json`,
        blocking: [],
        counts: { inapplicable: 1, incomplete: 0, passes: 1, violations: 0 },
        id: scan.id,
        ruleInventory: ["button-name", "color-contrast"],
        scenarioId: entry.id,
      })),
      diagnostics: emptyDiagnostics(fixturePath),
      errors: [],
      fixtureUrl: fixturePath,
      group: entry.group,
      id: entry.id,
      locale: entry.locale,
      performance: validPerformance(entry.viewport.width),
      runtimeFonts: validRuntimeFonts(entry.locale),
      screenshot: entry.screenshot,
      viewport: entry.viewport,
    };
  });
  return {
    axeSummaries: scenarioResults.flatMap((result) => result.axeSummaries),
    fontLoadingPolicy: {
      cssFiles: 4,
      fontFaces: 242,
      strategy: "optional",
      verifiedFamilies: [
        "Manrope Variable",
        "Noto Sans JP Variable",
        "Noto Sans SC Variable",
        "Noto Sans Thai Variable",
        "Noto Sans Variable",
      ],
    },
    generatedAt: "2026-09-05T00:00:00.000Z",
    git: {
      after: {
        sha: "a".repeat(40),
        sourceFingerprint,
        sourceFingerprintAlgorithm: fingerprintAlgorithm,
        sourceFingerprintFiles: fingerprintFiles,
        status: [],
      },
      before: {
        sha: "a".repeat(40),
        sourceFingerprint,
        sourceFingerprintAlgorithm: fingerprintAlgorithm,
        sourceFingerprintFiles: fingerprintFiles,
        status: [],
      },
    },
    launch: { browserChannel: "chrome", headless: true, productionBuild: true },
    matrix,
    motionChecks: validMotionChecks(),
    physicalDeviceEvidence: false,
    remainingGate:
      "Real mobile-device recording and frame-rate evidence is still required.",
    reducedMotion: {
      desktop: validReducedMotion(1440),
      mobile: validReducedMotion(390),
    },
    result: "passed-with-physical-device-gate",
    runtimeGates: [
      {
        environment: "preview",
        healthStatus: 200,
        localeStatuses: Array(8).fill(200),
      },
      {
        environment: "staging",
        healthStatus: 200,
        localeStatuses: Array(8).fill(404),
      },
      {
        environment: "production",
        healthStatus: 200,
        localeStatuses: Array(8).fill(404),
      },
    ],
    scenarioResults,
    schemaVersion: 1,
    screenshots: [],
    versions: { browser: "Google Chrome 140" },
  };
}

async function writeValidEvidenceCandidate(candidate) {
  const {
    createMotionEvidenceReadme,
    createMotionScenarioMatrix,
    createMotionScreenshotPaths,
  } = await loadRunner();
  const evidence = validResults(createMotionScenarioMatrix());
  const pngByDimensions = new Map();
  await mkdir(path.join(candidate, "viewports"), { recursive: true });
  await mkdir(path.join(candidate, "axe-results"), { recursive: true });
  await mkdir(path.join(candidate, "raw"), { recursive: true });
  for (const screenshotPath of createMotionScreenshotPaths()) {
    const dimensions = screenshotDimensions(screenshotPath);
    const dimensionKey = `${String(dimensions.width)}x${String(dimensions.height)}`;
    let png = pngByDimensions.get(dimensionKey);
    if (png === undefined) {
      png = createPng(dimensions.width, dimensions.height);
      pngByDimensions.set(dimensionKey, png);
    }
    await mkdir(path.dirname(path.join(candidate, screenshotPath)), {
      recursive: true,
    });
    await writeFile(path.join(candidate, screenshotPath), png);
    evidence.screenshots.push({
      path: screenshotPath,
      pixelHeight: dimensions.height,
      pixelWidth: dimensions.width,
      sha256: sha256(png),
    });
  }
  for (const summary of evidence.axeSummaries) {
    const result = {
      inapplicable: [{ id: "color-contrast" }],
      incomplete: [],
      passes: [{ id: "button-name" }],
      violations: [],
    };
    await writeFile(
      path.join(candidate, summary.artifact),
      `${JSON.stringify({ result, scan: { id: summary.id, scenarioId: summary.scenarioId }, schemaVersion: 1 }, null, 2)}\n`,
    );
  }
  await writeFile(
    path.join(candidate, "screenshots.sha256"),
    `${evidence.screenshots
      .map((entry) => `${entry.sha256}  ${entry.path}`)
      .join("\n")}\n`,
  );
  await writeFile(
    path.join(candidate, "README.md"),
    createMotionEvidenceReadme(evidence),
  );
  await writeFile(
    path.join(candidate, "browser-results.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await writeFile(
    path.join(candidate, "raw/scenario-results.json"),
    `${JSON.stringify(evidence.scenarioResults, null, 2)}\n`,
  );
  await writeFile(
    path.join(candidate, "raw/motion-checks.json"),
    `${JSON.stringify(evidence.motionChecks, null, 2)}\n`,
  );
  await writeFile(
    path.join(candidate, "raw/reduced-motion.json"),
    `${JSON.stringify(evidence.reducedMotion, null, 2)}\n`,
  );
  return evidence;
}

test("defines six baseline locales plus 320px pseudo and Portuguese stress routes", async () => {
  const { createMotionScenarioMatrix, validateMotionScenarioMatrix } =
    await loadRunner();
  const matrix = createMotionScenarioMatrix();
  assert.equal(matrix.length, 8);
  assert.deepEqual(
    matrix.map(({ locale, viewport }) => [
      viewport.width,
      viewport.height,
      locale,
    ]),
    [
      [360, 800, "en"],
      [390, 844, "vi"],
      [768, 1024, "th"],
      [1024, 768, "zh-CN"],
      [1440, 900, "ja"],
      [1920, 1080, "es"],
      [320, 800, "en-XA"],
      [320, 800, "pt"],
    ],
  );
  assert.deepEqual(validateMotionScenarioMatrix(matrix), []);

  const invalid = structuredClone(matrix);
  invalid[7].locale = "en-XA";
  invalid[7].screenshot = "../escape.png";
  assert.match(
    validateMotionScenarioMatrix(invalid).join("\n"),
    /Portuguese|safe|unique/u,
  );
});

test("enforces motion duration, latest-wins and user-state budgets", async () => {
  const { assessMotionEvidenceShape, createMotionScenarioMatrix } =
    await loadRunner();
  const valid = validResults(createMotionScenarioMatrix());
  assert.deepEqual(assessMotionEvidenceShape(valid), []);

  const slow = structuredClone(valid);
  slow.motionChecks.idolSwitch.mouse.durationMs = 361;
  slow.motionChecks.idolSwitch.mouse.timing.maxEndTimeMs = 500;
  slow.motionChecks.idolSwitch.mouse.visualFrames.end.activeOpacity = 0;
  slow.motionChecks.idolSwitch.mouse.focusPreserved = false;
  slow.motionChecks.addToCart.buttonFocused = false;
  slow.motionChecks.addToCart.visualDurationMs = 0;
  slow.motionChecks.addToCart.timing.maxEndTimeMs = 500;
  slow.motionChecks.addToCart.interruption.resetToIdle = false;
  slow.motionChecks.idolSwitch.latestWins.attempts = 9;
  slow.motionChecks.idolSwitch.rapidReverse.blankFrame = true;
  slow.motionChecks.idolSwitch.rapidReverse.cancelled = false;
  slow.motionChecks.idolSwitch.keyboard.transitionMs = 220;
  slow.motionChecks.idolSwitch.touch.transitionProperties = [
    "opacity",
    "transform",
  ];
  slow.motionChecks.idolSwitch.touch.visualFrames.end.activeOpacity = 0;
  slow.motionChecks.idolSwitch.activeImage.decodeResolvedBeforeExit = false;
  slow.motionChecks.idolSwitch.decodeRejectionFallback.prepareAfterReject = false;
  slow.motionChecks.idolSwitch.decodeRejectionFallback.settledAfterFallback = false;
  slow.motionChecks.idolSwitch.mouse.firstFrame.coverage = false;
  slow.motionChecks.success.durationMs = 901;
  slow.motionChecks.success.timing.maxEndTimeMs = 1_100;
  slow.motionChecks.success.visualFrames.end.markerOpacity = 0;
  slow.motionChecks.hero.mobile.timing.maxEndTimeMs = 1_000;
  slow.motionChecks.hero.mobile.frameStates[2].contentOpacity = "0";
  slow.motionChecks.success.remainingAnimations = 1;
  slow.scenarioResults[0].runtimeFonts.cssom.displays = ["swap"];
  const errors = assessMotionEvidenceShape(slow).join("\n");
  assert.match(errors, /mouse.*360/u);
  assert.match(errors, /mouse.*focus/u);
  assert.match(errors, /focus/u);
  assert.match(errors, /visual.*220|220.*visual/iu);
  assert.match(errors, /10/u);
  assert.match(errors, /rapid reverse|blank/iu);
  assert.match(errors, /keyboard.*computed|keyboard.*zero/iu);
  assert.match(errors, /touch.*opacity/iu);
  assert.match(errors, /decode|image/iu);
  assert.match(errors, /decode rejection|fallback/iu);
  assert.match(errors, /first frame|coverage/iu);
  assert.match(errors, /success.*900/u);
  assert.match(errors, /remaining animation|settle/iu);
  assert.match(errors, /total|end time|timing/iu);
  assert.match(errors, /visual change|no-op|identity/iu);
  assert.match(errors, /interrupt|reset/iu);
  assert.match(errors, /runtime CSSOM.*optional/iu);
});

test("fails closed when any hero frame field is missing or non-finite", async () => {
  const { assessMotionEvidenceShape, createMotionScenarioMatrix } =
    await loadRunner();
  for (const mutate of [
    (evidence) => {
      evidence.motionChecks.hero.mobile.frameStates[0].mediaOpacity = "NaN";
    },
    (evidence) => {
      evidence.motionChecks.hero.mobile.frameStates[1].mediaTransform =
        "matrix(NaN, 0, 0, 1, 0, 0)";
    },
    (evidence) => {
      delete evidence.motionChecks.hero.desktop.frameStates[1].contentTransform;
    },
    (evidence) => {
      evidence.motionChecks.hero.desktop.frameStates[2].rect.top = Number.NaN;
    },
  ]) {
    const evidence = validResults(createMotionScenarioMatrix());
    mutate(evidence);
    assert.match(
      assessMotionEvidenceShape(evidence).join("\n"),
      /hero.*frame|hero.*visual|finite|complete/iu,
    );
  }
});

test("blocks layout shift, overflow, clipping, long tasks and poor rAF pacing", async () => {
  const { assessMotionPerformance } = await loadRunner();
  assert.deepEqual(assessMotionPerformance(validPerformance(390), 390), []);

  const broken = validPerformance(390);
  broken.cls = 0.01;
  broken.rawLayoutShift = 2;
  broken.document.scrollWidth = 391;
  broken.clippedText.push("title");
  broken.longTasks.push({ duration: 51, startTime: 1 });
  broken.raf.p95FrameDeltaMs = 35;
  broken.lcpMs = 2_500;
  broken.interactionLatency.maxMs = 200;
  broken.jsTransferBytes = 150_000;
  broken.observers.lcp.installed = false;
  const errors = assessMotionPerformance(broken, 390).join("\n");
  for (const expected of [
    "CLS",
    "raw",
    "overflow",
    "clipped",
    "long task",
    "rAF",
    "LCP",
    "interaction",
    "JavaScript",
    "observer",
  ]) {
    assert.match(errors, new RegExp(expected, "iu"));
  }
});

test("requires the runtime font set to use optional and match the locale profile", async () => {
  const { assessRuntimeFontEvidence } = await loadRunner();
  assert.deepEqual(
    assessRuntimeFontEvidence(validRuntimeFonts("en"), "en"),
    [],
  );
  assert.deepEqual(
    assessRuntimeFontEvidence(validRuntimeFonts("en-XA"), "en-XA"),
    [],
  );

  const swapping = validRuntimeFonts("ja");
  swapping.fontFaceSet.displays.push("swap");
  assert.match(
    assessRuntimeFontEvidence(swapping, "ja").join("\n"),
    /runtime.*optional|swap/iu,
  );

  const wrongProfile = validRuntimeFonts("th");
  wrongProfile.cssom.families = ["Manrope Variable"];
  assert.match(
    assessRuntimeFontEvidence(wrongProfile, "th").join("\n"),
    /Noto Sans Thai Variable/iu,
  );

  const empty = validRuntimeFonts("vi");
  empty.fontFaceSet.faceCount = 0;
  assert.match(
    assessRuntimeFontEvidence(empty, "vi").join("\n"),
    /font face|face count/iu,
  );

  for (const unsettledStatus of ["error", "loading"]) {
    const unsettled = validRuntimeFonts("en");
    unsettled.fontFaceSet.statuses = ["loaded", unsettledStatus];
    assert.match(
      assessRuntimeFontEvidence(unsettled, "en").join("\n"),
      /status|loaded|unloaded/iu,
    );
  }

  const neverLoaded = validRuntimeFonts("en");
  neverLoaded.fontFaceSet.statuses = ["unloaded"];
  assert.match(
    assessRuntimeFontEvidence(neverLoaded, "en").join("\n"),
    /loaded/iu,
  );

  const forgedComputed = validRuntimeFonts("en");
  forgedComputed.computed.fontFamily = "system-ui, sans-serif";
  assert.match(
    assessRuntimeFontEvidence(forgedComputed, "en").join("\n"),
    /computed.*Manrope Variable/iu,
  );
});

test("requires 390 and 1440 reduced-motion evidence with no movement", async () => {
  const { assessReducedMotionEvidence } = await loadRunner();
  assert.deepEqual(
    assessReducedMotionEvidence(validReducedMotion(390), 390),
    [],
  );

  const broken = validReducedMotion(390);
  broken.hero.animationMs = 800;
  broken.idol.transform = "matrix(1, 0, 0, 1, 2, 0)";
  broken.scrollBehavior = "smooth";
  broken.scrollDeltaPx = 12;
  broken.stateFeedback.cartCount = 0;
  broken.stateFeedback.confirmedLabelVisible = false;
  broken.stateFeedback.success.opacity = 0;
  const errors = assessReducedMotionEvidence(broken, 390).join("\n");
  assert.match(errors, /hero/u);
  assert.match(errors, /idol/u);
  assert.match(errors, /scroll/u);
  assert.match(errors, /feedback|cart|visible/iu);

  const visuallyHidden = validReducedMotion(390);
  visuallyHidden.stateFeedback.heroContent.opacity = 0;
  assert.match(
    assessReducedMotionEvidence(visuallyHidden, 390).join("\n"),
    /opacity|visible/iu,
  );
});

test("locks axe ids to canonical scenarios, safe artifacts and non-empty rule inventories", async () => {
  const { assessMotionEvidenceShape, createMotionScenarioMatrix } =
    await loadRunner();
  const evidence = validResults(createMotionScenarioMatrix());
  evidence.axeSummaries[0].scenarioId = "viewport-1440x900-ja";
  evidence.axeSummaries[1].artifact = "../axe.json";
  evidence.axeSummaries[2].ruleInventory = [];
  assert.match(
    assessMotionEvidenceShape(evidence).join("\n"),
    /axe.*canonical|axe.*artifact|rule inventory/iu,
  );
});

test("fails closed on empty EventTiming evidence unless a reproducible fallback is present", async () => {
  const { assessMotionPerformance } = await loadRunner();
  const missing = validPerformance(390);
  missing.interactionLatency.sampleCount = 0;
  assert.match(
    assessMotionPerformance(missing, 390).join("\n"),
    /EventTiming|fallback/iu,
  );

  missing.interactionLatency = {
    fallback: {
      durationMs: 82,
      method: "performance.now around trusted Playwright click",
    },
    maxMs: 82,
    sampleCount: 0,
    source:
      "reproducible trusted-click fallback (desktop Chrome; not field INP)",
  };
  assert.deepEqual(assessMotionPerformance(missing, 390), []);
});

test("binds the fingerprint to motion render inputs but not generated evidence", async (context) => {
  const { collectMotionSourceFingerprint } = await loadRunner();
  const root = await mkdtemp(path.join(os.tmpdir(), "p2-05-fingerprint-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "packages/ui/src"), { recursive: true });
  await mkdir(path.join(root, "packages/observability/src"), {
    recursive: true,
  });
  await mkdir(path.join(root, "apps/storefront/public"), { recursive: true });
  await mkdir(path.join(root, "apps/storefront/src/app/healthz"), {
    recursive: true,
  });
  await mkdir(path.join(root, "output/playwright/p2-05"), { recursive: true });
  await writeFile(path.join(root, "packages/ui/src/motion.tsx"), "motion-v1\n");
  await writeFile(
    path.join(root, "apps/storefront/src/app/ui-motion-lab.tsx"),
    "lab-v1\n",
  );
  await writeFile(
    path.join(root, "apps/storefront/src/app/healthz/route.ts"),
    "health-v1\n",
  );
  await writeFile(
    path.join(root, "apps/storefront/public/brand.txt"),
    "public-v1\n",
  );
  await writeFile(
    path.join(root, "packages/observability/src/index.ts"),
    "observability-v1\n",
  );
  await writeFile(
    path.join(root, "output/playwright/p2-05/README.md"),
    "evidence-v1\n",
  );
  await runGit(root, ["init", "--quiet"]);
  await runGit(root, ["add", "."]);
  await runGit(root, [
    "-c",
    "user.name=Codex Test",
    "-c",
    "user.email=codex@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);

  const initial = await collectMotionSourceFingerprint(root);
  await writeFile(
    path.join(root, "output/playwright/p2-05/README.md"),
    "evidence-v2\n",
  );
  assert.deepEqual(await collectMotionSourceFingerprint(root), initial);
  await writeFile(
    path.join(root, "apps/storefront/src/app/healthz/route.ts"),
    "health-v2\n",
  );
  const healthChanged = await collectMotionSourceFingerprint(root);
  assert.notEqual(healthChanged.digest, initial.digest);
  await writeFile(
    path.join(root, "packages/observability/src/index.ts"),
    "observability-v2\n",
  );
  const dependencyChanged = await collectMotionSourceFingerprint(root);
  assert.notEqual(dependencyChanged.digest, healthChanged.digest);
  await writeFile(
    path.join(root, "apps/storefront/public/brand.txt"),
    "public-v2\n",
  );
  const publicChanged = await collectMotionSourceFingerprint(root);
  assert.notEqual(publicChanged.digest, dependencyChanged.digest);
  await writeFile(
    path.join(root, "apps/storefront/src/app/ui-motion-lab.tsx"),
    "lab-v2\n",
  );
  assert.notEqual(
    (await collectMotionSourceFingerprint(root)).digest,
    publicChanged.digest,
  );
});

test("requires every production font face to use the no-swap policy", async (context) => {
  const { validateBuiltFontPolicy } = await loadRunner();
  const root = await mkdtemp(path.join(os.tmpdir(), "p2-05-font-policy-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const chunks = path.join(root, ".next/static/chunks");
  await mkdir(chunks, { recursive: true });
  const validCss = [
    "Manrope Variable",
    "Noto Sans Variable",
    "Noto Sans JP Variable",
    "Noto Sans SC Variable",
    "Noto Sans Thai Variable",
  ]
    .map(
      (family, index) =>
        `@font-face{font-family:'${family}';font-display:optional;src:url(font-${String(index)}.woff2) format('woff2')}`,
    )
    .join("");
  await writeFile(path.join(chunks, "fonts.css"), validCss);

  assert.deepEqual(await validateBuiltFontPolicy(root), {
    cssFiles: 1,
    fontFaces: 5,
    strategy: "optional",
    verifiedFamilies: [
      "Manrope Variable",
      "Noto Sans JP Variable",
      "Noto Sans SC Variable",
      "Noto Sans Thai Variable",
      "Noto Sans Variable",
    ],
  });

  await writeFile(
    path.join(chunks, "fonts.css"),
    "@font-face{font-family:'Manrope Variable';font-display:swap;src:url(font.woff2)}",
  );
  await assert.rejects(
    validateBuiltFontPolicy(root),
    /font-display.*optional/iu,
  );

  await writeFile(
    path.join(chunks, "fonts.css"),
    validCss.replaceAll(
      "font-display:optional",
      "font-display:optional!important",
    ),
  );
  await assert.rejects(
    validateBuiltFontPolicy(root),
    /font-display.*important/iu,
  );

  await writeFile(
    path.join(chunks, "fonts.css"),
    validCss.replaceAll(";font-display", "!important;font-display"),
  );
  await assert.rejects(
    validateBuiltFontPolicy(root),
    /font-family.*important/iu,
  );

  await writeFile(
    path.join(chunks, "fonts.css"),
    validCss.replaceAll("@font-face{", "@font-face bogus{"),
  );
  await assert.rejects(validateBuiltFontPolicy(root), /prelude/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `@import url('/rogue.css');${validCss}`,
  );
  await assert.rejects(validateBuiltFontPolicy(root), /@import/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `@im\\70 ort url('/rogue.css');${validCss}`,
  );
  await assert.rejects(validateBuiltFontPolicy(root), /@import/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `@import/**/url('/rogue.css');${validCss}`,
  );
  await assert.rejects(validateBuiltFontPolicy(root), /@import/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `@im\\70 ort/**/url('/rogue.css');${validCss}`,
  );
  await assert.rejects(validateBuiltFontPolicy(root), /@import/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `@im\\70 ort'/rogue.css';${validCss}`,
  );
  await assert.rejects(validateBuiltFontPolicy(root), /@import/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `@import'/rogue.css';${validCss}`,
  );
  await assert.rejects(validateBuiltFontPolicy(root), /@import/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    validCss.replaceAll("@font-face{", "@font-face/**/bogus{"),
  );
  await assert.rejects(validateBuiltFontPolicy(root), /prelude/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `${validCss}@font-face{font-family:'Rogue';font-display:swap;src:local('{}'),url(rogue.woff2)}`,
  );
  await assert.rejects(
    validateBuiltFontPolicy(root),
    /font-display.*optional/iu,
  );

  await writeFile(
    path.join(chunks, "fonts.css"),
    `${validCss}@font\\-face{font-family:Rogue;font-display:swap;src:url(rogue.woff2)}`,
  );
  await assert.rejects(
    validateBuiltFontPolicy(root),
    /font-display.*optional/iu,
  );

  await writeFile(
    path.join(chunks, "fonts.css"),
    `${validCss}@font-face{font-family:Rogue;font-display:optional;font-\\64 isplay:swap;src:url(rogue.woff2)}`,
  );
  await assert.rejects(
    validateBuiltFontPolicy(root),
    /font-display.*optional/iu,
  );

  await writeFile(
    path.join(chunks, "fonts.css"),
    `${validCss}@font-face{font-family:'Manrope Variable';font-\\66 amily:Rogue;font-display:optional;src:url(rogue.woff2)}`,
  );
  await assert.rejects(validateBuiltFontPolicy(root), /font-family/iu);

  await writeFile(
    path.join(chunks, "fonts.css"),
    `${validCss}@font\\-face/**/{font-family:Rogue;font-display:swap;src:url(rogue.woff2)}`,
  );
  await assert.rejects(
    validateBuiltFontPolicy(root),
    /font-display.*optional/iu,
  );
});

test("rejects persisted evidence when current render inputs drift", async () => {
  const { assessCurrentMotionEvidence, createMotionScenarioMatrix } =
    await loadRunner();
  const evidence = validResults(createMotionScenarioMatrix());
  const current = {
    algorithm: evidence.git.after.sourceFingerprintAlgorithm,
    digest: evidence.git.after.sourceFingerprint,
    files: evidence.git.after.sourceFingerprintFiles,
  };

  assert.deepEqual(assessCurrentMotionEvidence(evidence, current), []);
  assert.match(
    assessCurrentMotionEvidence(evidence, {
      ...current,
      digest: "d".repeat(64),
    }).join("\n"),
    /stale.*rerun/iu,
  );
});

test("rejects forged or unsafe stable source fingerprints", async () => {
  const { assessMotionEvidenceShape, createMotionScenarioMatrix } =
    await loadRunner();

  const forged = validResults(createMotionScenarioMatrix());
  forged.git.before.sourceFingerprint = "e".repeat(64);
  forged.git.after.sourceFingerprint = "e".repeat(64);
  assert.match(assessMotionEvidenceShape(forged).join("\n"), /fingerprint/iu);

  const unsafe = validResults(createMotionScenarioMatrix());
  const unsafeFiles = [{ path: "../outside.tsx", sha256: "c".repeat(64) }];
  const unsafeDigest = sha256(
    JSON.stringify({
      algorithm: unsafe.git.before.sourceFingerprintAlgorithm,
      files: unsafeFiles,
    }),
  );
  for (const snapshot of [unsafe.git.before, unsafe.git.after]) {
    snapshot.sourceFingerprint = unsafeDigest;
    snapshot.sourceFingerprintFiles = unsafeFiles;
  }
  assert.match(assessMotionEvidenceShape(unsafe).join("\n"), /fingerprint/iu);
});

test("README is explicit that desktop emulation is not physical-device proof", async () => {
  const { createMotionEvidenceReadme, createMotionScenarioMatrix } =
    await loadRunner();
  const readme = createMotionEvidenceReadme(
    validResults(createMotionScenarioMatrix()),
  );
  assert.match(readme, /physical device evidence: false/iu);
  assert.match(readme, /real mobile-device recording/iu);
  assert.match(readme, /production build/iu);
  assert.match(readme, /verify-ui-motion-browser\.mjs/u);
});

test("fully decodes PNG chunks, CRCs, IDAT scanlines and filters", async () => {
  const runner = await loadRunner();
  assert.equal(typeof runner.readDecodedPngDimensions, "function");
  const valid = createPng(8, 6);
  assert.deepEqual(runner.readDecodedPngDimensions(valid), {
    height: 6,
    width: 8,
  });

  const badCrc = Buffer.from(valid);
  badCrc[20] ^= 1;
  const truncated = valid.subarray(0, valid.length - 1);
  const invalidFilter = createPng(8, 6, { filter: 5 });
  const duplicatePalette = createPng(8, 6, { paletteChunks: 2 });
  const headerOnly = valid.subarray(0, 24);
  for (const invalid of [
    badCrc,
    truncated,
    invalidFilter,
    duplicatePalette,
    headerOnly,
  ]) {
    assert.throws(
      () => runner.readDecodedPngDimensions(invalid),
      /PNG|CRC|IDAT|IEND|scanline|filter|truncated|decode/iu,
    );
  }
});

test("candidate validator requires real PNG screenshots in addition to matching hashes", async (context) => {
  const { validateMotionEvidenceCandidate } = await loadRunner();
  const candidate = await mkdtemp(path.join(os.tmpdir(), "p2-05-candidate-"));
  context.after(() => rm(candidate, { force: true, recursive: true }));
  const evidence = await writeValidEvidenceCandidate(candidate);
  assert.equal(
    (await validateMotionEvidenceCandidate(candidate)).result,
    evidence.result,
  );

  const originalWidth = evidence.screenshots[0].pixelWidth;
  evidence.screenshots[0].pixelWidth = 1;
  await writeFile(
    path.join(candidate, "browser-results.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await assert.rejects(
    validateMotionEvidenceCandidate(candidate),
    /dimension|pixel|viewport/iu,
  );
  evidence.screenshots[0].pixelWidth = originalWidth;
  await writeFile(
    path.join(candidate, "browser-results.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );

  const fakePng = Buffer.from("not-a-real-png-but-hash-bound");
  await writeFile(path.join(candidate, evidence.screenshots[0].path), fakePng);
  evidence.screenshots[0].sha256 = sha256(fakePng);
  await writeFile(
    path.join(candidate, "screenshots.sha256"),
    evidence.screenshots
      .map((entry) => `${entry.sha256}  ${entry.path}`)
      .join("\n") + "\n",
  );
  await writeFile(
    path.join(candidate, "browser-results.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await assert.rejects(validateMotionEvidenceCandidate(candidate), /PNG/u);
});

test("rejects a symlink candidate root and symlinked artifact ancestors", async (context) => {
  const { validateMotionEvidenceCandidate } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-symlink-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const candidate = path.join(parent, "candidate");
  const alias = path.join(parent, "candidate-alias");
  await mkdir(candidate);
  await writeValidEvidenceCandidate(candidate);
  await symlink(candidate, alias, "dir");
  await assert.rejects(
    validateMotionEvidenceCandidate(alias),
    /candidate|root|symbolic|symlink/iu,
  );

  const outsideRaw = path.join(parent, "outside-raw");
  await rename(path.join(candidate, "raw"), outsideRaw);
  await symlink(outsideRaw, path.join(candidate, "raw"), "dir");
  await assert.rejects(
    validateMotionEvidenceCandidate(candidate),
    /ancestor|contain|symbolic|symlink/iu,
  );
});

test("holds a live lock for the complete P2-05 evidence run", async (context) => {
  const { acquireMotionEvidenceLock } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-lock-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const lock = await acquireMotionEvidenceLock(parent);
  await assert.rejects(acquireMotionEvidenceLock(parent), /lock|running/iu);
  await lock.release();
  const reacquired = await acquireMotionEvidenceLock(parent);
  await reacquired.release();
});

test("publishes an initialized PID/start-marker owner and reclaims corrupt locks", async (context) => {
  const { acquireMotionEvidenceLock } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-lock-owner-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const lock = await acquireMotionEvidenceLock(parent);
  const owner = JSON.parse(
    await readFile(path.join(lock.path, "owner.json"), "utf8"),
  );
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.schemaVersion, 1);
  assert.equal(owner.authority.host, "127.0.0.1");
  assert.equal(Number.isSafeInteger(owner.authority.port), true);
  assert.equal(typeof owner.processStartMarker, "string");
  assert.notEqual(owner.processStartMarker.trim(), "");
  await lock.release();

  await mkdir(lock.path);
  await writeFile(
    path.join(lock.path, "owner.json"),
    `${JSON.stringify(owner)}\n`,
  );
  const reclaimedLiveLookingMarker = await acquireMotionEvidenceLock(parent);
  await reclaimedLiveLookingMarker.release();

  await mkdir(lock.path);
  await writeFile(path.join(lock.path, "owner.json"), "{broken-json\n");
  const reclaimed = await acquireMotionEvidenceLock(parent);
  await reclaimed.release();

  const externalOwner = path.join(parent, "external-owner.json");
  await writeFile(externalOwner, `${JSON.stringify(owner)}\n`);
  await mkdir(lock.path);
  await symlink(externalOwner, path.join(lock.path, "owner.json"), "file");
  const reclaimedSymlink = await acquireMotionEvidenceLock(parent);
  await reclaimedSymlink.release();
});

test("releases the authority port when owner marker initialization fails", async (context) => {
  const { acquireMotionEvidenceLock } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-lock-init-"));
  const notDirectory = path.join(parent, "not-a-directory");
  context.after(() => rm(parent, { force: true, recursive: true }));
  await writeFile(notDirectory, "fixture\n");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      acquireMotionEvidenceLock(notDirectory),
      (error) => error?.code === "ENOTDIR",
    );
  }
});

test("atomically reclaims a lock after SIGKILL without allowing two owners", async (context) => {
  const { acquireMotionEvidenceLock } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-lock-kill-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const moduleUrl = new URL("./verify-ui-motion-browser.mjs", import.meta.url)
    .href;
  const source = `
    import { acquireMotionEvidenceLock } from ${JSON.stringify(moduleUrl)};
    await acquireMotionEvidenceLock(${JSON.stringify(parent)});
    process.stdout.write("ready\\n");
    setInterval(() => undefined, 1_000);
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`lock fixture did not start: ${stderr}`)),
      5_000,
    );
    child.stdout.once("data", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("close", resolve));

  const attempts = await Promise.allSettled([
    acquireMotionEvidenceLock(parent),
    acquireMotionEvidenceLock(parent),
  ]);
  const acquired = attempts.filter((attempt) => attempt.status === "fulfilled");
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");
  assert.equal(acquired.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0].reason), /lock|running/iu);
  await acquired[0].value.release();
});

test("keeps the authority lock until a failed release can be retried safely", async (context) => {
  const { acquireMotionEvidenceLock } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-lock-release-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const lock = await acquireMotionEvidenceLock(parent);
  const ownerPath = path.join(lock.path, "owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeFile(
    ownerPath,
    `${JSON.stringify({ ...owner, token: "changed-owner" })}\n`,
  );

  await assert.rejects(lock.release(), /ownership changed/iu);
  await assert.rejects(acquireMotionEvidenceLock(parent), /lock|running/iu);

  await writeFile(ownerPath, `${JSON.stringify(owner)}\n`);
  await lock.release();
  const reacquired = await acquireMotionEvidenceLock(parent);
  await reacquired.release();
});

test("serializes repeated eight-way stale lock reclamation", async (context) => {
  const { acquireMotionEvidenceLock } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-lock-race-"));
  const lockPath = path.join(parent, ".p2-05-run.lock");
  context.after(() => rm(parent, { force: true, recursive: true }));

  for (let round = 0; round < 12; round += 1) {
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, "owner.json"), "{stale\n");
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => acquireMotionEvidenceLock(parent)),
    );
    const acquired = attempts.filter(
      (attempt) => attempt.status === "fulfilled",
    );
    assert.equal(
      acquired.length,
      1,
      `round ${String(round)} published ${String(acquired.length)} owners`,
    );
    await acquired[0].value.release();
  }
});

test("serializes repeated eight-process stale lock reclamation", async (context) => {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "p2-05-lock-process-race-"),
  );
  const lockPath = path.join(parent, ".p2-05-run.lock");
  const moduleUrl = new URL("./verify-ui-motion-browser.mjs", import.meta.url)
    .href;
  const children = new Set();
  context.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    await rm(parent, { force: true, recursive: true });
  });

  await mkdir(lockPath);
  await writeFile(path.join(lockPath, "owner.json"), "{stale\n");
  for (let round = 0; round < 3; round += 1) {
    const source = `
      import { acquireMotionEvidenceLock } from ${JSON.stringify(moduleUrl)};
      try {
        await acquireMotionEvidenceLock(${JSON.stringify(parent)});
        process.stdout.write("acquired\\n");
        setInterval(() => undefined, 1_000);
      } catch {
        process.stdout.write("rejected\\n", () => process.exit(0));
      }
    `;
    const contenders = Array.from({ length: 8 }, () => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      children.add(child);
      return child;
    });
    const outcomes = await Promise.all(
      contenders.map(
        (child) =>
          new Promise((resolve, reject) => {
            let stderr = "";
            child.stderr.on("data", (chunk) => {
              stderr += chunk.toString();
            });
            const timeout = setTimeout(
              () =>
                reject(new Error(`lock contender did not respond: ${stderr}`)),
              5_000,
            );
            child.stdout.once("data", (chunk) => {
              clearTimeout(timeout);
              resolve(chunk.toString().trim());
            });
          }),
      ),
    );
    assert.equal(
      outcomes.filter((outcome) => outcome === "acquired").length,
      1,
      `round ${String(round)} outcomes: ${outcomes.join(", ")}`,
    );
    for (const child of contenders) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    await Promise.all(
      contenders.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("close", resolve)),
      ),
    );
  }
});

test("excludes transient P2-05 lock, candidate and backup paths from Git evidence", async () => {
  const { normalizeMotionWorkspaceStatus } = await loadRunner();
  assert.deepEqual(
    normalizeMotionWorkspaceStatus([
      "?? output/playwright/.p2-05-run.lock/owner.json",
      "?? output/playwright/.p2-05-run.lock.init-abc/owner.json",
      "?? output/playwright/.p2-05-run.lock.stale-abc/owner.json",
      "?? output/playwright/.p2-05-run.lock.release-abc/owner.json",
      "?? output/playwright/.p2-05-candidate-abc/logs/build.log",
      "?? output/playwright/.p2-05-backup/browser-results.json",
      " M output/playwright/p2-05/browser-results.json",
      " M packages/ui/src/motion-client.tsx",
    ]),
    [" M packages/ui/src/motion-client.tsx"],
  );
});

test("restores the fixed backup left after the first evidence rename", async (context) => {
  const { recoverMotionEvidenceSwap, validateMotionEvidenceCandidate } =
    await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-recover-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const target = path.join(parent, "p2-05");
  const backup = path.join(parent, ".p2-05-backup");
  await mkdir(backup);
  await writeValidEvidenceCandidate(backup);
  await recoverMotionEvidenceSwap(target);
  await validateMotionEvidenceCandidate(target);
  assert.equal(await exists(backup), false);
});

test("validates target and backup before recovery and leaves two invalid trees unchanged", async (context) => {
  const { recoverMotionEvidenceSwap } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-recover-bad-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const target = path.join(parent, "p2-05");
  const backup = path.join(parent, ".p2-05-backup");
  await mkdir(target);
  await mkdir(backup);
  await writeFile(path.join(target, "target-marker.txt"), "target\n");
  await writeFile(path.join(backup, "backup-marker.txt"), "backup\n");

  await assert.rejects(
    recoverMotionEvidenceSwap(target),
    /target|backup|invalid|valid evidence/iu,
  );
  assert.equal(
    await readFile(path.join(target, "target-marker.txt"), "utf8"),
    "target\n",
  );
  assert.equal(
    await readFile(path.join(backup, "backup-marker.txt"), "utf8"),
    "backup\n",
  );
});

test("does not promote an invalid backup when the target is missing", async (context) => {
  const { recoverMotionEvidenceSwap } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-recover-only-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const target = path.join(parent, "p2-05");
  const backup = path.join(parent, ".p2-05-backup");
  await mkdir(backup);
  await writeFile(path.join(backup, "invalid.txt"), "invalid\n");

  await assert.rejects(
    recoverMotionEvidenceSwap(target),
    /backup|invalid|valid evidence/iu,
  );
  assert.equal(await exists(target), false);
  assert.equal(
    await readFile(path.join(backup, "invalid.txt"), "utf8"),
    "invalid\n",
  );
});

test("promotes a valid backup over an invalid target without reporting a failed recovery", async (context) => {
  const { recoverMotionEvidenceSwap, validateMotionEvidenceCandidate } =
    await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-recover-good-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const target = path.join(parent, "p2-05");
  const backup = path.join(parent, ".p2-05-backup");
  await mkdir(target);
  await writeFile(path.join(target, "invalid.txt"), "invalid\n");
  await mkdir(backup);
  await writeValidEvidenceCandidate(backup);

  await recoverMotionEvidenceSwap(target);
  await validateMotionEvidenceCandidate(target);
  assert.equal(await exists(backup), false);
});

test("never removes a valid target when deleting a backup fails", async (context) => {
  const { recoverMotionEvidenceSwap, validateMotionEvidenceCandidate } =
    await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-recover-rm-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const target = path.join(parent, "p2-05");
  const backup = path.join(parent, ".p2-05-backup");
  await mkdir(target);
  await writeValidEvidenceCandidate(target);
  await mkdir(backup);
  await writeValidEvidenceCandidate(backup);

  await assert.rejects(
    recoverMotionEvidenceSwap(target, {
      remove: async (removeTarget, options) => {
        if (removeTarget === backup) {
          throw new Error("synthetic backup removal failure");
        }
        await rm(removeTarget, options);
      },
    }),
    /synthetic backup removal failure/u,
  );
  await validateMotionEvidenceCandidate(target);
  await validateMotionEvidenceCandidate(backup);
});

test("cleanup removes candidate and lock even when server shutdown throws", async (context) => {
  const { createMotionEvidenceCleanup } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-cleanup-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const candidate = path.join(parent, ".p2-05-candidate-fixture");
  const lockPath = path.join(parent, ".p2-05-run.lock");
  await mkdir(candidate);
  await mkdir(lockPath);
  const cleanup = createMotionEvidenceCleanup({
    candidate,
    getServer: () => ({ pid: 1 }),
    lockPath,
    stop: async () => {
      throw new Error("synthetic stop failure");
    },
  });
  await assert.rejects(cleanup(), AggregateError);
  assert.equal(await exists(candidate), false);
  assert.equal(await exists(lockPath), false);
});

test("cleanup keeps the lock when swap recovery fails", async (context) => {
  const { acquireMotionEvidenceLock, createMotionEvidenceCleanup } =
    await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-cleanup-lock-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const candidate = path.join(parent, ".p2-05-candidate-fixture");
  await mkdir(candidate);
  const lock = await acquireMotionEvidenceLock(parent);
  const cleanup = createMotionEvidenceCleanup({
    candidate,
    getServer: () => undefined,
    lockPath: lock.path,
    recover: async () => {
      throw new Error("synthetic recovery failure");
    },
    releaseLock: () => lock.release(),
    stop: async () => undefined,
    target: path.join(parent, "p2-05"),
  });

  await assert.rejects(cleanup(), /recovery|cleanup/iu);
  assert.equal(await exists(lock.path), true);
});

test("cleanup preserves a lock after an earlier recovery failure", async (context) => {
  const { acquireMotionEvidenceLock, createMotionEvidenceCleanup } =
    await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-cleanup-prior-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const lock = await acquireMotionEvidenceLock(parent);
  const cleanup = createMotionEvidenceCleanup({
    canReleaseLock: () => false,
    getServer: () => undefined,
    lockPath: lock.path,
    releaseLock: () => lock.release(),
    stop: async () => undefined,
  });

  await Promise.all([cleanup(), cleanup(), cleanup()]);
  assert.equal(await exists(lock.path), true);
});

test("motion evidence cleanup is idempotent", async (context) => {
  const { createMotionEvidenceCleanup } = await loadRunner();
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-idempotent-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const candidate = path.join(parent, ".p2-05-candidate-fixture");
  const lockPath = path.join(parent, ".p2-05-run.lock");
  await mkdir(candidate);
  await mkdir(lockPath);
  let stops = 0;
  const cleanup = createMotionEvidenceCleanup({
    candidate,
    getServer: () => undefined,
    lockPath,
    stop: async () => {
      stops += 1;
    },
  });
  await Promise.all([cleanup(), cleanup(), cleanup()]);
  assert.equal(stops, 1);
  assert.equal(await exists(candidate), false);
  assert.equal(await exists(lockPath), false);
});

test("resource cleanup closes the active browser and terminates active child processes", async (context) => {
  const runner = await loadRunner();
  assert.equal(typeof runner.createMotionResourceRegistry, "function");
  const registry = runner.createMotionResourceRegistry();
  const child = spawn(
    process.execPath,
    ["--eval", "setInterval(() => undefined, 1_000)"],
    { stdio: "ignore" },
  );
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });
  registry.trackChild(child);
  let browserCloses = 0;
  registry.trackBrowser({
    close: async () => {
      browserCloses += 1;
    },
  });

  await registry.cleanup();
  assert.equal(browserCloses, 1);
  assert.notEqual(child.signalCode, null);
  await registry.cleanup();
  assert.equal(browserCloses, 1);
});

test("resource cleanup terminates a tracked POSIX process group including grandchildren", async (context) => {
  const { createMotionResourceRegistry } = await loadRunner();
  const registry = createMotionResourceRegistry();
  const source = `
    const { spawn } = require("node:child_process");
    const grandchild = spawn(process.execPath, ["--eval", "setInterval(() => undefined, 1000)"], {
      stdio: "ignore",
    });
    process.stdout.write(String(grandchild.pid) + "\\n");
    setInterval(() => undefined, 1000);
  `;
  const child = spawn(process.execPath, ["--eval", source], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let grandchildPid;
  context.after(() => {
    for (const pid of [child.pid, grandchildPid]) {
      if (Number.isSafeInteger(pid) && isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Best-effort fixture cleanup.
        }
      }
    }
  });
  registry.trackChild(child, { processGroup: process.platform !== "win32" });
  grandchildPid = Number(
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("grandchild fixture did not start")),
        2_000,
      );
      child.stdout.once("data", (chunk) => {
        clearTimeout(timeout);
        resolve(chunk.toString().trim());
      });
    }),
  );
  assert.equal(isProcessAlive(grandchildPid), true);

  await registry.cleanup();
  await Promise.all([
    waitForProcessExit(child.pid),
    waitForProcessExit(grandchildPid),
  ]);
});

test("a hanging browser close is bounded and cannot block child cleanup", async (context) => {
  const { createMotionResourceRegistry } = await loadRunner();
  const registry = createMotionResourceRegistry({ browserCloseTimeoutMs: 40 });
  const child = spawn(
    process.execPath,
    ["--eval", "setInterval(() => undefined, 1_000)"],
    {
      detached: process.platform !== "win32",
      stdio: "ignore",
    },
  );
  context.after(() => {
    if (isProcessAlive(child.pid)) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // Best-effort fixture cleanup.
      }
    }
  });
  registry.trackChild(child, { processGroup: process.platform !== "win32" });
  registry.trackBrowser({ close: () => new Promise(() => undefined) });

  const cleanup = registry.cleanup();
  await waitForProcessExit(child.pid, 500);
  await assert.rejects(cleanup, /browser close.*timed out/iu);
});

test("SIGTERM runs cleanup before preserving signal exit semantics", async (context) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "p2-05-signal-"));
  context.after(() => rm(parent, { force: true, recursive: true }));
  const candidate = path.join(parent, ".p2-05-candidate-fixture");
  const lockPath = path.join(parent, ".p2-05-run.lock");
  await mkdir(candidate);
  await mkdir(lockPath);
  const moduleUrl = new URL("./verify-ui-motion-browser.mjs", import.meta.url)
    .href;
  const source = `
    import { createMotionEvidenceCleanup, installMotionSignalCleanup } from ${JSON.stringify(moduleUrl)};
    const cleanup = createMotionEvidenceCleanup({
      candidate: ${JSON.stringify(candidate)},
      getServer: () => undefined,
      lockPath: ${JSON.stringify(lockPath)},
      stop: async () => undefined,
    });
    installMotionSignalCleanup(cleanup);
    process.stdout.write("ready\\n");
    setInterval(() => undefined, 1_000);
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", source],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`signal fixture did not start: ${stderr}`)),
      5_000,
    );
    child.stdout.once("data", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  child.kill("SIGTERM");
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`signal fixture did not exit: ${stderr}`)),
      5_000,
    );
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(exit, { code: null, signal: "SIGTERM" });
  assert.equal(await exists(candidate), false);
  assert.equal(await exists(lockPath), false);
});

test("a second signal forces termination when graceful cleanup is stuck", async (context) => {
  const moduleUrl = new URL("./verify-ui-motion-browser.mjs", import.meta.url)
    .href;
  const source = `
    import { installMotionSignalCleanup } from ${JSON.stringify(moduleUrl)};
    installMotionSignalCleanup(() => new Promise(() => undefined));
    process.stdout.write("ready\\n");
    setInterval(() => undefined, 1_000);
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`signal fixture did not start: ${stderr}`)),
      5_000,
    );
    child.stdout.once("data", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 50));
  child.kill("SIGINT");
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`second signal did not terminate: ${stderr}`)),
      2_000,
    );
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(exit, { code: null, signal: "SIGINT" });
});
