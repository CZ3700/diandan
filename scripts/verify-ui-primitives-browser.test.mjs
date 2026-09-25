import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadRunner() {
  let loaded;
  try {
    loaded = await import("./verify-ui-primitives-browser.mjs");
  } catch {
    loaded = undefined;
  }

  for (const exportName of [
    "assessLoadingButtonLayout",
    "assessNativeZoomMeasurements",
    "assessNativeScreenshotEvidence",
    "assessPageMetrics",
    "assessReducedMotionStyles",
    "classifyBrowserResource",
    "createBrowserScenarioMatrix",
    "createEvidenceReadme",
    "createNativeZoomLaunchOptions",
    "createNativeZoomProfilePreferences",
    "isSafeRelativeArtifactPath",
    "observePage",
    "readPngDimensions",
    "replaceEvidenceDirectory",
    "sha256Text",
    "summarizeAxeResult",
    "validateScenarioMatrix",
  ]) {
    assert.equal(
      typeof loaded?.[exportName],
      "function",
      `${exportName} must be exported by the browser runner`,
    );
  }

  return loaded;
}

test("defines the complete deterministic browser and axe matrix", async () => {
  const { createBrowserScenarioMatrix, validateScenarioMatrix } =
    await loadRunner();
  const matrix = createBrowserScenarioMatrix();

  assert.deepEqual(validateScenarioMatrix(matrix), []);
  assert.equal(matrix.length, 13);
  assert.equal(new Set(matrix.map(({ id }) => id)).size, matrix.length);
  assert.equal(
    new Set(matrix.map(({ screenshot }) => screenshot)).size,
    matrix.length,
  );

  const baselines = matrix.filter(({ group }) => group === "baseline");
  assert.deepEqual(
    baselines.map(({ locale, viewport }) => [
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
    ],
  );

  const stress = matrix.filter(({ group }) => group === "stress");
  assert.deepEqual(
    stress.map(({ locale, viewport }) => [viewport.width, locale]),
    [
      [320, "en-XA"],
      [320, "pt"],
    ],
  );

  const interaction = matrix.find(({ id }) => id === "interaction-390x844-en");
  assert.deepEqual(interaction?.checks, [
    "keyboard",
    "disabled",
    "loading",
    "field",
    "quantity",
    "media-error",
  ]);

  const hover = matrix.find(({ id }) => id === "hover-1440x900-en");
  assert.deepEqual(hover?.checks, ["hover"]);

  const rtl = matrix.find(({ id }) => id === "rtl-390x844-en");
  assert.deepEqual(rtl?.checks, ["rtl-quantity"]);

  assert.deepEqual(
    matrix
      .filter(({ reducedMotion }) => reducedMotion)
      .map(({ viewport }) => [viewport.width, viewport.height]),
    [
      [390, 844],
      [1440, 900],
    ],
  );

  assert.deepEqual(
    matrix.flatMap(({ axe }) => axe.map(({ id }) => id)).sort(),
    [
      "default-desktop",
      "default-mobile",
      "error",
      "loading",
      "pseudo-320",
      "rtl",
    ],
  );
});

test("rejects incomplete, duplicate, or unsafe matrix entries", async () => {
  const {
    createBrowserScenarioMatrix,
    isSafeRelativeArtifactPath,
    validateScenarioMatrix,
  } = await loadRunner();
  const matrix = globalThis.structuredClone(createBrowserScenarioMatrix());
  matrix[1].id = matrix[0].id;
  matrix[2].screenshot = "../outside.png";
  matrix.pop();

  const errors = validateScenarioMatrix(matrix);
  assert.ok(errors.some((error) => error.includes("duplicate scenario id")));
  assert.ok(errors.some((error) => error.includes("safe relative PNG")));
  assert.ok(errors.some((error) => error.includes("reduced motion")));

  assert.equal(
    isSafeRelativeArtifactPath("viewports/390x844-vi.png", ".png"),
    true,
  );
  for (const unsafePath of [
    "..\\outside.png",
    "C:\\evidence\\outside.png",
    "C:outside.png",
    "\\\\server\\share\\outside.png",
  ]) {
    assert.equal(
      isSafeRelativeArtifactPath(unsafePath, ".png"),
      false,
      unsafePath,
    );
    const windowsUnsafe = globalThis.structuredClone(
      createBrowserScenarioMatrix(),
    );
    windowsUnsafe[0].screenshot = unsafePath;
    assert.ok(
      validateScenarioMatrix(windowsUnsafe).some((error) =>
        error.includes("safe relative PNG"),
      ),
      unsafePath,
    );
  }
});

test("rejects unsafe, duplicate, and unapproved axe artifact ids", async () => {
  const { createBrowserScenarioMatrix, validateScenarioMatrix } =
    await loadRunner();

  const unsafe = globalThis.structuredClone(createBrowserScenarioMatrix());
  unsafe[1].axe[0].id = "../../../escaped";
  assert.ok(
    validateScenarioMatrix(unsafe).some((error) =>
      error.includes("safe lowercase axe scan id"),
    ),
  );

  const duplicate = globalThis.structuredClone(createBrowserScenarioMatrix());
  duplicate[4].axe[0].id = "default-mobile";
  assert.ok(
    validateScenarioMatrix(duplicate).some((error) =>
      error.includes("duplicate axe scan id"),
    ),
  );

  const unapproved = globalThis.structuredClone(createBrowserScenarioMatrix());
  unapproved[1].axe[0].id = "unapproved-scan";
  assert.ok(
    validateScenarioMatrix(unapproved).some((error) =>
      error.includes("approved axe scan id"),
    ),
  );
});

test("waits for the request firewall before navigation can begin", async () => {
  const { observePage } = await loadRunner();
  let releaseRoute;
  const routeInstalled = new Promise((resolve) => {
    releaseRoute = resolve;
  });
  const registeredEvents = [];
  const context = {
    route(pattern, handler) {
      assert.equal(pattern, "**/*");
      assert.equal(typeof handler, "function");
      return routeInstalled;
    },
  };
  const page = {
    on(event, handler) {
      registeredEvents.push(event);
      assert.equal(typeof handler, "function");
    },
  };

  let settled = false;
  const pending = observePage(page, context, "http://127.0.0.1:4312").then(
    (value) => {
      settled = true;
      return value;
    },
  );
  await Promise.resolve();
  assert.equal(settled, false);

  releaseRoute();
  const diagnostics = await pending;
  assert.equal(settled, true);
  assert.deepEqual(registeredEvents.sort(), [
    "console",
    "pageerror",
    "requestfailed",
    "response",
  ]);
  assert.deepEqual(diagnostics.externalResources, []);
});

test("allows only same-origin and embedded browser resources", async () => {
  const { classifyBrowserResource } = await loadRunner();
  const origin = "http://127.0.0.1:4312";

  assert.deepEqual(
    classifyBrowserResource(
      "http://127.0.0.1:4312/_next/static/app.js",
      origin,
    ),
    { allowed: true, reason: "same-origin" },
  );
  assert.deepEqual(
    classifyBrowserResource("data:image/svg+xml;base64,PHN2Zy8+", origin),
    { allowed: true, reason: "embedded" },
  );
  assert.deepEqual(
    classifyBrowserResource("blob:http://127.0.0.1:4312/id", origin),
    { allowed: true, reason: "embedded" },
  );
  assert.deepEqual(
    classifyBrowserResource("https://fonts.example.test/font.woff2", origin),
    { allowed: false, reason: "external-origin" },
  );
  assert.deepEqual(
    classifyBrowserResource(
      "http://user:password@127.0.0.1:4312/private",
      origin,
    ),
    { allowed: false, reason: "embedded-credentials" },
  );
});

test("blocks overflow, clipping, replacement glyphs, and sub-48px controls", async () => {
  const { assessPageMetrics } = await loadRunner();
  const healthy = {
    clippedText: [],
    controls: [{ height: 48, label: "Continue", width: 120 }],
    document: {
      bodyScrollWidth: 390,
      clientWidth: 390,
      scrollWidth: 390,
    },
    replacementGlyphs: 0,
  };
  assert.deepEqual(assessPageMetrics(healthy), []);

  const errors = assessPageMetrics({
    clippedText: [{ reason: "vertical-clip", selector: "#heading" }],
    controls: [{ height: 47.9, label: "Continue", width: 120 }],
    document: {
      bodyScrollWidth: 405,
      clientWidth: 390,
      scrollWidth: 405,
    },
    replacementGlyphs: 1,
  });
  assert.ok(errors.some((error) => error.includes("horizontal overflow")));
  assert.ok(errors.some((error) => error.includes("#heading")));
  assert.ok(errors.some((error) => error.includes("below 48px")));
  assert.ok(errors.some((error) => error.includes("replacement glyph")));
});

test("blocks primitive boundaries below 3:1 non-text contrast", async () => {
  const { assessPageMetrics } = await loadRunner();
  const errors = assessPageMetrics({
    clippedText: [],
    contrastChecks: [
      { label: "Field", ratio: 2.99, required: 3 },
      { label: "Quantity", ratio: 3, required: 3 },
      { label: "Missing boundary", ratio: Number.NaN, required: 3 },
    ],
    controls: [],
    document: {
      bodyScrollWidth: 390,
      clientWidth: 390,
      scrollWidth: 390,
    },
    replacementGlyphs: 0,
  });

  assert.deepEqual(errors, [
    "non-text contrast below 3:1: Field is 2.99:1",
    "non-text contrast below 3:1: Missing boundary is NaN:1",
  ]);
});

test("proves a loading label keeps its layout footprint under an absolute spinner", async () => {
  const { assessLoadingButtonLayout } = await loadRunner();
  assert.deepEqual(
    assessLoadingButtonLayout({
      button: { height: 48, width: 164, x: 20, y: 12 },
      label: {
        display: "block",
        height: 20,
        opacity: 0,
        position: "relative",
        width: 116,
        x: 44,
        y: 26,
      },
      spinner: { position: "absolute" },
    }),
    [],
  );

  const errors = assessLoadingButtonLayout({
    button: { height: 48, width: 48, x: 20, y: 12 },
    label: {
      display: "none",
      height: 0,
      opacity: 1,
      position: "absolute",
      width: 0,
      x: 200,
      y: 200,
    },
    spinner: { position: "static" },
  });
  assert.ok(errors.some((error) => error.includes("label footprint")));
  assert.ok(errors.some((error) => error.includes("label opacity")));
  assert.ok(errors.some((error) => error.includes("normal layout flow")));
  assert.ok(errors.some((error) => error.includes("inside Button bounds")));
  assert.ok(errors.some((error) => error.includes("absolute overlay")));
});

test("requires reduced motion on Field and Quantity as well as Button and Link", async () => {
  const { assessReducedMotionStyles } = await loadRunner();
  const healthy = {
    activeTransform: "none",
    buttonTransitionDuration: "0s",
    fieldTransitionDuration: "0s",
    linkTransitionDuration: "0s",
    quantityButtonTransitionDuration: "0s",
    scrollBehavior: "auto",
    spinnerAnimationName: "none",
  };
  assert.deepEqual(assessReducedMotionStyles(healthy), []);

  const errors = assessReducedMotionStyles({
    ...healthy,
    fieldTransitionDuration: "0.22s",
    quantityButtonTransitionDuration: "0s, 0.12s",
  });
  assert.ok(errors.some((error) => error.includes("Field transition")));
  assert.ok(errors.some((error) => error.includes("Quantity transition")));
});

test("builds Chrome HostZoomMap preferences for an exact 200 percent default zoom", async () => {
  const { createNativeZoomProfilePreferences } = await loadRunner();
  const preferences = createNativeZoomProfilePreferences(200);
  assert.ok(
    Math.abs(preferences.partition.default_zoom_level.x - 3.8017840169239308) <
      1e-12,
  );
  assert.equal(preferences.browser.check_default_browser, false);
  assert.equal(preferences.profile.exit_type, "Normal");
});

test("launches installed Chrome headed with its native window and no emulated viewport", async () => {
  const { createNativeZoomLaunchOptions } = await loadRunner();
  const options = createNativeZoomLaunchOptions(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "http://127.0.0.1:4312",
  );
  assert.equal(options.baseURL, "http://127.0.0.1:4312");
  assert.equal(options.executablePath.includes("Google Chrome"), true);
  assert.equal(options.headless, false);
  assert.equal(options.viewport, null);
  assert.equal("deviceScaleFactor" in options, false);
  assert.ok(options.args.includes("--window-size=1710,929"));
  assert.ok(options.args.includes("--no-first-run"));
});

test("accepts only measurements proving native Chrome 200 percent page zoom", async () => {
  const {
    assessNativeScreenshotEvidence,
    assessNativeZoomMeasurements,
    readPngDimensions,
  } = await loadRunner();
  const baseline = {
    devicePixelRatio: 2,
    innerHeight: 842,
    innerWidth: 1710,
    outerHeight: 929,
    outerWidth: 1710,
    visualViewport: { height: 842, scale: 1, width: 1710 },
  };
  const zoomed = {
    devicePixelRatio: 4,
    innerHeight: 421,
    innerWidth: 855,
    outerHeight: 929,
    outerWidth: 1710,
    visualViewport: { height: 421, scale: 1, width: 855 },
  };

  assert.deepEqual(
    assessNativeZoomMeasurements({ baseline, expectedPercent: 200, zoomed }),
    [],
  );

  const errors = assessNativeZoomMeasurements({
    baseline,
    expectedPercent: 200,
    zoomed: {
      ...zoomed,
      devicePixelRatio: 2,
      innerWidth: 1710,
      outerWidth: 1600,
      visualViewport: { height: 421, scale: 2, width: 855 },
    },
  });
  assert.ok(errors.some((error) => error.includes("outer window")));
  assert.ok(errors.some((error) => error.includes("CSS viewport width")));
  assert.ok(errors.some((error) => error.includes("device pixel ratio")));
  assert.ok(errors.some((error) => error.includes("visual viewport scale")));

  const completeScreenshot = {
    captureMethod: "CDP Page.captureScreenshot without emulation",
    localeMarker: {
      changedFromHidden: true,
      height: 72,
      width: 96,
      x: 3270,
      y: 40,
    },
    pixelHeight: 1684,
    pixelWidth: 3420,
  };
  assert.deepEqual(
    assessNativeScreenshotEvidence({
      baseline: { measurement: baseline, screenshot: completeScreenshot },
      zoomed: { measurement: zoomed, screenshot: completeScreenshot },
    }),
    [],
  );

  const screenshotErrors = assessNativeScreenshotEvidence({
    baseline: { measurement: baseline, screenshot: completeScreenshot },
    zoomed: {
      measurement: zoomed,
      screenshot: {
        ...completeScreenshot,
        localeMarker: {
          ...completeScreenshot.localeMarker,
          changedFromHidden: false,
        },
        pixelHeight: 842,
        pixelWidth: 1710,
      },
    },
  });
  assert.ok(
    screenshotErrors.some((error) =>
      error.includes("complete physical viewport"),
    ),
  );
  assert.ok(
    screenshotErrors.some((error) =>
      error.includes("right-edge locale marker"),
    ),
  );

  const pngHeader = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(pngHeader);
  pngHeader.write("IHDR", 12, "ascii");
  pngHeader.writeUInt32BE(3420, 16);
  pngHeader.writeUInt32BE(1684, 20);
  assert.deepEqual(readPngDimensions(pngHeader), {
    height: 1684,
    width: 3420,
  });
  assert.throws(() => readPngDimensions(Buffer.from("not-a-png")), /PNG/u);
});

test("does not use CDP device metrics or page-scale emulation", async () => {
  const source = await readFile(
    new globalThis.URL("./verify-ui-primitives-browser.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /setDeviceMetricsOverride/u);
  assert.doesNotMatch(source, /setPageScaleFactor/u);
  assert.doesNotMatch(source, /setZoomFactor/u);
  assert.doesNotMatch(source, /Emulation\./u);
  assert.doesNotMatch(source, /dispatchEvent\(new Event\(["']error["']/u);
  assert.match(
    source,
    /getByTestId\(["']media-error-trigger["']\)[\s\S]{0,120}\.click\(\)/u,
  );
});

test("gates only critical and serious axe violations while preserving counts", async () => {
  const { summarizeAxeResult } = await loadRunner();
  const summary = summarizeAxeResult({
    inapplicable: [{ id: "unused" }],
    incomplete: [{ id: "needs-review" }],
    passes: [{ id: "color-contrast" }, { id: "document-title" }],
    violations: [
      { id: "critical-rule", impact: "critical", nodes: [{}, {}] },
      { id: "serious-rule", impact: "serious", nodes: [{}] },
      { id: "moderate-rule", impact: "moderate", nodes: [{}] },
    ],
  });

  assert.deepEqual(summary.counts, {
    inapplicable: 1,
    incomplete: 1,
    passes: 2,
    violations: 3,
  });
  assert.deepEqual(summary.blocking, [
    { id: "critical-rule", impact: "critical", nodeCount: 2 },
    { id: "serious-rule", impact: "serious", nodeCount: 1 },
  ]);
});

test("renders provenance, rerun command, runtime gates, and screenshot hashes", async () => {
  const { createEvidenceReadme } = await loadRunner();
  const readme = createEvidenceReadme({
    generatedAt: "2026-09-04T02:00:00.000Z",
    git: { dirty: true, sha: "0123456789abcdef" },
    nativeZoom: {
      baseline: {
        devicePixelRatio: 2,
        innerHeight: 842,
        innerWidth: 1710,
        outerHeight: 929,
        outerWidth: 1710,
      },
      method:
        "Chrome HostZoomMap default zoom preference in an isolated temporary profile",
      profileRemoved: true,
      zoomPercent: 200,
      zoomed: {
        devicePixelRatio: 4,
        innerHeight: 421,
        innerWidth: 855,
        outerHeight: 929,
        outerWidth: 1710,
      },
    },
    rerunCommand:
      "mise exec node@24.20.0 -- node scripts/verify-ui-primitives-browser.mjs",
    runtimeGates: [
      { environment: "staging", fixtureStatus: 404, healthStatus: 200 },
      { environment: "production", fixtureStatus: 404, healthStatus: 200 },
    ],
    screenshots: [
      {
        path: "viewports/390x844-vi.png",
        sha256: "abc123",
      },
    ],
    versions: {
      axe: "4.13.0",
      browser: "Chromium 152.0.0.0",
      next: "16.3.4",
      node: "v24.20.0",
      playwright: "1.62.1",
      pnpm: "11.25.0",
      react: "19.2.8",
    },
  });

  for (const expected of [
    "0123456789abcdef",
    "dirty: true",
    "Playwright `1.62.1`",
    "axe `4.13.0`",
    "staging",
    "production",
    "fixture 404",
    "healthz 200",
    "viewports/390x844-vi.png",
    "abc123",
    "verify-ui-primitives-browser.mjs",
    "HostZoomMap",
    "200%",
    "1710×842",
    "855×421",
    "DPR 2 → 4",
    "isolated temporary profile was removed",
  ]) {
    assert.ok(readme.includes(expected), `README must include ${expected}`);
  }
});

async function writeCompleteEvidenceCandidate(candidate) {
  const { createBrowserScenarioMatrix, summarizeAxeResult } =
    await loadRunner();
  const matrix = createBrowserScenarioMatrix();
  const nativeScreenshotPaths = [
    "zoom/google-chrome-baseline-pt.png",
    "zoom/google-chrome-200-percent-pt.png",
  ];
  const screenshotPaths = [
    ...matrix.map(({ screenshot }) => screenshot),
    ...nativeScreenshotPaths,
  ];
  const screenshots = [];
  for (const [index, screenshotPath] of screenshotPaths.entries()) {
    const screenshotContents = nativeScreenshotPaths.includes(screenshotPath)
      ? (() => {
          const value = Buffer.alloc(24);
          Buffer.from("89504e470d0a1a0a", "hex").copy(value);
          value.write("IHDR", 12, "ascii");
          value.writeUInt32BE(3420, 16);
          value.writeUInt32BE(1684, 20);
          return value;
        })()
      : Buffer.from("deterministic-png-fixture-" + String(index));
    const screenshotHash = createHash("sha256")
      .update(screenshotContents)
      .digest("hex");
    await mkdir(path.dirname(path.join(candidate, screenshotPath)), {
      recursive: true,
    });
    await writeFile(path.join(candidate, screenshotPath), screenshotContents);
    screenshots.push({
      ...(nativeScreenshotPaths.includes(screenshotPath)
        ? {
            captureMethod: "CDP Page.captureScreenshot without emulation",
            localeMarker: {
              changedFromHidden: true,
              height: 72,
              width: 96,
              x: 3270,
              y: 40,
            },
            pixelHeight: 1684,
            pixelWidth: 3420,
          }
        : {}),
      path: screenshotPath,
      sha256: screenshotHash,
    });
  }

  const completeAxeResult = {
    inapplicable: [{ id: "fixture-inapplicable", nodes: [] }],
    incomplete: [],
    passes: [{ id: "fixture-pass", nodes: [{}] }],
    violations: [],
  };
  const axeSummaries = [];
  await mkdir(path.join(candidate, "axe-results"), { recursive: true });
  for (const entry of matrix) {
    for (const scan of entry.axe) {
      const axePath = `axe-results/${scan.id}.json`;
      await writeFile(
        path.join(candidate, axePath),
        JSON.stringify({
          result: completeAxeResult,
          scan: { id: scan.id, scenarioId: entry.id },
          schemaVersion: 1,
        }),
      );
      axeSummaries.push({
        ...summarizeAxeResult(completeAxeResult),
        artifact: axePath,
        id: scan.id,
        scenarioId: entry.id,
      });
    }
  }

  await writeFile(path.join(candidate, "README.md"), "# Evidence\n");
  await writeFile(
    path.join(candidate, "screenshots.sha256"),
    screenshots
      .map(({ path: screenshotPath, sha256 }) =>
        [sha256, screenshotPath].join("  "),
      )
      .join("\n") + "\n",
  );
  const baselineMeasurement = {
    devicePixelRatio: 2,
    innerHeight: 842,
    innerWidth: 1710,
    outerHeight: 929,
    outerWidth: 1710,
    visualViewport: { height: 842, scale: 1, width: 1710 },
  };
  const zoomedMeasurement = {
    devicePixelRatio: 4,
    innerHeight: 421,
    innerWidth: 855,
    outerHeight: 929,
    outerWidth: 1710,
    visualViewport: { height: 421, scale: 1, width: 855 },
  };
  const nativeScreenshots = screenshots.filter(({ path: screenshotPath }) =>
    nativeScreenshotPaths.includes(screenshotPath),
  );
  const validMetrics = (clientWidth) => ({
    clippedText: [],
    contrastChecks: ["Field", "Quantity", "Secondary Button"].map((label) => ({
      background: "rgb(0, 0, 0)",
      border: "rgb(255, 255, 255)",
      label,
      ratio: 21,
      required: 3,
    })),
    controls: Array.from({ length: 12 }, (_, index) => ({
      height: 48,
      label: "control-" + String(index),
      selector: ".control-" + String(index),
      width: 48,
    })),
    document: {
      bodyScrollWidth: clientWidth,
      clientWidth,
      scrollWidth: clientWidth,
    },
    fontsStatus: "loaded",
    replacementGlyphs: 0,
  });
  const validDiagnostics = (fixtureUrl) => ({
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
        url: "http://127.0.0.1:4312" + fixtureUrl,
      },
    ],
  });
  const validInteractionChecks = (viewport) => ({
    disabled: { disabled: true, skippedByTab: true },
    field: {
      describedBy: [
        "primitive-display-name-hint",
        "primitive-display-name-error",
      ],
      invalid: true,
      labelAssociated: true,
    },
    keyboard: {
      activationCount: 2,
      focusStyle: {
        focusVisible: true,
        outlineStyle: "solid",
        outlineWidth: "3px",
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
        x: 10,
        y: 10,
      },
    },
    loading: {
      ariaBusy: true,
      disabled: true,
      layout: {
        button: { height: 48, width: 164, x: 10, y: 10 },
        label: {
          display: "block",
          height: 20,
          opacity: 0,
          position: "static",
          width: 116,
          x: 34,
          y: 24,
        },
        spinner: { position: "absolute" },
      },
      skippedByTab: true,
    },
    mediaError: {
      accessibleFallback: true,
      browserDecodeFailed: true,
      frameAfter: [{ height: 100, width: 80 }],
      frameBefore: [{ height: 100, width: 80 }],
      initialSrc: "/ui-primitives-media.svg",
      requestedSrc: "data:image/png;base64,SGVsbG8=",
      sourceChanged: true,
      triggerClicked: true,
    },
    quantity: {
      arrowDown: 2,
      arrowUp: 3,
      end: 5,
      home: 1,
      semantics: "number spinbutton",
    },
    tabOrder: [
      { loading: null, testId: null },
      { loading: null, testId: "primary-action" },
      { disabled: false, loading: null, testId: "media-error-trigger" },
    ],
  });
  const validChecks = (entry) => {
    if (entry.checks.includes("keyboard")) {
      return validInteractionChecks(entry.viewport);
    }
    if (entry.checks.includes("hover")) {
      return {
        hover: {
          buttonAfter: "shadow",
          buttonBefore: "none",
          fieldAfter: "accent",
          fieldBefore: "border",
          linkAfter: "foreground",
          linkBefore: "accent",
        },
      };
    }
    if (entry.checks.includes("rtl-quantity")) {
      return {
        rtlQuantity: {
          actionOrder: ["decrease", "true", "increase"],
          arrowDown: 2,
          arrowUp: 3,
          controlsDirection: "ltr",
          probeDirection: "rtl",
        },
      };
    }
    if (entry.reducedMotion === true) {
      return {
        reducedMotion: {
          activeTransform: "none",
          buttonTransitionDuration: "0s",
          fieldTransitionDuration: "0s",
          linkTransitionDuration: "0s",
          mediaQuery: true,
          quantityButtonTransitionDuration: "0s",
          scrollBehavior: "auto",
          spinnerAnimationName: "none",
        },
      };
    }
    return {};
  };
  const primitiveCounts = Object.fromEntries(
    [
      "button",
      "link",
      "icon",
      "media",
      "price",
      "status",
      "field",
      "quantity",
    ].map((primitive) => [primitive, 1]),
  );
  const nativeFixtureUrl = "/_internal/design-foundations/pt/primitives";
  const results = {
    axeSummaries,
    matrix: globalThis.structuredClone(matrix),
    nativeZoom: {
      baseline: {
        ...baselineMeasurement,
        checks: {},
        diagnostics: validDiagnostics(nativeFixtureUrl),
        fixtureUrl: nativeFixtureUrl,
        metrics: validMetrics(baselineMeasurement.innerWidth),
        primitiveCounts,
        screenshot: nativeScreenshotPaths[0],
        screenshotEvidence: nativeScreenshots[0],
      },
      detectedPercent: 200,
      profileRemoved: true,
      screenshots: nativeScreenshots,
      zoomPercent: 200,
      zoomed: {
        ...zoomedMeasurement,
        checks: validInteractionChecks({
          height: zoomedMeasurement.innerHeight,
          width: zoomedMeasurement.innerWidth,
        }),
        diagnostics: validDiagnostics(nativeFixtureUrl),
        fixtureUrl: nativeFixtureUrl,
        metrics: validMetrics(zoomedMeasurement.innerWidth),
        primitiveCounts,
        screenshot: nativeScreenshotPaths[1],
        screenshotEvidence: nativeScreenshots[1],
      },
    },
    result: "passed",
    runtimeGates: [
      { environment: "preview", fixtureStatus: 200, healthStatus: 200 },
      { environment: "staging", fixtureStatus: 404, healthStatus: 200 },
      { environment: "production", fixtureStatus: 404, healthStatus: 200 },
    ],
    scenarioResults: matrix.map((entry) => {
      const fixtureUrl =
        "/_internal/design-foundations/" + entry.locale + "/primitives";
      return {
        checks: validChecks(entry),
        diagnostics: validDiagnostics(fixtureUrl),
        errors: [],
        fixtureUrl,
        group: entry.group,
        id: entry.id,
        locale: entry.locale,
        metrics: validMetrics(entry.viewport.width),
        reducedMotion: entry.reducedMotion === true,
        screenshot: entry.screenshot,
        viewport: entry.viewport,
      };
    }),
    schemaVersion: 1,
    screenshots,
  };
  await writeFile(
    path.join(candidate, "browser-results.json"),
    JSON.stringify(results),
  );
  return {
    axePath: axeSummaries[0].artifact,
    results,
    screenshotHash: screenshots[0].sha256,
    screenshotPath: screenshots[0].path,
  };
}

test("hashes text deterministically", async () => {
  const { sha256Text } = await loadRunner();
  assert.equal(
    sha256Text("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("replaces evidence only after a complete candidate directory exists", async (context) => {
  const { replaceEvidenceDirectory } = await loadRunner();
  const root = await mkdtemp(path.join(os.tmpdir(), "p2-02-browser-output-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const target = path.join(root, "p2-02");
  const candidate = path.join(root, ".p2-02-candidate");
  await mkdir(target);
  await mkdir(candidate);
  await writeFile(path.join(target, "old.txt"), "old");
  await writeCompleteEvidenceCandidate(candidate);

  await replaceEvidenceDirectory(candidate, target);

  assert.equal(
    JSON.parse(
      await readFile(path.join(target, "browser-results.json"), "utf8"),
    ).result,
    "passed",
  );
  await assert.rejects(readFile(path.join(target, "old.txt"), "utf8"));
  await assert.rejects(readFile(candidate, "utf8"));
  const entries = await (await import("node:fs/promises")).readdir(root);
  assert.deepEqual(entries, ["p2-02"]);
});

test("rejects incomplete candidate evidence and preserves the previous directory", async (context) => {
  const { replaceEvidenceDirectory } = await loadRunner();
  const root = await mkdtemp(path.join(os.tmpdir(), "p2-02-browser-output-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const cases = [
    {
      mutate: async ({ candidate, screenshotPath }) =>
        rm(path.join(candidate, screenshotPath)),
      name: "missing screenshot artifact",
      pattern: /missing screenshot artifact/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        results.axeSummaries.pop();
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "five axe summaries",
      pattern: /exactly six axe summaries/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        results.scenarioResults[0].id = "unexpected-scenario";
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "wrong scenario set",
      pattern: /exactly 13 scenario results/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        results.scenarioResults = results.scenarioResults.map(
          ({ errors, id, screenshot }) => ({ errors, id, screenshot }),
        );
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "scenario result shells",
      pattern: /scenario evidence/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        results.matrix[0].locale = "pt";
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "tampered scenario matrix",
      pattern: /exact scenario matrix/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        results.runtimeGates[1].fixtureStatus = 200;
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "wrong runtime gates",
      pattern: /exactly three runtime gates/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        results.nativeZoom.profileRemoved = false;
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "unclean native profile",
      pattern: /native zoom profile removal/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        delete results.nativeZoom.zoomed.metrics;
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "native zoom evidence shell",
      pattern: /native zoomed evidence/u,
    },
    {
      mutate: async ({ candidate, results }) => {
        results.screenshots.pop();
        await writeFile(
          path.join(candidate, "browser-results.json"),
          JSON.stringify(results),
        );
      },
      name: "missing zoom screenshot declaration",
      pattern: /exactly 15 screenshots/u,
    },
    {
      mutate: async ({ candidate }) => {
        const manifestPath = path.join(candidate, "screenshots.sha256");
        const manifest = await readFile(manifestPath, "utf8");
        await writeFile(
          manifestPath,
          manifest.replace("viewports/360x800-en.png", "..\\outside.png"),
        );
      },
      name: "Windows traversal screenshot manifest",
      pattern: /screenshots\.sha256 has an invalid entry/u,
    },
    {
      mutate: async ({ axePath, candidate }) => {
        const artifact = JSON.parse(
          await readFile(path.join(candidate, axePath), "utf8"),
        );
        artifact.scan.scenarioId = "wrong-scenario";
        await writeFile(
          path.join(candidate, axePath),
          JSON.stringify(artifact),
        );
      },
      name: "mismatched axe artifact metadata",
      pattern: /axe artifact scan metadata/u,
    },
    {
      mutate: async ({ axePath, candidate, results }) => {
        const artifact = JSON.parse(
          await readFile(path.join(candidate, axePath), "utf8"),
        );
        artifact.result = {
          inapplicable: [],
          incomplete: [],
          passes: [],
          violations: [],
        };
        const summary = results.axeSummaries.find(
          ({ artifact: summaryPath }) => summaryPath === axePath,
        );
        summary.blocking = [];
        summary.counts = {
          inapplicable: 0,
          incomplete: 0,
          passes: 0,
          violations: 0,
        };
        await Promise.all([
          writeFile(path.join(candidate, axePath), JSON.stringify(artifact)),
          writeFile(
            path.join(candidate, "browser-results.json"),
            JSON.stringify(results),
          ),
        ]);
      },
      name: "empty axe inventory",
      pattern: /non-empty axe rule inventory/u,
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const caseRoot = path.join(root, String(index));
    const target = path.join(caseRoot, "p2-02");
    const candidate = path.join(caseRoot, ".p2-02-candidate");
    await mkdir(target, { recursive: true });
    await mkdir(candidate, { recursive: true });
    await writeFile(path.join(target, "old.txt"), "preserve-me");
    const complete = await writeCompleteEvidenceCandidate(candidate);
    await testCase.mutate({ candidate, ...complete });

    await assert.rejects(
      replaceEvidenceDirectory(candidate, target),
      testCase.pattern,
      testCase.name,
    );
    assert.equal(
      await readFile(path.join(target, "old.txt"), "utf8"),
      "preserve-me",
      testCase.name,
    );
  }
});

test("rejects a screenshot hash mismatch before replacing prior evidence", async (context) => {
  const { replaceEvidenceDirectory } = await loadRunner();
  const root = await mkdtemp(path.join(os.tmpdir(), "p2-02-browser-output-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const target = path.join(root, "p2-02");
  const candidate = path.join(root, ".p2-02-candidate");
  await mkdir(target);
  await mkdir(candidate);
  await writeFile(path.join(target, "old.txt"), "preserve-me");
  const { screenshotPath } = await writeCompleteEvidenceCandidate(candidate);
  await writeFile(path.join(candidate, screenshotPath), "tampered");

  await assert.rejects(
    replaceEvidenceDirectory(candidate, target),
    /screenshot SHA-256 mismatch/u,
  );
  assert.equal(
    await readFile(path.join(target, "old.txt"), "utf8"),
    "preserve-me",
  );
});
