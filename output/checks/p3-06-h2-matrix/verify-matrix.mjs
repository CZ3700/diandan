#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  aggregateAcceptanceLighthouse,
  summarizeAcceptancePerformanceBudget,
} from "../../../apps/api/scripts/storefront-acceptance-performance.mjs";
import { SUPPORTED_LOCALES } from "../../../packages/contracts/dist/index.js";
import {
  acceptancePages,
  acceptanceViewports,
} from "../../../apps/api/scripts/storefront-acceptance-pages.mjs";

const directory = path.resolve(process.argv[2]);
const destination = path.resolve(process.argv[3]);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const report = await readJson(path.join(directory, "performance/results.json"));
const context = await readJson(path.join(directory, "matrix-context.json"));
const viewer = await readJson(path.join(directory, "viewer-final.json"));
const fixture = await readJson(
  path.join(directory, "../fixture-manifest.json"),
);
assert.equal(fixture.environment, "TEST");
const targets = acceptancePages(fixture);
const targetFields = ({ locale, kind, path: route, selector }) => ({
  locale,
  kind,
  path: route,
  selector,
});
assert.deepEqual(
  report.resources.map((entry) => ({
    ...targetFields(entry),
    viewport: entry.viewport,
  })),
  acceptanceViewports.flatMap((viewport) =>
    targets.map((target) => ({ ...target, viewport })),
  ),
);
assert.equal(report.resources.length, 84);
assert.equal(report.resourceFailures.length, 0);
assert.equal(report.lighthouse.length, 63);
assert.equal(context.readDiagnostics, false);
assert.equal(context.extraPrewarming, false);
const groups = [],
  manifest = [],
  warnings = [];
async function fingerprint(name) {
  const bytes = await readFile(path.join(directory, name));
  manifest.push({
    file: name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
for (const file of [
  "../fixture-manifest.json",
  "../protocol-results.json",
  "matrix-context.json",
  "viewer-final.json",
  "viewer-after-matrix.json",
  "performance/results.json",
])
  await fingerprint(file);
let settings;
for (const locale of SUPPORTED_LOCALES) {
  for (const kind of ["home", "artist", "gift"]) {
    const entries = report.lighthouse.filter(
      (entry) => entry.locale === locale && entry.kind === kind,
    );
    assert.deepEqual(
      entries.map((entry) => entry.attempt),
      [1, 2, 3],
    );
    const target = targets.find(
      (entry) => entry.locale === locale && entry.kind === kind,
    );
    const runs = [];
    for (const entry of entries) {
      assert.deepEqual(targetFields(entry), target);
      assert.equal(
        entry.file,
        `${locale}-${kind}-mobile-${entry.attempt}.json`,
      );
      assert.equal(
        entry.html,
        `${locale}-${kind}-mobile-${entry.attempt}.html`,
      );
      for (const name of [entry.file, entry.html]) {
        assert.ok(name);
        await fingerprint(`performance/${name}`);
      }
      const run = await readJson(
        path.join(directory, "performance", entry.file),
      );
      assert.equal(run.lighthouseVersion, "13.4.1");
      assert.equal(entry.lighthouseVersion, run.lighthouseVersion);
      assert.equal(entry.runtimeError, run.runtimeError ?? null);
      assert.deepEqual(entry.configSettings, run.configSettings);
      assert.deepEqual(entry.contentValidity, run.audits["storefront-content"]);
      assert.deepEqual(entry.runWarnings, run.runWarnings);
      for (const key of [
        "requestedUrl",
        "mainDocumentUrl",
        "finalDisplayedUrl",
        "finalUrl",
      ])
        assert.equal(run[key], context.origin + entry.path);
      settings ??= run.configSettings;
      assert.deepEqual(run.configSettings, settings);
      assert.equal(settings.throttlingMethod, "simulate");
      assert.equal(settings.formFactor, "mobile");
      if (run.runWarnings.length)
        warnings.push({ file: entry.file, warnings: run.runWarnings });
      runs.push(run);
    }
    const aggregate = aggregateAcceptanceLighthouse(runs);
    const saved = await readJson(
      path.join(directory, "performance", `${locale}-${kind}-aggregate.json`),
    );
    await fingerprint(`performance/${locale}-${kind}-aggregate.json`);
    assert.deepEqual(aggregate, saved);
    assert.deepEqual(entries[2].aggregate, saved);
    groups.push({ locale, kind, ...aggregate });
  }
}
assert.equal(groups.length, 21);
const budget = summarizeAcceptancePerformanceBudget(groups, report.resources);
assert.deepEqual(budget, report.budget);
assert.equal(
  report.status,
  budget.labTargetsMet ? "PASS" : "COLLECTED_BUDGET_FAILED",
);
for (const locale of SUPPORTED_LOCALES) {
  for (const width of [390, 1440]) {
    const entries = report.resources.filter(
      (entry) => entry.locale === locale && entry.viewport.width === width,
    );
    assert.deepEqual(entries.map((entry) => entry.kind).sort(), [
      "artist",
      "artists",
      "gift",
      "gifts",
      "home",
      "policy",
    ]);
  }
}
assert.equal(viewer.closed, true);
assert.equal(viewer.origin, context.origin);
assert.equal(viewer.protocol, "h2");
assert.equal(viewer.activeRequests, 0);
assert.equal(viewer.overflowRequests, 0);
assert.ok(viewer.requests.length > 0);
for (const record of viewer.requests) {
  assert.equal(record.alpnProtocol, "h2");
  assert.equal(record.httpVersion, "2.0");
  assert.ok(record.finishedAt && record.sha256);
  assert.match(record.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(Number.isSafeInteger(record.byteLength) && record.byteLength >= 0);
  assert.ok(Date.parse(record.finishedAt) >= Date.parse(record.startedAt));
  assert.equal(record.complete, record.failure === null);
}
const result = {
  schemaVersion: 1,
  evidenceVerification: "PASS",
  originalVerdict: report.status,
  origin: context.origin,
  upstreamOrigin: context.upstreamOrigin,
  buildId: context.buildId,
  resources: report.resources.length,
  samples: report.lighthouse.length,
  groups,
  budget,
  warnings,
  configSettings: settings,
  rawFiles: manifest,
  viewer: {
    file: "viewer-final.json",
    records: viewer.requests.length,
    completeResponses: viewer.requests.filter((record) => record.complete)
      .length,
    incompleteResponses: viewer.requests.filter((record) => !record.complete)
      .length,
    completeHttpErrorResponses: viewer.requests.filter(
      (record) => record.complete && record.status >= 400,
    ).length,
    protocol: viewer.protocol,
    closed: viewer.closed,
    activeRequests: viewer.activeRequests,
    overflowRequests: viewer.overflowRequests,
    failures: viewer.requests.filter(
      (record) => record.failure || record.status >= 400,
    ),
  },
  scope:
    "Original 84 resource navigations and 63 retained Lighthouse samples; local TEST H2 laboratory only, not production trust, deployment, SEO, field CWV, screen-reader or physical-device approval.",
};
await writeFile(destination, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({
    evidenceVerification: result.evidenceVerification,
    originalVerdict: result.originalVerdict,
    resources: result.resources,
    samples: result.samples,
    groups: groups.length,
    budget,
  }),
);
