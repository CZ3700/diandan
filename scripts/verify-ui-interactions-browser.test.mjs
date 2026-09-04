import assert from "node:assert/strict";
import test from "node:test";

async function loadRunner() {
  let runner;
  try {
    runner = await import("./verify-ui-interactions-browser.mjs");
  } catch {
    runner = undefined;
  }

  for (const name of [
    "assessInteractionMeasurements",
    "assessReducedMotionMeasurements",
    "classifyBrowserResource",
    "classifyOverlayFocus",
    "createEvidenceReadme",
    "createInteractionTextRootSelector",
    "createInteractionScenarioMatrix",
    "isSafeRelativeArtifactPath",
    "validateEvidenceBundle",
    "validateInteractionScenarioMatrix",
  ]) {
    assert.equal(
      typeof runner?.[name],
      "function",
      `${name} must be exported by the P2-03 browser runner`,
    );
  }

  return runner;
}

test("defines every required locale, viewport, interaction, axe, and motion case", async () => {
  const { createInteractionScenarioMatrix, validateInteractionScenarioMatrix } =
    await loadRunner();
  const matrix = createInteractionScenarioMatrix();

  assert.deepEqual(validateInteractionScenarioMatrix(matrix), []);
  assert.equal(matrix.length, 13);
  assert.equal(new Set(matrix.map(({ id }) => id)).size, matrix.length);
  assert.equal(
    new Set(matrix.map(({ screenshot }) => screenshot)).size,
    matrix.length,
  );

  assert.deepEqual(
    matrix
      .filter(({ group }) => group === "baseline")
      .map(({ locale, viewport }) => [viewport.width, viewport.height, locale]),
    [
      [360, 800, "en"],
      [390, 844, "vi"],
      [768, 1024, "th"],
      [1024, 768, "zh-CN"],
      [1440, 900, "ja"],
      [1920, 1080, "es"],
    ],
  );
  assert.deepEqual([...new Set(matrix.map(({ locale }) => locale))].sort(), [
    "en",
    "en-XA",
    "es",
    "ja",
    "pt",
    "th",
    "vi",
    "zh-CN",
  ]);
  assert.ok(
    matrix.some(
      ({ locale, viewport }) => locale === "en-XA" && viewport.width === 320,
    ),
  );
  assert.deepEqual(
    matrix
      .filter(({ reducedMotion }) => reducedMotion)
      .map(({ viewport }) => [viewport.width, viewport.height]),
    [
      [390, 844],
      [1440, 900],
    ],
  );

  const interaction = matrix.find(
    ({ id }) => id === "interaction-390x844-en-to-ja",
  );
  assert.deepEqual(interaction?.checks, [
    "dialog",
    "drawer",
    "menu",
    "toast",
    "locale-region",
  ]);
  const touch = matrix.find(({ id }) => id === "touch-menu-390x844-en");
  assert.equal(touch?.hasTouch, true);
  assert.equal(touch?.isMobile, true);
  assert.deepEqual(touch?.checks, ["touch-menu"]);
  assert.deepEqual(
    matrix.find(({ id }) => id === "viewport-1440x900-ja")?.checks,
    ["drawer-outside"],
  );
  const rtl = matrix.find(({ id }) => id === "rtl-1440x900-en");
  assert.equal(rtl?.direction, "rtl");
  assert.deepEqual(rtl?.checks, ["rtl"]);
  assert.equal(rtl?.screenshotState, "menu");
  assert.deepEqual(
    matrix.flatMap(({ axe }) => axe.map(({ id }) => id)).sort(),
    [
      "base-desktop",
      "base-mobile",
      "dialog",
      "drawer",
      "menu",
      "pseudo-320",
      "reduced-motion",
      "toast",
    ],
  );
});

test("scenario validation fails closed for missing, duplicate, and unsafe evidence", async () => {
  const {
    createInteractionScenarioMatrix,
    isSafeRelativeArtifactPath,
    validateInteractionScenarioMatrix,
  } = await loadRunner();
  const matrix = globalThis.structuredClone(createInteractionScenarioMatrix());
  matrix[1].id = matrix[0].id;
  matrix[2].screenshot = "../escaped.png";
  matrix[3].locale = "fr";
  matrix.pop();

  const errors = validateInteractionScenarioMatrix(matrix);
  assert.ok(errors.some((error) => error.includes("duplicate scenario id")));
  assert.ok(errors.some((error) => error.includes("safe relative PNG")));
  assert.ok(errors.some((error) => error.includes("unsupported locale")));
  assert.ok(errors.some((error) => error.includes("reduced motion")));

  assert.equal(
    isSafeRelativeArtifactPath("viewports/390x844-vi.png", ".png"),
    true,
  );
  for (const value of [
    "../escaped.png",
    "..\\escaped.png",
    "/tmp/escaped.png",
    "C:\\escaped.png",
    "viewports/capture.jpg",
  ]) {
    assert.equal(isSafeRelativeArtifactPath(value, ".png"), false, value);
  }
});

test("page measurement assessment rejects overflow, clipping, small targets, and missing fonts", async () => {
  const { assessInteractionMeasurements } = await loadRunner();
  const valid = {
    clippedText: [],
    controls: [{ height: 48, label: "Open dialog", width: 48 }],
    document: { bodyScrollWidth: 390, clientWidth: 390, scrollWidth: 390 },
    fontsStatus: "loaded",
    replacementGlyphs: 0,
    surfaces: [
      {
        bottom: 700,
        clientHeight: 300,
        label: "menu",
        left: 0,
        overflowY: "auto",
        right: 300,
        scrollHeight: 300,
        top: 400,
        viewportHeight: 844,
        viewportWidth: 390,
      },
    ],
  };
  assert.deepEqual(assessInteractionMeasurements(valid), []);

  const errors = assessInteractionMeasurements({
    ...valid,
    clippedText: [{ reason: "inline", selector: ".critical-copy" }],
    controls: [{ height: 47, label: "Close", width: 48 }],
    document: { bodyScrollWidth: 411, clientWidth: 390, scrollWidth: 411 },
    fontsStatus: "loading",
    replacementGlyphs: 1,
    surfaces: [
      {
        bottom: 900,
        clientHeight: 400,
        label: "menu",
        overflowY: "visible",
        scrollHeight: 700,
        top: 500,
        viewportHeight: 844,
      },
    ],
  });
  assert.ok(errors.some((error) => error.includes("horizontal overflow")));
  assert.ok(errors.some((error) => error.includes("clipped text")));
  assert.ok(errors.some((error) => error.includes("below 48px")));
  assert.ok(errors.some((error) => error.includes("replacement glyph")));
  assert.ok(errors.some((error) => error.includes("fonts are not loaded")));
  assert.ok(errors.some((error) => error.includes("outside viewport")));
  assert.ok(errors.some((error) => error.includes("must be scrollable")));

  const typeErrors = assessInteractionMeasurements({
    ...valid,
    controls: [{ height: "48", label: "Open dialog", width: "48" }],
    document: {
      bodyScrollWidth: "390",
      clientWidth: "390",
      scrollWidth: "390",
    },
    replacementGlyphs: null,
    surfaces: [
      {
        ...valid.surfaces[0],
        clientHeight: "300",
        top: "400",
      },
    ],
  });
  assert.ok(
    typeErrors.some((error) => error.includes("measurement inventory")),
  );
  assert.ok(typeErrors.some((error) => error.includes("below 48px")));
  assert.ok(typeErrors.some((error) => error.includes("outside viewport")));
  assert.ok(typeErrors.some((error) => error.includes("finite numbers")));
});

test("interaction text measurement includes portal surfaces", async () => {
  const { createInteractionTextRootSelector } = await loadRunner();
  const selectors = new Set(
    createInteractionTextRootSelector()
      .split(",")
      .map((selector) => selector.trim()),
  );

  assert.deepEqual(
    selectors,
    new Set([
      "main",
      ".fs-menu__popup",
      ".fs-dialog__popup",
      ".fs-drawer__popup",
      ".fs-toast",
    ]),
  );
});

test("reduced-motion assessment requires the media query and zero animation", async () => {
  const { assessReducedMotionMeasurements } = await loadRunner();
  const valid = {
    matches: true,
    styles: [
      {
        animationDelay: "0s",
        animationDuration: "0s",
        label: "dialog",
        startingTransform: "none",
        transitionDelay: "0s",
        transitionDuration: "0s",
      },
    ],
  };
  assert.deepEqual(assessReducedMotionMeasurements(valid), []);

  const errors = assessReducedMotionMeasurements({
    matches: false,
    styles: [
      {
        animationDelay: "0s",
        animationDuration: "0.2s",
        label: "menu",
        startingTransform: "matrix(1, 0, 0, 1, 456, 0)",
        transitionDelay: "0s",
        transitionDuration: "150ms",
      },
    ],
  });
  assert.ok(errors.some((error) => error.includes("media query")));
  assert.ok(errors.some((error) => error.includes("menu animation")));
  assert.ok(errors.some((error) => error.includes("menu transition")));
  assert.ok(errors.some((error) => error.includes("menu starting transform")));
});

test("request classification allows only same-origin or embedded resources", async () => {
  const { classifyBrowserResource } = await loadRunner();
  const origin = "http://127.0.0.1:4312";
  assert.deepEqual(
    classifyBrowserResource(
      "http://127.0.0.1:4312/_next/static/chunk.js",
      origin,
    ),
    { allowed: true, reason: "same-origin" },
  );
  assert.deepEqual(
    classifyBrowserResource("data:image/svg+xml;base64,PHN2Zy8+", origin),
    { allowed: true, reason: "embedded" },
  );
  assert.equal(
    classifyBrowserResource("https://cdn.example.invalid/font.woff2", origin)
      .allowed,
    false,
  );
  const credentialedUrl = new globalThis.URL(origin);
  credentialedUrl.username = "fixture-user";
  credentialedUrl.password = "fixture-password";
  credentialedUrl.pathname = "/a";
  assert.deepEqual(classifyBrowserResource(credentialedUrl.href, origin), {
    allowed: false,
    reason: "embedded-credentials",
  });
});

test("overlay focus classification permits only popup focus or its transient inside guard", async () => {
  const { classifyOverlayFocus } = await loadRunner();

  assert.equal(
    classifyOverlayFocus({
      baseUiFocusGuard: false,
      focusGuardType: null,
      popupContainsActive: true,
    }),
    "inside",
  );
  assert.equal(
    classifyOverlayFocus({
      baseUiFocusGuard: true,
      focusGuardType: "inside",
      popupContainsActive: false,
    }),
    "transient-inside-guard",
  );
  for (const state of [
    {
      baseUiFocusGuard: false,
      focusGuardType: null,
      popupContainsActive: false,
    },
    {
      baseUiFocusGuard: true,
      focusGuardType: "outside",
      popupContainsActive: false,
    },
  ]) {
    assert.equal(classifyOverlayFocus(state), "outside");
  }
});

function validNativeMeasurement({ dpr, innerHeight, innerWidth }) {
  return {
    devicePixelRatio: dpr,
    innerHeight,
    innerWidth,
    outerHeight: 900,
    outerWidth: 1600,
    visualViewport: { height: innerHeight, scale: 1, width: innerWidth },
  };
}

function zeroMotionStyle(label) {
  return {
    animationDelay: "0s",
    animationDuration: "0s",
    label,
    startingTransform: "none",
    transitionDelay: "0s",
    transitionDuration: "0s",
  };
}

function validScrollLock() {
  return {
    afterScrollY: 100,
    bodyOverflow: "hidden",
    delta: 600,
    documentOverflow: "visible",
    maxScroll: 1_000,
    scrollY: 100,
    styleLocked: true,
  };
}

function validScrollRelease() {
  return {
    attributeRemoved: true,
    bodyOverflow: "visible",
    documentOverflow: "visible",
    released: true,
  };
}

function validMenuCheck() {
  return {
    arrowNavigation: ["Comfortable", "Compact", "System", "Comfortable"],
    disabledActivationBlocked: true,
    disabledAria: true,
    disabledFocusable: true,
    escapeRestoredFocus: true,
    homeEnd: true,
    passed: true,
    scrollLock: validScrollLock(),
    scrollReleased: validScrollRelease(),
    typeahead: "Compact",
  };
}

function validDiagnostics() {
  return {
    console: [],
    externalResources: [],
    httpErrors: [],
    pageErrors: [],
    requestFailures: [],
  };
}

function validMetrics(width, height, surfaces = []) {
  return {
    clippedText: [],
    controls: [{ height: 48, label: "control", width: 48 }],
    document: {
      bodyScrollWidth: width,
      clientWidth: width,
      scrollWidth: width,
    },
    fontsStatus: "loaded",
    replacementGlyphs: 0,
    surfaces,
    viewportHeight: height,
    viewportWidth: width,
  };
}

function validNativeScreenshot(path) {
  return {
    bytes: 1_024,
    captureMethod: "CDP Page.captureScreenshot",
    localeMarker: {
      changedFromHidden: true,
      height: 20,
      text: "pt",
      width: 20,
      x: 1_380,
      y: 0,
    },
    path,
    pixelHeight: 800,
    pixelWidth: 1_400,
    sha256: "b".repeat(64),
  };
}

function validOverlayCheck(closeMethod) {
  return {
    backwardTrap: true,
    closeMethod,
    escapeRestoredFocus: true,
    focusableCount: 2,
    forwardTrap: true,
    passed: true,
    scrollLock: validScrollLock(),
    scrollReleasedAfterEscape: validScrollRelease(),
    scrollReleasedAfterSecondaryClose: validScrollRelease(),
    secondaryCloseRestoredFocus: true,
  };
}

function validRtlCheck() {
  return {
    direction: "rtl",
    drawer: {
      dataSide: "inline-end",
      direction: "rtl",
      edgeGap: 0,
      escapeRestoredFocus: true,
      focusInside: true,
      focusVisible: true,
      inlineEndPhysicalSide: "left",
      left: 0,
      metrics: validMetrics(1_440, 900, [
        {
          bottom: 900,
          clientHeight: 900,
          label: "fs-drawer__popup",
          left: 0,
          overflowY: "auto",
          right: 450,
          scrollHeight: 900,
          top: 0,
          viewportHeight: 900,
          viewportWidth: 1_440,
        },
      ]),
      oppositeGap: 990,
      right: 450,
      scrollLock: validScrollLock(),
      scrollReleased: validScrollRelease(),
      viewportWidth: 1_440,
      width: 450,
    },
    menu: {
      activeHighlighted: true,
      activeItemDirection: "rtl",
      activeItemMoved: true,
      alignmentDelta: 0,
      copyCenterX: 1_200,
      direction: "rtl",
      escapeRestoredFocus: true,
      focusInside: true,
      focusVisible: true,
      highlightInsetInlineStart: "0px",
      highlightLeft: "376px",
      highlightLogicalRail: true,
      highlightPhysicalSide: "right",
      highlightRight: "0px",
      indicatorCenterX: 1_370,
      indicatorCount: 3,
      indicatorPhysicalSide: "right",
      indicatorInlineStart: true,
      itemCount: 3,
      metrics: validMetrics(1_440, 900, [
        {
          bottom: 500,
          clientHeight: 200,
          label: "fs-menu__popup",
          left: 1_000,
          overflowY: "auto",
          right: 1_400,
          scrollHeight: 200,
          top: 300,
          viewportHeight: 900,
          viewportWidth: 1_440,
        },
      ]),
      popupStartAligned: true,
      popupRight: 1_400,
      scrollLock: validScrollLock(),
      scrollReleased: validScrollRelease(),
      selectedIndicatorVisible: true,
      uncheckedIndicatorCount: 2,
      uncheckedIndicatorsHidden: true,
      triggerRight: 1_400,
    },
    passed: true,
  };
}

async function createValidEvidence() {
  const { createInteractionScenarioMatrix } = await loadRunner();
  const matrix = createInteractionScenarioMatrix();
  const axeSummaries = matrix.flatMap((scenario) =>
    scenario.axe.map(({ id, state }) => ({
      artifact: `axe-results/${id}.json`,
      blocking: [],
      counts: { inapplicable: 4, incomplete: 0, passes: 12, violations: 0 },
      id,
      scenarioId: scenario.id,
      state,
    })),
  );
  const scenarioResults = matrix.map((scenario) => ({
    checks:
      scenario.id === "interaction-390x844-en-to-ja"
        ? {
            dialog: validOverlayCheck("outside"),
            drawer: validOverlayCheck("button"),
            localeRegion: {
              businessRequests: 0,
              passed: true,
              preservedOpaqueQuery: true,
              preservedTransactionContext: true,
            },
            menu: validMenuCheck(),
            toast: {
              announcementMutationCount: 0,
              countAfterStableIdUpsert: 1,
              focusStayedOnTrigger: true,
              keyboardManualDismissed: true,
              limitedAfterLimit: 1,
              live: "polite",
              passed: true,
              role: "dialog",
              timeoutDismissed: true,
              totalAfterLimit: 4,
              visibleAfterLimit: 3,
            },
          }
        : scenario.id === "touch-menu-390x844-en"
          ? {
              touchMenu: {
                closeRestoredFocus: true,
                passed: true,
                scrollReleased: validScrollRelease(),
                touch: { afterScrollY: 100, beforeScrollY: 100 },
                wheel: validScrollLock(),
              },
            }
          : scenario.id === "viewport-1440x900-ja"
            ? {
                drawerOutside: {
                  passed: true,
                  scrollLock: validScrollLock(),
                  scrollReleased: validScrollRelease(),
                },
              }
            : scenario.id === "viewport-768x1024-th"
              ? {
                  portalLanguage: { inheritedLanguage: "th", passed: true },
                }
              : scenario.id === "rtl-1440x900-en"
                ? { rtl: validRtlCheck() }
                : scenario.reducedMotion
                  ? {
                      reducedMotion: {
                        matches: true,
                        passed: true,
                        styles: [
                          zeroMotionStyle("dialog"),
                          zeroMotionStyle("drawer"),
                          zeroMotionStyle("menu"),
                          zeroMotionStyle("toast"),
                        ],
                      },
                    }
                  : {},
    diagnostics: validDiagnostics(),
    documentLanguage:
      scenario.id === "interaction-390x844-en-to-ja" ? "ja" : scenario.locale,
    documentDirection: scenario.direction ?? "",
    errors: [],
    fixtureUrl: `http://127.0.0.1:4312/_internal/design-foundations/${encodeURIComponent(scenario.locale)}/interactions`,
    id: scenario.id,
    locale: scenario.locale,
    metrics: validMetrics(scenario.viewport.width, scenario.viewport.height),
    reducedMotion: scenario.reducedMotion === true,
    screenshot: scenario.screenshot,
    viewport: scenario.viewport,
  }));

  const nativePaths = [
    "zoom/google-chrome-baseline-pt.png",
    "zoom/google-chrome-200-percent-pt.png",
  ];
  const nativeScreenshots = nativePaths.map(validNativeScreenshot);
  return {
    axeSummaries,
    generatedAt: "2026-09-04T09:00:00.000Z",
    git: { dirty: false, rechecked: true, sha: "a".repeat(40), status: [] },
    launch: {
      browserChannel: "chrome",
      browserEngine: "chromium",
      headless: true,
      nativeZoomHeaded: true,
      nativeZoomProfile: "isolated temporary profile",
      productionBuild: true,
      server: "Next.js standalone",
    },
    matrix,
    nativeZoom: {
      baseline: {
        ...validNativeMeasurement({
          dpr: 1,
          innerHeight: 800,
          innerWidth: 1400,
        }),
        checks: {},
        diagnostics: validDiagnostics(),
        fixtureUrl:
          "http://127.0.0.1:4312/_internal/design-foundations/pt/interactions",
        metrics: validMetrics(1_400, 800),
        screenshot: nativePaths[0],
        screenshotEvidence: nativeScreenshots[0],
      },
      browser: "Google Chrome 140.0.0.0",
      detectedPercent: 200,
      method:
        "Chrome HostZoomMap default zoom preference loaded from an isolated temporary profile; no device-metrics, page-scale, or viewport emulation",
      preference: {
        baselineZoomLevel: 0,
        zoomLevel: Math.log(2) / Math.log(1.2),
      },
      profileRemoved: true,
      screenshots: nativeScreenshots,
      zoomPercent: 200,
      zoomed: {
        ...validNativeMeasurement({
          dpr: 2,
          innerHeight: 400,
          innerWidth: 700,
        }),
        checks: {
          dialog: validOverlayCheck("outside"),
          languageMenu: {
            itemCount: 7,
            metrics: validMetrics(700, 400, [
              {
                bottom: 390,
                clientHeight: 300,
                label: "fs-menu__popup",
                left: 20,
                overflowY: "auto",
                right: 300,
                scrollHeight: 350,
                top: 20,
                viewportHeight: 400,
                viewportWidth: 700,
              },
            ]),
            passed: true,
          },
          menu: validMenuCheck(),
        },
        diagnostics: validDiagnostics(),
        fixtureUrl:
          "http://127.0.0.1:4312/_internal/design-foundations/pt/interactions",
        metrics: validMetrics(700, 400),
        screenshot: nativePaths[1],
        screenshotEvidence: nativeScreenshots[1],
      },
    },
    result: "passed",
    runtimeGates: [
      ...["preview", "staging", "production"].map((environment, index) => ({
        environment,
        fixtures: ["en", "en-XA", "es", "ja", "pt", "th", "vi", "zh-CN"].map(
          (locale) => ({
            containsFixtureMarker: environment === "preview",
            locale,
            status: environment === "preview" ? 200 : 404,
          }),
        ),
        fixtureStatus: environment === "preview" ? 200 : 404,
        healthStatus: 200,
        origin: `http://127.0.0.1:${String(4_312 + index)}`,
      })),
    ],
    scenarioResults,
    schemaVersion: 1,
    screenshots: [
      ...matrix.map(({ screenshot }) => ({
        path: screenshot,
        sha256: "b".repeat(64),
      })),
      ...nativeScreenshots,
    ],
    versions: {
      axe: "4.13.0",
      browser: "Google Chrome 140.0.0.0",
      next: "16.3.4",
      node: "v24.20.0",
      playwright: "1.62.1",
      pnpm: "11.25.0",
      react: "19.2.8",
    },
  };
}

test("evidence validator accepts a complete proof and rejects tampering", async () => {
  const { validateEvidenceBundle } = await loadRunner();
  const valid = await createValidEvidence();
  assert.deepEqual(validateEvidenceBundle(valid), []);

  const missingScreenshot = globalThis.structuredClone(valid);
  missingScreenshot.screenshots.pop();
  assert.ok(
    validateEvidenceBundle(missingScreenshot).some((error) =>
      error.includes("screenshot set"),
    ),
  );

  const leakedScenarioQuery = globalThis.structuredClone(valid);
  leakedScenarioQuery.scenarioResults[0].fixtureUrl += "?note=must-not-persist";
  assert.ok(
    validateEvidenceBundle(leakedScenarioQuery).some((error) =>
      error.includes("metadata does not match matrix"),
    ),
  );

  const externalScenarioOrigin = globalThis.structuredClone(valid);
  externalScenarioOrigin.scenarioResults[0].fixtureUrl =
    "https://evil.example/_internal/design-foundations/en/interactions";
  assert.ok(
    validateEvidenceBundle(externalScenarioOrigin).some((error) =>
      error.includes("metadata does not match matrix"),
    ),
  );

  const stringDetectedZoom = globalThis.structuredClone(valid);
  stringDetectedZoom.nativeZoom.detectedPercent = "200";
  assert.ok(
    validateEvidenceBundle(stringDetectedZoom).some((error) =>
      error.includes("detected percent"),
    ),
  );

  const emulatedNativeZoom = globalThis.structuredClone(valid);
  emulatedNativeZoom.nativeZoom.method =
    "CDP Emulation.setDeviceMetricsOverride";
  delete emulatedNativeZoom.nativeZoom.preference;
  assert.ok(
    validateEvidenceBundle(emulatedNativeZoom).some((error) =>
      error.includes("HostZoomMap preference"),
    ),
  );

  const stringNativeMeasurement = globalThis.structuredClone(valid);
  stringNativeMeasurement.nativeZoom.baseline.innerWidth = "1400";
  assert.ok(
    validateEvidenceBundle(stringNativeMeasurement).some((error) =>
      error.includes("native zoom measurement values"),
    ),
  );

  const openProduction = globalThis.structuredClone(valid);
  openProduction.runtimeGates[2].fixtureStatus = 200;
  assert.ok(
    validateEvidenceBundle(openProduction).some((error) =>
      error.includes("production fixture must return 404"),
    ),
  );

  const leakedLocale = globalThis.structuredClone(valid);
  leakedLocale.runtimeGates[1].fixtures.find(
    ({ locale }) => locale === "zh-CN",
  ).containsFixtureMarker = true;
  assert.ok(
    validateEvidenceBundle(leakedLocale).some((error) =>
      error.includes("staging locale zh-CN"),
    ),
  );

  const failedFocusProof = globalThis.structuredClone(valid);
  failedFocusProof.scenarioResults.find(
    ({ id }) => id === "interaction-390x844-en-to-ja",
  ).checks.dialog.passed = false;
  assert.ok(
    validateEvidenceBundle(failedFocusProof).some((error) =>
      error.includes("dialog interaction proof"),
    ),
  );

  const failedToastLimit = globalThis.structuredClone(valid);
  failedToastLimit.scenarioResults.find(
    ({ id }) => id === "interaction-390x844-en-to-ja",
  ).checks.toast.visibleAfterLimit = 4;
  assert.ok(
    validateEvidenceBundle(failedToastLimit).some((error) =>
      error.includes("Toast limit proof"),
    ),
  );

  const forgedDialogScrollLock = globalThis.structuredClone(valid);
  forgedDialogScrollLock.scenarioResults.find(
    ({ id }) => id === "interaction-390x844-en-to-ja",
  ).checks.dialog.scrollLock.afterScrollY = 700;
  assert.ok(
    validateEvidenceBundle(forgedDialogScrollLock).some((error) =>
      error.includes("Dialog focus and scroll lifecycle"),
    ),
  );

  const missingDialogFocusTraversal = globalThis.structuredClone(valid);
  const dialogWithoutFocusTraversal =
    missingDialogFocusTraversal.scenarioResults.find(
      ({ id }) => id === "interaction-390x844-en-to-ja",
    ).checks.dialog;
  dialogWithoutFocusTraversal.focusableCount = 0;
  delete dialogWithoutFocusTraversal.backwardTrap;
  assert.ok(
    validateEvidenceBundle(missingDialogFocusTraversal).some((error) =>
      error.includes("Dialog focus and scroll lifecycle"),
    ),
  );

  const missingMenuNavigation = globalThis.structuredClone(valid);
  delete missingMenuNavigation.scenarioResults.find(
    ({ id }) => id === "interaction-390x844-en-to-ja",
  ).checks.menu.homeEnd;
  assert.ok(
    validateEvidenceBundle(missingMenuNavigation).some((error) =>
      error.includes("Menu keyboard and scroll lifecycle"),
    ),
  );

  const movingTouchPage = globalThis.structuredClone(valid);
  movingTouchPage.scenarioResults.find(
    ({ id }) => id === "touch-menu-390x844-en",
  ).checks.touchMenu.touch.afterScrollY = 300;
  assert.ok(
    validateEvidenceBundle(movingTouchPage).some((error) =>
      error.includes("touch Menu close lifecycle"),
    ),
  );

  const missingToastLifecycle = globalThis.structuredClone(valid);
  delete missingToastLifecycle.scenarioResults.find(
    ({ id }) => id === "interaction-390x844-en-to-ja",
  ).checks.toast.timeoutDismissed;
  assert.ok(
    validateEvidenceBundle(missingToastLifecycle).some((error) =>
      error.includes("Toast lifecycle proof"),
    ),
  );

  const failedDrawerOutside = globalThis.structuredClone(valid);
  failedDrawerOutside.scenarioResults.find(
    ({ id }) => id === "viewport-1440x900-ja",
  ).checks.drawerOutside.passed = false;
  assert.ok(
    validateEvidenceBundle(failedDrawerOutside).some((error) =>
      error.includes("desktop Drawer outside-dismissal proof"),
    ),
  );

  const wrongAxeState = globalThis.structuredClone(valid);
  wrongAxeState.axeSummaries[0].state = "toast";
  assert.ok(
    validateEvidenceBundle(wrongAxeState).some((error) =>
      error.includes("axe scan"),
    ),
  );

  const missingMeasurementInventory = globalThis.structuredClone(valid);
  delete missingMeasurementInventory.scenarioResults[0].metrics.surfaces;
  assert.ok(
    validateEvidenceBundle(missingMeasurementInventory).some((error) =>
      error.includes("measurement inventory"),
    ),
  );

  const forgedScenarioDocumentViewport = globalThis.structuredClone(valid);
  forgedScenarioDocumentViewport.scenarioResults[0].metrics.document = {
    bodyScrollWidth: 500,
    clientWidth: 500,
    scrollWidth: 500,
  };
  assert.ok(
    validateEvidenceBundle(forgedScenarioDocumentViewport).some((error) =>
      error.includes("document viewport is inconsistent"),
    ),
  );

  const incompleteReducedMotion = globalThis.structuredClone(valid);
  incompleteReducedMotion.scenarioResults
    .find(({ id }) => id === "reduced-motion-390x844-en")
    .checks.reducedMotion.styles.pop();
  assert.ok(
    validateEvidenceBundle(incompleteReducedMotion).some((error) =>
      error.includes("all interaction surfaces"),
    ),
  );

  const movingReducedDrawer = globalThis.structuredClone(valid);
  movingReducedDrawer.scenarioResults
    .find(({ id }) => id === "reduced-motion-390x844-en")
    .checks.reducedMotion.styles.find(
      ({ label }) => label === "drawer",
    ).startingTransform = "matrix(1, 0, 0, 1, 456, 0)";
  assert.ok(
    validateEvidenceBundle(movingReducedDrawer).some((error) =>
      error.includes("reduced motion proof"),
    ),
  );

  const missingZoomLanguageMenu = globalThis.structuredClone(valid);
  delete missingZoomLanguageMenu.nativeZoom.zoomed.checks.languageMenu;
  assert.ok(
    validateEvidenceBundle(missingZoomLanguageMenu).some((error) =>
      error.includes("native zoom Language menu proof"),
    ),
  );

  const missingNativeDialog = globalThis.structuredClone(valid);
  delete missingNativeDialog.nativeZoom.zoomed.checks.dialog;
  assert.ok(
    validateEvidenceBundle(missingNativeDialog).some((error) =>
      error.includes("native zoom Dialog lifecycle"),
    ),
  );

  const missingNativeMenu = globalThis.structuredClone(valid);
  delete missingNativeMenu.nativeZoom.zoomed.checks.menu.arrowNavigation;
  assert.ok(
    validateEvidenceBundle(missingNativeMenu).some((error) =>
      error.includes("native zoom Menu lifecycle"),
    ),
  );

  const forgedNativeDocumentViewport = globalThis.structuredClone(valid);
  forgedNativeDocumentViewport.nativeZoom.zoomed.metrics.document = {
    bodyScrollWidth: 800,
    clientWidth: 800,
    scrollWidth: 800,
  };
  assert.ok(
    validateEvidenceBundle(forgedNativeDocumentViewport).some((error) =>
      error.includes("native zoom metrics zoomed use an inconsistent viewport"),
    ),
  );

  const nativeDiagnosticFailure = globalThis.structuredClone(valid);
  nativeDiagnosticFailure.nativeZoom.baseline.diagnostics.pageErrors.push(
    "late screenshot failure",
  );
  assert.ok(
    validateEvidenceBundle(nativeDiagnosticFailure).some((error) =>
      error.includes("native zoom diagnostics"),
    ),
  );

  const nativeScreenshotMismatch = globalThis.structuredClone(valid);
  nativeScreenshotMismatch.nativeZoom.zoomed.screenshotEvidence = {
    ...nativeScreenshotMismatch.nativeZoom.zoomed.screenshotEvidence,
    sha256: "c".repeat(64),
  };
  assert.ok(
    validateEvidenceBundle(nativeScreenshotMismatch).some((error) =>
      error.includes("native zoom screenshot binding"),
    ),
  );

  const invalidNativeFixture = globalThis.structuredClone(valid);
  invalidNativeFixture.nativeZoom.zoomed.fixtureUrl =
    "http://127.0.0.1:4312/_internal/design-foundations/en/interactions";
  assert.ok(
    validateEvidenceBundle(invalidNativeFixture).some((error) =>
      error.includes("native zoom fixture"),
    ),
  );

  const externalNativeOrigin = globalThis.structuredClone(valid);
  externalNativeOrigin.nativeZoom.baseline.fixtureUrl =
    "https://evil.example/_internal/design-foundations/pt/interactions";
  assert.ok(
    validateEvidenceBundle(externalNativeOrigin).some((error) =>
      error.includes("native zoom fixture"),
    ),
  );

  const relativeNativeFixture = globalThis.structuredClone(valid);
  relativeNativeFixture.nativeZoom.baseline.fixtureUrl =
    "/_internal/design-foundations/pt/interactions";
  assert.ok(
    validateEvidenceBundle(relativeNativeFixture).some((error) =>
      error.includes("native zoom fixture"),
    ),
  );

  const brokenRtl = globalThis.structuredClone(valid);
  brokenRtl.scenarioResults.find(
    ({ id }) => id === "rtl-1440x900-en",
  ).checks.rtl.menu.indicatorPhysicalSide = "left";
  assert.ok(
    validateEvidenceBundle(brokenRtl).some((error) =>
      error.includes("RTL interaction proof"),
    ),
  );

  const forgedRtlGeometry = globalThis.structuredClone(valid);
  forgedRtlGeometry.scenarioResults.find(
    ({ id }) => id === "rtl-1440x900-en",
  ).checks.rtl.drawer.edgeGap = 24;
  assert.ok(
    validateEvidenceBundle(forgedRtlGeometry).some((error) =>
      error.includes("RTL interaction proof"),
    ),
  );

  const untypedRtlGeometry = globalThis.structuredClone(valid);
  untypedRtlGeometry.scenarioResults.find(
    ({ id }) => id === "rtl-1440x900-en",
  ).checks.rtl.drawer.edgeGap = null;
  assert.ok(
    validateEvidenceBundle(untypedRtlGeometry).some((error) =>
      error.includes("RTL interaction proof"),
    ),
  );

  const contradictoryRtlRect = globalThis.structuredClone(valid);
  const contradictoryDrawer = contradictoryRtlRect.scenarioResults.find(
    ({ id }) => id === "rtl-1440x900-en",
  ).checks.rtl.drawer;
  contradictoryDrawer.left = 500;
  contradictoryDrawer.right = 950;
  assert.ok(
    validateEvidenceBundle(contradictoryRtlRect).some((error) =>
      error.includes("RTL interaction proof"),
    ),
  );

  const spoofedRtlViewport = globalThis.structuredClone(valid);
  const spoofedSurface = spoofedRtlViewport.scenarioResults.find(
    ({ id }) => id === "rtl-1440x900-en",
  ).checks.rtl.drawer.metrics.surfaces[0];
  spoofedSurface.bottom = 1_200;
  spoofedSurface.viewportHeight = 1_200;
  assert.ok(
    validateEvidenceBundle(spoofedRtlViewport).some((error) =>
      error.includes("RTL interaction proof"),
    ),
  );

  const visibleUncheckedIndicator = globalThis.structuredClone(valid);
  visibleUncheckedIndicator.scenarioResults.find(
    ({ id }) => id === "rtl-1440x900-en",
  ).checks.rtl.menu.uncheckedIndicatorsHidden = false;
  assert.ok(
    validateEvidenceBundle(visibleUncheckedIndicator).some((error) =>
      error.includes("RTL interaction proof"),
    ),
  );

  const externalRequest = globalThis.structuredClone(valid);
  externalRequest.scenarioResults[0].diagnostics.externalResources.push({
    reason: "external-origin",
    url: "https://cdn.example.invalid/a.js",
  });
  assert.ok(
    validateEvidenceBundle(externalRequest).some((error) =>
      error.includes("browser diagnostics"),
    ),
  );

  const persistedRequestUrls = globalThis.structuredClone(valid);
  persistedRequestUrls.scenarioResults[0].diagnostics.requests = [
    { url: "http://127.0.0.1:4312/private?note=must-not-persist" },
  ];
  assert.ok(
    validateEvidenceBundle(persistedRequestUrls).some((error) =>
      error.includes("must not persist request URLs"),
    ),
  );

  const dirtyCheckout = globalThis.structuredClone(valid);
  dirtyCheckout.git.dirty = true;
  dirtyCheckout.git.status = [" M packages/ui/src/menu.tsx"];
  assert.ok(
    validateEvidenceBundle(dirtyCheckout).some((error) =>
      error.includes("clean committed checkout"),
    ),
  );

  const uncheckedProvenance = globalThis.structuredClone(valid);
  uncheckedProvenance.git.rechecked = false;
  assert.ok(
    validateEvidenceBundle(uncheckedProvenance).some((error) =>
      error.includes("git provenance is incomplete"),
    ),
  );

  const staleVersion = globalThis.structuredClone(valid);
  staleVersion.versions.playwright = "1.61.1";
  assert.ok(
    validateEvidenceBundle(staleVersion).some((error) =>
      error.includes("toolchain versions"),
    ),
  );

  const emulatedBuild = globalThis.structuredClone(valid);
  emulatedBuild.launch.productionBuild = false;
  assert.ok(
    validateEvidenceBundle(emulatedBuild).some((error) =>
      error.includes("launch provenance"),
    ),
  );

  const invalidTimestamp = globalThis.structuredClone(valid);
  invalidTimestamp.generatedAt = "September 4";
  assert.ok(
    validateEvidenceBundle(invalidTimestamp).some((error) =>
      error.includes("generatedAt"),
    ),
  );
});

test("README clearly scopes the production-build evidence", async () => {
  const { createEvidenceReadme } = await loadRunner();
  const evidence = await createValidEvidence();
  const readme = createEvidenceReadme(evidence);
  assert.match(readme, /^# P2-03 UI interaction browser verification/mu);
  assert.match(readme, /preview: fixture 200, healthz 200/u);
  assert.match(readme, /production: fixture 404, healthz 200/u);
  assert.match(readme, /all 8 preview locales/u);
  assert.match(readme, /clean checkout rechecked after run: true/u);
  assert.match(readme, /200%/u);
  assert.match(readme, /not staging or production deployment evidence/u);
});
