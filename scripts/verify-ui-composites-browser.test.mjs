/* global structuredClone */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

async function loadRunner() {
  let loaded;
  try {
    loaded = await import("./verify-ui-composites-browser.mjs");
  } catch {
    loaded = undefined;
  }
  for (const exportName of [
    "assessCompositeMetrics",
    "assessCompositeEvidenceShape",
    "assessCurrentCompositeEvidence",
    "assessReducedMotion",
    "classifyTextClipping",
    "collectCompositeSourceFingerprint",
    "createCompositeScenarioMatrix",
    "createEvidenceReadme",
    "normalizeWorkspaceStatus",
    "settleDeferredImages",
    "validateCompositeScenarioMatrix",
  ]) {
    assert.equal(
      typeof loaded?.[exportName],
      "function",
      `${exportName} must be exported by the composite browser runner`,
    );
  }
  return loaded;
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

function validCompositeMetrics(width) {
  const heroRatio = width < 768 ? 4 / 5 : 16 / 9;
  return {
    base: {
      clippedText: [],
      controls: [{ height: 48, label: "Choose gift", width: 120 }],
      document: {
        bodyScrollWidth: width,
        clientWidth: width,
        scrollWidth: width,
      },
      fontsStatus: "loaded",
      replacementGlyphs: 0,
    },
    cartLineMedia: {
      gift: { bottom: 80, height: 80, left: 0, right: 80, top: 0, width: 80 },
      idol: { bottom: 88, height: 40, left: 48, right: 88, top: 48, width: 40 },
    },
    componentCounts: {
      "cart-line": 5,
      "gift-tile": 5,
      hero: 6,
      "idol-context": 5,
      "idol-portrait": 5,
      "order-timeline": 4,
    },
    heroAction: {
      background: "rgb(216, 178, 110)",
      foreground: "rgb(7, 8, 10)",
      text: "Choose a support gift",
    },
    heroCurrentSrc: width < 768 ? "hero-mobile.png" : "hero-desktop.png",
    heroFailureOverlap: false,
    heroFailureStability: {
      afterAnchorTop: 520,
      afterDocumentHeight: 2_000,
      afterHeight: 450,
      afterLeft: 0,
      afterTop: 70,
      afterWidth: 360,
      beforeAnchorTop: 520,
      beforeDocumentHeight: 2_000,
      beforeHeight: 450,
      beforeLeft: 0,
      beforeTop: 70,
      beforeWidth: 360,
      browserDecodeFailed: true,
      initialSrc: "http://127.0.0.1/hero-mobile.png",
      requestedSrc: "data:image/png;base64,AA==",
      sourceChanged: true,
    },
    heroTransitionStability: {
      afterAnchorTop: 590,
      afterDocumentHeight: 2_100,
      afterHeight: 512,
      afterLeft: 0,
      afterState: "ready",
      afterTop: 70,
      afterWidth: 360,
      beforeAnchorTop: 590,
      beforeDocumentHeight: 2_100,
      beforeHeight: 512,
      beforeLeft: 0,
      beforeState: "loading",
      beforeTop: 70,
      beforeWidth: 360,
    },
    heroMediaStyle: {
      borderBottomWidth: "0px",
      borderLeftWidth: "0px",
      borderRadius: "0px",
      borderRightWidth: "0px",
      borderTopWidth: "0px",
    },
    imageFailures: 5,
    privacyLeaks: 0,
    ratios: [
      { actual: heroRatio, expected: heroRatio, label: "hero" },
      { actual: 0.8, expected: 0.8, label: "portrait" },
      { actual: 1, expected: 1, label: "gift" },
      { actual: heroRatio, expected: heroRatio, label: "hero failure" },
    ],
    runtimeImageFailures: 5,
    states: { empty: 6, error: 6, loading: 6 },
    timeline: { currentCount: 1, itemCount: 3, ordered: true },
  };
}

function validCompositeChecks(entry) {
  const checks = {};
  if (entry.checks.includes("keyboard")) {
    checks.keyboard = {
      className: "fs-link fs-hero__action",
      outlineStyle: "solid",
      outlineWidth: "3px",
    };
  }
  if (entry.checks.includes("states")) {
    checks.states = { empty: 6, error: 6, loading: 6 };
  }
  if (entry.checks.includes("image-failure")) {
    checks.imageFailures = {
      count: 5,
      heroFallback: {
        background: "rgb(25, 25, 31)",
        foreground: "rgb(170, 166, 160)",
        overlap: false,
        text: "Featured performer unavailable",
      },
      origin: "runtime error/decode events",
    };
  }
  if (entry.checks.includes("privacy")) {
    checks.privacy = "no plaintext sentinel";
  }
  if (entry.checks.includes("semantics")) {
    checks.semantics = {
      quantity: {
        keyboard: {
          after: 3,
          before: 2,
          subtotalAfter: "38700",
          subtotalBefore: "25800",
        },
        touch: { after: 4, before: 3, subtotalAfter: "51600" },
      },
      remove: { keyboard: true, semanticTag: "BUTTON", touch: true },
      selectedCurrentCount: 1,
      timelineOrdered: true,
    };
  }
  if (entry.checks.includes("hover")) {
    checks.hover = {
      after: "rgb(246, 243, 238)",
      before: "rgb(216, 178, 110)",
    };
  }
  if (entry.checks.includes("rtl")) {
    checks.rtl = {
      clientWidth: entry.viewport.width,
      direction: "rtl",
      scrimBackground:
        entry.viewport.width >= 768
          ? "linear-gradient(to left, black, transparent)"
          : "none",
      scrollWidth: entry.viewport.width,
    };
  }
  if (entry.checks.includes("pseudo-copy")) {
    checks.pseudoCopy = { englishLeaks: [], expected: 11, present: 11 };
  }
  if (entry.reducedMotion === true) {
    checks.reducedMotion = {
      linkTransitionDuration: "0s",
      mediaQuery: true,
      mediaTransitionDuration: "0s",
      scrollBehavior: "auto",
    };
  }
  return checks;
}

function validCompositeScenario(entry) {
  const fixtureUrl = `/_internal/design-foundations/${encodeURIComponent(entry.locale)}/components`;
  return {
    checks: validCompositeChecks(entry),
    diagnostics: {
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
    },
    errors: [],
    fixtureUrl,
    group: entry.group,
    id: entry.id,
    locale: entry.locale,
    metrics: validCompositeMetrics(entry.viewport.width),
    reducedMotion: entry.reducedMotion === true,
    screenshot: entry.screenshot,
    touch: entry.touch === true,
    viewport: entry.viewport,
  };
}

test("keeps the composite source fingerprint stable across Git state", async (context) => {
  const { collectCompositeSourceFingerprint } = await loadRunner();
  const root = await mkdtemp(path.join(os.tmpdir(), "p2-04-fingerprint-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "packages/ui/src"), { recursive: true });
  await mkdir(path.join(root, "packages/domain"), { recursive: true });
  await mkdir(
    path.join(root, "apps/storefront/postcss-font-display-optional"),
    { recursive: true },
  );
  await mkdir(path.join(root, "output/playwright/p2-04"), { recursive: true });
  await writeFile(path.join(root, "packages/ui/src/hero.tsx"), "hero-v1\n");
  await writeFile(
    path.join(root, "apps/storefront/postcss-font-display-optional/index.cjs"),
    "policy-v1\n",
  );
  await writeFile(path.join(root, "packages/domain/index.ts"), "domain-v1\n");
  await writeFile(
    path.join(root, "output/playwright/p2-04/README.md"),
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

  const initial = await collectCompositeSourceFingerprint(root);
  await writeFile(
    path.join(root, "output/playwright/p2-04/README.md"),
    "evidence-v2\n",
  );
  await writeFile(path.join(root, "packages/domain/index.ts"), "domain-v2\n");
  assert.deepEqual(await collectCompositeSourceFingerprint(root), initial);

  await writeFile(
    path.join(root, "apps/storefront/postcss-font-display-optional/index.cjs"),
    "policy-v2\n",
  );
  const policyChanged = await collectCompositeSourceFingerprint(root);
  assert.notEqual(policyChanged.digest, initial.digest);

  await writeFile(path.join(root, "packages/ui/src/hero.tsx"), "hero-v2\n");
  const changed = await collectCompositeSourceFingerprint(root);
  assert.notEqual(changed.digest, policyChanged.digest);
  await runGit(root, ["add", "packages/ui/src/hero.tsx"]);
  await runGit(root, [
    "-c",
    "user.name=Codex Test",
    "-c",
    "user.email=codex@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "update",
  ]);
  assert.deepEqual(await collectCompositeSourceFingerprint(root), changed);
});

test("accepts P2-04 evidence shape and rejects a foreign scenario matrix", async () => {
  const { assessCompositeEvidenceShape, createCompositeScenarioMatrix } =
    await loadRunner();
  const matrix = structuredClone(createCompositeScenarioMatrix());
  const nativePaths = [
    "zoom/google-chrome-baseline-pt.png",
    "zoom/google-chrome-200-percent-pt.png",
  ];
  const screenshots = [
    ...matrix.map(({ screenshot }) => ({
      path: screenshot,
      sha256: "a".repeat(64),
    })),
    ...nativePaths.map((path) => ({ path, sha256: "b".repeat(64) })),
  ];
  const sourceFingerprintAlgorithm = "p2-04-render-inputs-v1";
  const sourceFingerprintFiles = [
    { path: "packages/ui/src/hero.tsx", sha256: "e".repeat(64) },
  ];
  const sourceFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        algorithm: sourceFingerprintAlgorithm,
        files: sourceFingerprintFiles,
      }),
    )
    .digest("hex");
  const evidence = {
    axeSummaries: matrix.flatMap(({ axe, id: scenarioId }) =>
      axe.map(({ id }) => ({
        artifact: `axe-results/${id}.json`,
        blocking: [],
        id,
        scenarioId,
      })),
    ),
    git: {
      after: {
        sha: "f".repeat(40),
        sourceFingerprint,
        sourceFingerprintAlgorithm,
        sourceFingerprintFiles,
        status: [],
      },
      before: {
        sha: "f".repeat(40),
        sourceFingerprint,
        sourceFingerprintAlgorithm,
        sourceFingerprintFiles,
        status: [],
      },
    },
    matrix,
    nativeZoom: {
      detectedPercent: 200,
      profileRemoved: true,
      screenshots: screenshots.slice(-2),
      zoomPercent: 200,
    },
    result: "passed",
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
    scenarioResults: matrix.map(validCompositeScenario),
    schemaVersion: 1,
    screenshots,
  };

  assert.deepEqual(assessCompositeEvidenceShape(evidence), []);
  const foreign = structuredClone(evidence);
  foreign.matrix[0].id = "p2-02-foreign-scenario";
  assert.ok(
    assessCompositeEvidenceShape(foreign).some((error) =>
      error.includes("exact P2-04 scenario matrix"),
    ),
  );
  const staleSource = structuredClone(evidence);
  staleSource.git.after.sourceFingerprint = "d".repeat(64);
  assert.ok(
    assessCompositeEvidenceShape(staleSource).some((error) =>
      error.includes("source fingerprint"),
    ),
  );
  const missingChecks = structuredClone(evidence);
  delete missingChecks.scenarioResults.find(
    ({ id }) => id === "states-390x844-en",
  ).checks.semantics;
  assert.ok(
    assessCompositeEvidenceShape(missingChecks).some((error) =>
      error.includes("scenario checks"),
    ),
  );
  const missingRatios = structuredClone(evidence);
  missingRatios.scenarioResults[0].metrics.ratios = [];
  assert.ok(
    assessCompositeEvidenceShape(missingRatios).some((error) =>
      error.includes("four expected media ratios"),
    ),
  );
  const wrongHeroSource = structuredClone(evidence);
  wrongHeroSource.scenarioResults[0].metrics.heroCurrentSrc =
    "hero-desktop.png";
  assert.ok(
    assessCompositeEvidenceShape(wrongHeroSource).some((error) =>
      error.includes("Hero art direction"),
    ),
  );
  const disallowedRequest = structuredClone(evidence);
  disallowedRequest.scenarioResults[0].diagnostics.requests.push({
    allowed: false,
    method: "GET",
    resourceType: "image",
    url: "https://external.example.invalid/image.png",
  });
  assert.ok(
    assessCompositeEvidenceShape(disallowedRequest).some((error) =>
      error.includes("allowed browser requests"),
    ),
  );
});

test("fails closed when persisted evidence does not match current render inputs", async () => {
  const { assessCurrentCompositeEvidence } = await loadRunner();
  const current = {
    algorithm: "p2-04-render-inputs-v1",
    digest: "a".repeat(64),
    files: [{ path: "packages/ui/src/hero.tsx", sha256: "b".repeat(64) }],
  };
  const evidence = {
    git: {
      after: {
        sourceFingerprint: current.digest,
        sourceFingerprintAlgorithm: current.algorithm,
        sourceFingerprintFiles: current.files,
      },
    },
  };

  assert.deepEqual(assessCurrentCompositeEvidence(evidence, current), []);
  assert.ok(
    assessCurrentCompositeEvidence(evidence, {
      ...current,
      digest: "c".repeat(64),
    }).some((error) => error.includes("rerun")),
  );
  assert.ok(
    assessCurrentCompositeEvidence(
      { git: { after: { sourceFingerprint: current.digest } } },
      current,
    ).some((error) => error.includes("algorithm")),
  );
});

test("ignores only transient candidate evidence in workspace snapshots", async () => {
  const { normalizeWorkspaceStatus } = await loadRunner();
  assert.deepEqual(
    normalizeWorkspaceStatus([
      " M packages/ui/src/hero.tsx",
      "?? output/playwright/.p2-04-candidate-AbCd/logs/build-ui.log",
      "?? output/playwright/p2-04/README.md",
    ]),
    [" M packages/ui/src/hero.tsx"],
  );
});

test("only reports text overflow when layout actually clips it", async () => {
  const { classifyTextClipping } = await loadRunner();
  const visibleOverflow = {
    clientHeight: 35,
    clientWidth: 328,
    overflowX: "visible",
    overflowY: "visible",
    rectLeft: 16,
    rectRight: 344,
    scrollHeight: 40,
    scrollWidth: 328,
    textOverflow: "clip",
    viewportWidth: 360,
    webkitLineClamp: "none",
  };

  assert.deepEqual(classifyTextClipping(visibleOverflow), []);
  assert.deepEqual(
    classifyTextClipping({ ...visibleOverflow, overflowY: "hidden" }),
    ["vertical-clip"],
  );
  assert.deepEqual(
    classifyTextClipping({ ...visibleOverflow, rectRight: 361 }),
    ["outside-horizontal-viewport"],
  );
});

test("settles deferred images even when React replaces a failed image before scrolling", async () => {
  const { settleDeferredImages } = await loadRunner();
  const calls = [];
  const images = ["p2-04-0", "p2-04-1", "p2-04-2"].map((id) => ({
    scrollIntoView() {
      calls.push(`scroll:${id}`);
    },
  }));
  const page = {
    locator(selector) {
      if (selector === "img") {
        return {
          async evaluateAll() {
            calls.push("assign");
            return images.map((_, index) => `p2-04-${String(index)}`);
          },
        };
      }
      if (selector === "[data-p2-04-image-id]") {
        return {
          async evaluateAll() {
            calls.push("cleanup");
          },
        };
      }
      assert.fail(`Unexpected locator: ${selector}`);
    },
    async evaluate(callback, imageId) {
      return runInNewContext(`(${callback.toString()})(imageId)`, {
        imageId,
        document: {
          querySelector(selector) {
            const match = /data-p2-04-image-id="(p2-04-\d+)"/u.exec(selector);
            assert.notEqual(match, null);
            // The middle image was replaced by its fallback after enumeration.
            return match[1] === "p2-04-1"
              ? null
              : images[Number(match[1].slice("p2-04-".length))];
          },
        },
      });
    },
    async waitForFunction(_callback, imageId) {
      calls.push(imageId === undefined ? "complete" : `wait:${imageId}`);
    },
  };

  await settleDeferredImages(page);

  assert.deepEqual(calls, [
    "assign",
    "scroll:p2-04-0",
    "wait:p2-04-0",
    "wait:p2-04-1",
    "scroll:p2-04-2",
    "wait:p2-04-2",
    "cleanup",
    "complete",
  ]);
});

test("defines the complete locale, state, interaction and motion matrix", async () => {
  const { createCompositeScenarioMatrix, validateCompositeScenarioMatrix } =
    await loadRunner();
  const matrix = createCompositeScenarioMatrix();

  assert.deepEqual(validateCompositeScenarioMatrix(matrix), []);
  assert.equal(matrix.length, 16);
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
  assert.deepEqual(
    matrix
      .filter(({ group }) => group === "stress")
      .map(({ locale, viewport }) => [viewport.width, locale]),
    [
      [320, "en-XA"],
      [320, "pt"],
    ],
  );
  assert.deepEqual(
    matrix
      .filter(({ group }) => group === "responsive-boundary")
      .map(({ locale, viewport }) => [viewport.width, viewport.height, locale]),
    [
      [767, 900, "pt"],
      [1023, 900, "en-XA"],
    ],
  );
  assert.deepEqual(matrix.find(({ locale }) => locale === "en-XA")?.checks, [
    "pseudo-copy",
  ]);
  assert.deepEqual(matrix.find(({ group }) => group === "states")?.checks, [
    "keyboard",
    "states",
    "image-failure",
    "privacy",
    "semantics",
  ]);
  assert.equal(matrix.find(({ group }) => group === "states")?.touch, true);
  assert.deepEqual(
    matrix
      .filter(({ group }) => group === "rtl")
      .map(({ viewport }) => viewport.width),
    [390, 1440],
  );
  assert.deepEqual(
    matrix
      .filter(({ reducedMotion }) => reducedMotion)
      .map(({ viewport }) => viewport.width),
    [390, 1440],
  );
  assert.deepEqual(
    matrix.flatMap(({ axe }) => axe.map(({ id }) => id)).sort(),
    [
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
    ],
  );
});

test("rejects duplicate, unsafe and incomplete scenarios", async () => {
  const { createCompositeScenarioMatrix, validateCompositeScenarioMatrix } =
    await loadRunner();
  const matrix = structuredClone(createCompositeScenarioMatrix());
  matrix[1].id = matrix[0].id;
  matrix[2].screenshot = "../outside.png";
  matrix.pop();
  const errors = validateCompositeScenarioMatrix(matrix);

  assert.ok(errors.some((error) => error.includes("duplicate scenario id")));
  assert.ok(errors.some((error) => error.includes("safe relative PNG")));
  assert.ok(errors.some((error) => error.includes("reduced motion")));
});

test("blocks overflow, clipping, missing semantics and unstable media ratios", async () => {
  const { assessCompositeMetrics } = await loadRunner();
  const healthy = {
    base: {
      clippedText: [],
      controls: [{ height: 48, label: "Choose gift", width: 120 }],
      document: { bodyScrollWidth: 390, clientWidth: 390, scrollWidth: 390 },
      fontsStatus: "loaded",
      replacementGlyphs: 0,
    },
    componentCounts: {
      "cart-line": 5,
      "gift-tile": 6,
      hero: 6,
      "idol-context": 5,
      "idol-portrait": 5,
      "order-timeline": 4,
    },
    cartLineMedia: {
      gift: { bottom: 80, height: 80, left: 0, right: 80, top: 0, width: 80 },
      idol: { bottom: 88, height: 40, left: 48, right: 88, top: 48, width: 40 },
    },
    imageFailures: 5,
    runtimeImageFailures: 5,
    heroAction: {
      background: "rgb(216, 178, 110)",
      foreground: "rgb(7, 8, 10)",
      text: "Choose a support gift",
    },
    heroFailureOverlap: false,
    heroFailureStability: {
      afterAnchorTop: 520,
      afterDocumentHeight: 2_000,
      afterHeight: 450,
      afterLeft: 0,
      afterTop: 70,
      afterWidth: 360,
      beforeAnchorTop: 520,
      beforeDocumentHeight: 2_000,
      beforeHeight: 450,
      beforeLeft: 0,
      beforeTop: 70,
      beforeWidth: 360,
      browserDecodeFailed: true,
      initialSrc: "http://127.0.0.1/hero-mobile.png",
      requestedSrc: "data:image/png;base64,AA==",
      sourceChanged: true,
    },
    heroTransitionStability: {
      afterAnchorTop: 590,
      afterDocumentHeight: 2_100,
      afterHeight: 512,
      afterLeft: 0,
      afterState: "ready",
      afterTop: 70,
      afterWidth: 360,
      beforeAnchorTop: 590,
      beforeDocumentHeight: 2_100,
      beforeHeight: 512,
      beforeLeft: 0,
      beforeState: "loading",
      beforeTop: 70,
      beforeWidth: 360,
    },
    heroMediaStyle: {
      borderBottomWidth: "0px",
      borderLeftWidth: "0px",
      borderRadius: "0px",
      borderRightWidth: "0px",
      borderTopWidth: "0px",
    },
    privacyLeaks: 0,
    ratios: [
      { actual: 0.8, expected: 0.8, label: "portrait" },
      { actual: 1, expected: 1, label: "gift" },
    ],
    timeline: { currentCount: 1, itemCount: 3, ordered: true },
  };
  assert.deepEqual(assessCompositeMetrics(healthy), []);

  const errors = assessCompositeMetrics({
    ...healthy,
    base: {
      ...healthy.base,
      clippedText: [{ reason: "vertical-clip", selector: ".heading" }],
      document: { bodyScrollWidth: 401, clientWidth: 390, scrollWidth: 401 },
    },
    componentCounts: { ...healthy.componentCounts, hero: 0 },
    cartLineMedia: {
      gift: { bottom: 80, height: 80, left: 0, right: 80, top: 0, width: 80 },
      idol: { bottom: 80, height: 80, left: 0, right: 80, top: 0, width: 80 },
    },
    imageFailures: 4,
    runtimeImageFailures: 4,
    heroAction: {
      background: "rgb(216, 178, 110)",
      foreground: "rgb(216, 178, 110)",
      text: "Choose a support gift",
    },
    heroFailureOverlap: true,
    heroFailureStability: {
      afterAnchorTop: 620,
      afterDocumentHeight: 2_100,
      afterHeight: 550,
      afterLeft: 10,
      afterTop: 80,
      afterWidth: 370,
      beforeAnchorTop: 520,
      beforeDocumentHeight: 2_000,
      beforeHeight: 450,
      beforeLeft: 0,
      beforeTop: 70,
      beforeWidth: 360,
      browserDecodeFailed: false,
      initialSrc: "http://127.0.0.1/hero-mobile.png",
      requestedSrc: "http://127.0.0.1/hero-mobile.png",
      sourceChanged: false,
    },
    heroTransitionStability: {
      afterAnchorTop: 590,
      afterDocumentHeight: 2_100,
      afterHeight: 512,
      afterLeft: 0,
      afterState: "loading",
      afterTop: 70,
      afterWidth: 360,
      beforeAnchorTop: 500,
      beforeDocumentHeight: 2_000,
      beforeHeight: 420,
      beforeLeft: 0,
      beforeState: "loading",
      beforeTop: 70,
      beforeWidth: 360,
    },
    heroMediaStyle: {
      borderBottomWidth: "1px",
      borderLeftWidth: "1px",
      borderRadius: "20px",
      borderRightWidth: "1px",
      borderTopWidth: "1px",
    },
    privacyLeaks: 1,
    ratios: [{ actual: 0.7, expected: 0.8, label: "portrait" }],
    timeline: { currentCount: 2, itemCount: 2, ordered: false },
  });
  for (const fragment of [
    "horizontal overflow",
    "clipped text",
    "missing hero",
    "five media fallbacks",
    "runtime failures",
    "private plaintext",
    "portrait ratio",
    "ordered list",
    "one current step",
    "Hero action contrast",
    "Hero loading-to-ready layout shift",
    "Hero failure layout shift",
    "Hero failure fallback",
    "Hero media frame",
    "CartLine media",
  ]) {
    assert.ok(
      errors.some((error) => error.includes(fragment)),
      fragment,
    );
  }
});

test("requires zero-duration composite motion under reduced motion", async () => {
  const { assessReducedMotion } = await loadRunner();
  assert.deepEqual(
    assessReducedMotion({
      linkTransitionDuration: "0s, 0s",
      mediaTransitionDuration: "0s",
      mediaQuery: true,
      scrollBehavior: "auto",
    }),
    [],
  );
  const errors = assessReducedMotion({
    linkTransitionDuration: "0.12s",
    mediaTransitionDuration: "0.22s",
    mediaQuery: false,
    scrollBehavior: "smooth",
  });
  assert.equal(errors.length, 4);
});

test("writes a self-contained evidence summary", async () => {
  const { createEvidenceReadme } = await loadRunner();
  const markdown = createEvidenceReadme({
    axeSummaries: [{ blocking: [], id: "baseline-mobile" }],
    generatedAt: "2026-09-04T00:00:00.000Z",
    git: {
      after: {
        sourceFingerprint: "c".repeat(64),
        sourceFingerprintAlgorithm: "p2-04-render-inputs-v1",
      },
      before: {
        sourceFingerprint: "c".repeat(64),
        sourceFingerprintAlgorithm: "p2-04-render-inputs-v1",
      },
    },
    nativeZoom: { detectedPercent: 200, zoomPercent: 200 },
    runtimeGates: [
      { environment: "preview", healthStatus: 200, localeStatuses: [200] },
      { environment: "staging", healthStatus: 200, localeStatuses: [404] },
      { environment: "production", healthStatus: 200, localeStatuses: [404] },
    ],
    scenarioResults: [{ errors: [], id: "baseline" }],
    screenshots: [{ path: "viewports/example.png", sha256: "a".repeat(64) }],
  });
  assert.match(markdown, /P2-04 UI composite browser verification/u);
  assert.match(markdown, /200%/u);
  assert.match(markdown, /critical\/serious/u);
  assert.match(markdown, /viewports\/example\.png/u);
  assert.match(markdown, /not deployment/u);
  assert.match(markdown, /Source fingerprint: c{64}/u);
});

test("binds composite evidence to the root layout order-entry dependency", async (context) => {
  const { collectCompositeSourceFingerprint } = await loadRunner();
  const root = await mkdtemp(path.join(os.tmpdir(), "order-entry-composite-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "apps/storefront/src/app"), { recursive: true });
  await writeFile(
    path.join(root, "apps/storefront/src/app/layout.tsx"),
    'import "../order-entry";\n',
  );
  const entryPath = "apps/storefront/src/order-entry.ts";
  await writeFile(path.join(root, entryPath), "entry-v1\n");
  await runGit(root, ["init", "--quiet"]);
  const initial = await collectCompositeSourceFingerprint(root);
  assert.ok(initial.files.some((file) => file.path === entryPath));
  await writeFile(path.join(root, entryPath), "entry-v2\n");
  const changed = await collectCompositeSourceFingerprint(root);
  assert.notEqual(changed.digest, initial.digest);
});
