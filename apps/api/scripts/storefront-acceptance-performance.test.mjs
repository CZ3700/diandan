import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import {
  aggregateAcceptanceLighthouse,
  summarizeAcceptancePerformanceBudget,
  observeAcceptanceResourceTraffic,
  summarizeAcceptanceResources,
} from "./storefront-acceptance-performance.mjs";

test("resource collection retains a network-failed image even when a script response succeeds", async () => {
  const page = new EventEmitter();
  const observed = observeAcceptanceResourceTraffic(page);
  page.emit("response", {
    request: () => ({ resourceType: () => "script" }),
    body: async () => Buffer.from("console.log('TEST');"),
    status: () => 200,
    url: () => "https://test.invalid/script.js",
    headers: () => ({}),
  });
  page.emit("requestfailed", { resourceType: () => "image" });
  page.emit("requestfailed", { resourceType: () => "font" });
  await Promise.all(observed.pending);
  assert.equal(observed.resources.length, 1);
  assert.deepEqual(observed.failures, [
    { type: "image", status: null, errorKind: "NETWORK_REQUEST_FAILED" },
  ]);
});

const run = (lcp, cls, score = 0.9) => ({
  lighthouseVersion: "13.4.1",
  categories: { performance: { score } },
  audits: {
    "largest-contentful-paint": { numericValue: lcp },
    "cumulative-layout-shift": { numericValue: cls },
  },
});
test("three-run aggregation retains worst run and reports median instead of selecting the best", () => {
  const summary = aggregateAcceptanceLighthouse([
    run(1000, 0),
    run(4000, 0.3),
    run(3000, 0.1),
  ]);
  assert.deepEqual(summary.lcpMs, { min: 1000, median: 3000, max: 4000 });
  assert.equal(summary.lcpLabTargetMet, false);
  assert.equal(summary.clsLabTargetMet, false);
  assert.equal(summary.realUserEvidence, false);
});
test("incomplete or failed lighthouse runs cannot be hidden in an aggregate", () => {
  assert.throws(
    () => aggregateAcceptanceLighthouse([run(1, 0), run(2, 0)]),
    /three/,
  );
  assert.throws(
    () =>
      aggregateAcceptanceLighthouse([
        run(1, 0),
        run(2, 0),
        { runtimeError: { code: "FAILED_DOCUMENT_REQUEST" } },
      ]),
    /failed/,
  );
  for (const score of [null, undefined, NaN, Infinity, -0.1, 1.1]) {
    const invalid = run(1000, 0);
    invalid.categories.performance.score = score;
    assert.throws(
      () =>
        aggregateAcceptanceLighthouse([
          invalid,
          run(1000, 0, 0.95),
          run(1000, 0, 0.95),
        ]),
      /score/,
    );
  }
});
test("completed collection with a failing median is a failed lab budget, with resource recommendations separate", () => {
  const aggregate = aggregateAcceptanceLighthouse([
    run(1000, 0, 0.99),
    run(2000, 0, 0.89),
    run(2200, 0, 0.88),
  ]);
  assert.equal(aggregate.performanceScoreTargetMet, false);
  const summary = summarizeAcceptancePerformanceBudget(
    [aggregate],
    [
      {
        javascriptRecommendationMet: false,
        images: [{ shouldBudgetMet: false }],
      },
    ],
  );
  assert.equal(summary.labTargetsMet, false);
  assert.equal(summary.javascriptShouldMet, false);
  assert.equal(summary.imagesShouldMet, false);
  const passing = aggregateAcceptanceLighthouse([
    run(1000, 0),
    run(2000, 0),
    run(2400, 0),
  ]);
  assert.equal(
    summarizeAcceptancePerformanceBudget(
      [passing],
      [{ javascriptRecommendationMet: false, images: [] }],
    ).labTargetsMet,
    true,
  );
});
test("resource budgets deduplicate loaded script URLs and distinguish hero from regular images", () => {
  const summary = summarizeAcceptanceResources(
    [
      {
        url: "https://test.invalid/a.js",
        type: "script",
        gzipBytes: 90_000,
        bodyBytes: 300_000,
      },
      {
        url: "https://test.invalid/a.js",
        type: "script",
        gzipBytes: 90_000,
        bodyBytes: 300_000,
      },
      {
        url: "https://test.invalid/b.js",
        type: "script",
        gzipBytes: 80_000,
        bodyBytes: 200_000,
      },
      {
        url: "https://test.invalid/hero.avif",
        type: "image",
        bodyBytes: 500_000,
      },
      {
        url: "https://test.invalid/card.avif",
        type: "image",
        bodyBytes: 450_000,
      },
    ],
    "https://test.invalid/hero.avif",
  );
  assert.equal(summary.javascriptGzipBytes, 170_000);
  assert.equal(summary.javascriptRecommendationMet, false);
  assert.equal(summary.images[0].shouldBudgetMet, true);
  assert.equal(summary.images[1].shouldBudgetMet, false);
});
