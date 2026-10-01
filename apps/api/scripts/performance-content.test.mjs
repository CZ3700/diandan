import assert from "node:assert/strict";
import test from "node:test";
import { createAcceptanceLighthouseConfig } from "./storefront-acceptance-content.mjs";
import {
  PerformanceContentAudit,
  createPerformanceLighthouseConfig,
  performanceRequiredContent,
} from "./performance-content.mjs";

test("current-content Lighthouse guard is additive and retains original metric configuration", () => {
  const target = {
    kind: "home",
    selector: "[data-artist-directory]",
    locale: "en",
  };
  const original = createAcceptanceLighthouseConfig(
    target,
    "https://test.invalid/en",
  );
  const enhanced = createPerformanceLighthouseConfig(
    target,
    "https://test.invalid/en",
  );
  assert.equal(enhanced.extends, original.extends);
  assert.equal(enhanced.settings, undefined);
  assert.equal(enhanced.artifacts.length, original.artifacts.length + 1);
  assert.equal(enhanced.audits[0], original.audits[0]);
  assert.deepEqual(
    enhanced.categories.storefront.auditRefs[0],
    original.categories.storefront.auditRefs[0],
  );
  assert.deepEqual(performanceRequiredContent("home"), [
    "#hero-title",
    "[data-artist-card]",
    "[data-gift-browse] [data-gift-card]",
  ]);
});

test("missing or contradictory current content cannot pass the added audit", () => {
  const valid = {
    schemaVersion: 1,
    valid: true,
    observed: {
      urlMatches: true,
      localeMatches: true,
      contentVisible: true,
      errorVisible: false,
    },
  };
  assert.equal(
    PerformanceContentAudit.audit({ PerformanceCurrentContent: valid }).score,
    1,
  );
  for (const content of [
    undefined,
    { valid: true },
    { ...valid, observed: { ...valid.observed, contentVisible: false } },
    { ...valid, observed: { ...valid.observed, errorVisible: true } },
  ])
    assert.equal(
      PerformanceContentAudit.audit({ PerformanceCurrentContent: content })
        .score,
      0,
    );
});

test("artist content guards require the single localized top description after story removal", async () => {
  const selectors = ["#artist-title", "p[data-artist-description][lang]"];
  assert.deepEqual(performanceRequiredContent("artist"), selectors);
  const target = {
    kind: "artist",
    selector: "p[data-artist-description][lang]",
    locale: "ja",
  };
  const config = createAcceptanceLighthouseConfig(
    target,
    "https://test.invalid/ja/idols/artist",
  );
  const args = await config.artifacts[0].gatherer.getArtifact({
    driver: { executionContext: { evaluate: (_fn, options) => options.args } },
  });
  assert.equal(args[0], target.selector);
  assert.deepEqual(args[3], selectors);
});
