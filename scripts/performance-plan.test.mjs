import assert from "node:assert/strict";
import test from "node:test";
import {
  performancePlan,
  assertPerformanceCollection,
} from "./performance-plan.mjs";

test("formal plan retains 63 original mobile Lighthouse samples and 294 six-screen resource cells", () => {
  const plan = performancePlan();
  assert.equal(plan.resources.length, 294);
  assert.equal(new Set(plan.resources.map((cell) => cell.id)).size, 294);
  assert.equal(plan.originalLighthouseSamples, 63);
  assert.equal(plan.originalLighthouseGroups, 21);
  assert.deepEqual(
    [...new Set(plan.resources.map((cell) => `${cell.width}x${cell.height}`))],
    ["360x800", "390x844", "768x1024", "1024x768", "1440x900", "1920x1080"],
  );
  assert.equal(plan.formal, true);
});

test("diagnostic plan cannot satisfy a formal collection", () => {
  const plan = performancePlan({ diagnostic: true });
  assert.equal(plan.formal, false);
  assert.equal(plan.resources.length, 3);
  assert.equal(plan.diagnosticLighthouseSamples, 9);
  assert.equal(plan.originalLighthouseSamples, 0);
  assert.throws(() => assertPerformanceCollection(plan, [], null), /formal/u);
});

test("missing, repeated, failed and mismatched viewport cells cannot pass coverage", () => {
  const plan = performancePlan();
  const cells = plan.resources.map((cell) => ({
    ...cell,
    status: "PASS",
    content: { valid: true },
    resourceAssessment: { passed: true },
    measurement: {
      width: cell.width,
      height: cell.height,
      locale: cell.locale,
      metrics: { lcpMs: 2000, cls: 0 },
    },
  }));
  const locales = [...new Set(cells.map((cell) => cell.locale))];
  const original = {
    status: "PASS",
    resources: plan.resources
      .filter(
        (cell) =>
          cell.kind !== "gift-browse" && [390, 1440].includes(cell.width),
      )
      .map((cell) => ({
        ...cell,
        viewport: { width: cell.width, height: cell.height },
      })),
    lighthouse: locales.flatMap((locale) =>
      ["home", "artist", "gift"].flatMap((kind) =>
        [1, 2, 3].map((attempt) => ({
          locale,
          kind,
          attempt,
          ...(attempt === 3 ? { aggregate: { runs: 3 } } : {}),
        })),
      ),
    ),
    budget: { labTargetsMet: true },
  };
  assert.doesNotThrow(() => assertPerformanceCollection(plan, cells, original));
  assert.throws(() =>
    assertPerformanceCollection(plan, cells.slice(1), original),
  );
  assert.throws(() =>
    assertPerformanceCollection(plan, [...cells.slice(1), cells[1]], original),
  );
  assert.throws(() =>
    assertPerformanceCollection(
      plan,
      [{ ...cells[0], width: 100 }, ...cells.slice(1)],
      original,
    ),
  );
  assert.throws(() =>
    assertPerformanceCollection(
      plan,
      [{ ...cells[0], status: "FAIL" }, ...cells.slice(1)],
      original,
    ),
  );
  assert.throws(() =>
    assertPerformanceCollection(plan, cells, { ...original, status: "FAIL" }),
  );
  assert.throws(() =>
    assertPerformanceCollection(
      plan,
      [{ ...cells[0], measurement: undefined }, ...cells.slice(1)],
      original,
    ),
  );
  assert.throws(() =>
    assertPerformanceCollection(plan, cells, {
      ...original,
      lighthouse: [original.lighthouse[1], ...original.lighthouse.slice(1)],
    }),
  );
});
