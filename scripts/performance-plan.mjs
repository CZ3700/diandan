import assert from "node:assert/strict";
import { accessibilityLocales } from "../apps/api/scripts/accessibility-contracts.mjs";

export const performanceViewports = Object.freeze([
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]);
export const performancePageKinds = Object.freeze([
  "home",
  "artists",
  "artist",
  "gifts",
  "gift",
  "policy",
  "gift-browse",
]);

/** Fixed before measurement. Six-screen observations supplement the unchanged mobile Lighthouse gate. */
export function performancePlan({ diagnostic = false } = {}) {
  const resources = performanceViewports.flatMap((viewport) =>
    accessibilityLocales.flatMap((locale) =>
      performancePageKinds.map((kind) => ({
        id: `${locale}-${kind}-${viewport.width}x${viewport.height}`,
        locale,
        kind,
        ...viewport,
      })),
    ),
  );
  return {
    schemaVersion: 1,
    formal: !diagnostic,
    resources: diagnostic
      ? resources.filter(
          (cell) =>
            cell.locale === "zh-CN" &&
            cell.width === 390 &&
            ["home", "artist", "gift"].includes(cell.kind),
        )
      : resources,
    originalLighthouseSamples: diagnostic ? 0 : 63,
    diagnosticLighthouseSamples: diagnostic ? 9 : 0,
    originalLighthouseGroups: diagnostic ? 0 : 21,
    originalResourcePages: diagnostic ? 0 : 84,
    order:
      "Original unmodified 84 resource pages and 63 Lighthouse samples, then six-screen resource matrix; no extra prewarming or retries",
    sixScreenMetricScope:
      "Unthrottled same-navigation lab LCP/CLS only; no Lighthouse score, field INP or RUM claim",
    realUserEvidence: false,
  };
}

export function assertPerformanceCollection(plan, cells, original) {
  assert.equal(
    plan.formal,
    true,
    "Only the formal plan can satisfy acceptance",
  );
  const expected = performancePlan();
  assert.deepEqual(
    plan,
    expected,
    "The formal plan cannot shrink during measurement",
  );
  assert.equal(
    cells.length,
    expected.resources.length,
    "Every six-screen cell must be retained",
  );
  assert.equal(
    new Set(cells.map((cell) => cell.id)).size,
    cells.length,
    "Duplicate cells are not coverage",
  );
  for (const entry of expected.resources) {
    const cell = cells.find(({ id }) => id === entry.id);
    assert.ok(cell, "Missing planned cell");
    for (const [key, value] of Object.entries(entry))
      assert.equal(
        cell[key],
        value,
        "Measured cell dimensions must match the fixed plan",
      );
    assert.equal(
      cell.status,
      "PASS",
      "Unknown or failed observations cannot pass",
    );
    assert.equal(
      cell.content?.valid,
      true,
      "Each cell needs measured current content",
    );
    assert.equal(
      cell.resourceAssessment?.passed,
      true,
      "Each cell needs successful resource evidence",
    );
    assert.equal(
      cell.measurement?.width,
      entry.width,
      "Actual viewport width is required",
    );
    assert.equal(
      cell.measurement?.height,
      entry.height,
      "Actual viewport height is required",
    );
    assert.equal(
      cell.measurement?.locale,
      entry.locale,
      "Actual locale is required",
    );
    assert.ok(
      Number.isFinite(cell.measurement?.metrics?.lcpMs) &&
        cell.measurement.metrics.lcpMs > 0,
      "Unknown LCP cannot pass coverage",
    );
    assert.ok(
      Number.isFinite(cell.measurement?.metrics?.cls) &&
        cell.measurement.metrics.cls >= 0,
      "Unknown CLS cannot pass coverage",
    );
  }
  assert.equal(
    original?.status,
    "PASS",
    "Original Lighthouse collection must pass unchanged",
  );
  assert.equal(
    original.resources?.length,
    84,
    "Original resource scope remains complete",
  );
  assert.equal(
    original.lighthouse?.length,
    63,
    "All original Lighthouse samples remain required",
  );
  assert.equal(
    original.lighthouse.filter((sample) => sample.aggregate).length,
    21,
    "All original three-run groups remain required",
  );
  assert.equal(
    original.budget?.labTargetsMet,
    true,
    "Original Lighthouse thresholds remain required",
  );
  for (const locale of accessibilityLocales) {
    for (const kind of performancePageKinds.filter(
      (kind) => kind !== "gift-browse",
    )) {
      for (const width of [390, 1440])
        assert.equal(
          original.resources.filter(
            (sample) =>
              sample.locale === locale &&
              sample.kind === kind &&
              sample.viewport?.width === width,
          ).length,
          1,
          "Original resource target identities must be complete",
        );
    }
    for (const kind of ["home", "artist", "gift"]) {
      for (const attempt of [1, 2, 3])
        assert.equal(
          original.lighthouse.filter(
            (sample) =>
              sample.locale === locale &&
              sample.kind === kind &&
              sample.attempt === attempt,
          ).length,
          1,
          "Original Lighthouse sample identities must be complete",
        );
    }
  }
}
