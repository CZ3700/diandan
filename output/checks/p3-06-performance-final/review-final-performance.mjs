import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { gzipSync } from "node:zlib";

const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, "../../..");
const directory = path.join(
  root,
  "output/checks/p3-06-storefront-acceptance/run-2026-09-08T01-40-26-728Z/browser-attempt-7/performance",
);
const readJson = async (filename) =>
  JSON.parse(await readFile(filename, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const performance = await readJson(path.join(directory, "results.json"));
if (performance.status === "RUNNING") {
  console.log(
    JSON.stringify({
      status: "PENDING",
      lighthouse: performance.lighthouse.length,
    }),
  );
  process.exit(2);
}
assert.ok(["PASS", "COLLECTED_BUDGET_FAILED"].includes(performance.status));
const locales = ["en", "zh-CN", "th", "vi", "ja", "es", "pt"];
const kinds = ["home", "artists", "artist", "gifts", "gift", "policy"];
const source = await readJson(path.join(output, "source-final.json"));
const sourceEntries = Object.entries(source.files).sort(([left], [right]) =>
  left < right ? -1 : left > right ? 1 : 0,
);
assert.equal(sourceEntries.length, 995);
assert.equal(
  sha(sourceEntries.map(([name, hash]) => `${name}\0${hash}\n`).join("")),
  source.sha256,
);
assert.equal(
  source.sha256,
  "df759a88a8dd62d8f08a08eccf87f2e29781e867ffffe955e4f554b7cadce62e",
);
for (const [name, hash] of sourceEntries)
  assert.equal(sha(await readFile(path.join(root, name))), hash, name);
const commit = execFileSync("git", ["rev-parse", "7db722b"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const tracked = new Set(
  execFileSync("git", ["ls-tree", "-r", "--name-only", commit], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n"),
);
for (const [name] of sourceEntries) assert.ok(tracked.has(name), name);
assert.equal(
  execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      commit,
      "--",
      ...sourceEntries.map(([name]) => name),
    ],
    { cwd: root, encoding: "utf8" },
  ).trim(),
  "",
);

const resourceKeys = performance.resources.map(
  (page) =>
    `${page.locale}/${page.kind}/${page.viewport.width}x${page.viewport.height}`,
);
const expectedResourceKeys = locales.flatMap((locale) =>
  kinds.flatMap((kind) =>
    ["390x844", "1440x900"].map((viewport) => `${locale}/${kind}/${viewport}`),
  ),
);
assert.deepEqual([...resourceKeys].sort(), expectedResourceKeys.sort());
assert.equal(new Set(resourceKeys).size, 84);
assert.deepEqual(performance.resourceFailures, []);
const builtScripts = new Map();
let imageCount = 0;
const resourcePages = [];
for (const page of performance.resources) {
  const scripts = page.resources.filter(
    (resource) => resource.type === "script",
  );
  assert.ok(scripts.length > 0);
  assert.equal(
    new Set(page.resources.map((resource) => resource.url)).size,
    page.resources.length,
  );
  let gzipBytes = 0;
  for (const script of scripts) {
    const url = new URL(script.url);
    assert.equal(script.status, 200);
    assert.ok(url.pathname.startsWith("/_next/static/"));
    assert.equal(url.search, "");
    if (!builtScripts.has(url.pathname)) {
      const bytes = await readFile(
        path.join(
          root,
          "apps/storefront/.next/static",
          url.pathname.slice("/_next/static/".length),
        ),
      );
      builtScripts.set(url.pathname, {
        bodyBytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
        sha256: sha(bytes),
      });
    }
    const built = builtScripts.get(url.pathname);
    assert.equal(script.bodyBytes, built.bodyBytes);
    assert.equal(script.gzipBytes, built.gzipBytes);
    gzipBytes += script.gzipBytes;
  }
  assert.equal(page.scriptCount, scripts.length);
  assert.equal(page.javascriptGzipBytes, gzipBytes);
  assert.equal(page.javascriptRecommendationBytes, 150_000);
  assert.equal(page.javascriptRecommendationMet, gzipBytes < 150_000);
  assert.equal(
    page.images.length,
    page.resources.filter((resource) => resource.type === "image").length,
  );
  if (page.kind !== "policy") assert.ok(page.images.length > 0);
  for (const image of page.images) {
    assert.equal(image.status, 200);
    assert.ok(Number.isInteger(image.bodyBytes) && image.bodyBytes > 0);
    const limit = image.role === "FIRST_VIEWPORT_HERO" ? 600_000 : 400_000;
    assert.equal(image.shouldBudgetBytes, limit);
    assert.equal(image.shouldBudgetMet, image.bodyBytes < limit);
    imageCount++;
  }
  resourcePages.push({
    locale: page.locale,
    kind: page.kind,
    viewport: page.viewport,
    javascriptGzipBytes: gzipBytes,
    javascriptShouldMet: gzipBytes < 150_000,
    imageCount: page.images.length,
  });
}

assert.equal(performance.lighthouse.length, 63);
const rawFiles = (await readdir(directory)).filter((name) =>
  /-mobile-[123]\.json$/u.test(name),
);
assert.equal(rawFiles.length, 63);
assert.equal(new Set(performance.lighthouse.map((run) => run.file)).size, 63);
const summary = (values) => {
  assert.equal(values.length, 3);
  assert.ok(values.every(Number.isFinite));
  const sorted = [...values].sort((left, right) => left - right);
  return { min: sorted[0], median: sorted[1], max: sorted[2] };
};
const groups = [];
const warnings = [];
const contentSamples = [];
let settings;
for (const locale of locales)
  for (const kind of ["home", "artist", "gift"]) {
    const entries = performance.lighthouse
      .filter((run) => run.locale === locale && run.kind === kind)
      .sort((left, right) => left.attempt - right.attempt);
    assert.deepEqual(
      entries.map((run) => run.attempt),
      [1, 2, 3],
    );
    const runs = [];
    for (const entry of entries) {
      assert.equal(
        entry.file,
        `${locale}-${kind}-mobile-${entry.attempt}.json`,
      );
      const raw = await readJson(path.join(directory, entry.file));
      assert.ok(!raw.runtimeError);
      assert.equal(raw.lighthouseVersion, "13.4.1");
      assert.equal(raw.configSettings.formFactor, "mobile");
      assert.equal(raw.configSettings.throttlingMethod, "simulate");
      if (settings) assert.deepEqual(raw.configSettings.throttling, settings);
      settings = raw.configSettings.throttling;
      assert.equal(
        new URL(raw.requestedUrl).pathname + new URL(raw.requestedUrl).search,
        entry.path,
      );
      assert.equal(
        new URL(raw.finalDisplayedUrl).pathname +
          new URL(raw.finalDisplayedUrl).search,
        entry.path,
      );
      assert.ok(
        Number.isFinite(raw.categories.performance.score) &&
          raw.categories.performance.score >= 0 &&
          raw.categories.performance.score <= 1,
      );
      if (raw.runWarnings?.length)
        warnings.push({ file: entry.file, warnings: raw.runWarnings });
      const lcpNode = raw.audits["lcp-breakdown-insight"].details?.items.find(
        (item) => item.type === "node",
      );
      const selector = lcpNode?.selector ?? "";
      const state = selector.includes("storefront-state")
        ? "UNAVAILABLE_CONTENT"
        : lcpNode?.snippet?.toLowerCase().includes("<img")
          ? "CONTENT_IMAGE_LCP"
          : "UNCLASSIFIED";
      contentSamples.push({
        file: entry.file,
        fetchTime: raw.fetchTime,
        state,
        selector,
        ...(state === "UNAVAILABLE_CONTENT"
          ? { publicStateLabel: lcpNode?.nodeLabel }
          : {}),
      });
      runs.push(raw);
    }
    const lcpMs = summary(
      runs.map((run) => run.audits["largest-contentful-paint"].numericValue),
    );
    const cls = summary(
      runs.map((run) => run.audits["cumulative-layout-shift"].numericValue),
    );
    const performanceScore = summary(
      runs.map((run) => run.categories.performance.score),
    );
    const aggregate = await readJson(
      path.join(directory, `${locale}-${kind}-aggregate.json`),
    );
    assert.deepEqual(aggregate, entries[2].aggregate);
    assert.equal(aggregate.runs, 3);
    assert.deepEqual(aggregate.lcpMs, lcpMs);
    assert.deepEqual(aggregate.cls, cls);
    assert.deepEqual(aggregate.performanceScore, performanceScore);
    assert.equal(
      aggregate.performanceScoreTargetMet,
      performanceScore.median >= 0.9,
    );
    assert.equal(aggregate.lcpLabTargetMet, lcpMs.median < 2500);
    assert.equal(aggregate.clsLabTargetMet, cls.median < 0.1);
    groups.push({
      locale,
      kind,
      lcpMs,
      cls,
      performanceScore,
      scoreTargetMet: performanceScore.median >= 0.9,
      lcpTargetMet: lcpMs.median < 2500,
      clsTargetMet: cls.median < 0.1,
    });
  }
const scoreGroupsPassed = groups.filter((group) => group.scoreTargetMet).length;
const lcpGroupsPassed = groups.filter((group) => group.lcpTargetMet).length;
const clsGroupsPassed = groups.filter((group) => group.clsTargetMet).length;
const laboratoryTargetsMet =
  scoreGroupsPassed === 21 && lcpGroupsPassed === 21 && clsGroupsPassed === 21;
const javascriptPagesPassed = resourcePages.filter(
  (page) => page.javascriptShouldMet,
).length;
const imagesFailed = performance.resources
  .flatMap((page) => page.images)
  .filter((image) => !image.shouldBudgetMet).length;
assert.equal(performance.budget.labTargetsMet, laboratoryTargetsMet);
assert.equal(
  performance.budget.javascriptShouldMet,
  javascriptPagesPassed === 84,
);
assert.equal(
  performance.budget.javascriptPagesExceedingRecommendation,
  84 - javascriptPagesPassed,
);
assert.equal(performance.budget.imagesShouldMet, imagesFailed === 0);
assert.equal(performance.budget.imagesExceedingRecommendation, imagesFailed);
assert.equal(
  performance.status,
  laboratoryTargetsMet ? "PASS" : "COLLECTED_BUDGET_FAILED",
);
const review = {
  schemaVersion: 1,
  reviewStatus: "VERIFIED",
  laboratoryVerdict: performance.status,
  reviewScope:
    "Source, resource bytes and numerical aggregation verified; business content availability is reported separately and is not all successful.",
  contentState: {
    scope:
      "LCP element and retained screenshot evidence only; a content image does not independently validate the complete business page. Lighthouse runtime success is not business content success.",
    contentImageLcpSamples: contentSamples.filter(
      (sample) => sample.state === "CONTENT_IMAGE_LCP",
    ).length,
    unavailableContentSamples: contentSamples.filter(
      (sample) => sample.state === "UNAVAILABLE_CONTENT",
    ).length,
    unclassifiedSamples: contentSamples.filter(
      (sample) => sample.state === "UNCLASSIFIED",
    ).length,
    allSamplesBusinessReady: false,
    aggregation:
      "All original three-sample medians are retained, including the unavailable ja artist sample; no replacement or exclusion.",
    samples: contentSamples,
  },
  source: {
    commit,
    fileCount: sourceEntries.length,
    sha256: source.sha256,
    diskAndCommitMatch: true,
  },
  report: path.relative(root, path.join(directory, "results.json")),
  reportSha256: sha(await readFile(path.join(directory, "results.json"))),
  completeMatrix: {
    resourcePages: 84,
    rawLighthouseRuns: 63,
    threeRunGroups: 21,
    scoreGroupsPassed,
    lcpGroupsPassed,
    clsGroupsPassed,
  },
  resourceBudget: {
    javascriptPagesPassed,
    javascriptPagesFailed: 84 - javascriptPagesPassed,
    javascriptMinGzipBytes: Math.min(
      ...resourcePages.map((page) => page.javascriptGzipBytes),
    ),
    javascriptMaxGzipBytes: Math.max(
      ...resourcePages.map((page) => page.javascriptGzipBytes),
    ),
    imagesObserved: imageCount,
    imagesFailed,
    builtScriptCount: builtScripts.size,
    actualBuiltScriptBytesMatchRecordedResponses: true,
  },
  method:
    "Independent raw JSON median/min/max recomputation; all three samples retained. Original thresholds unchanged. No Lighthouse, browser, Next build, or Lantern recomputation was run by this review.",
  conditions: performance.conditions,
  lighthouseSettings: settings,
  warnings,
  groups,
  resourcePages,
  builtScripts: Object.fromEntries(builtScripts),
  realUserEvidence: false,
  physicalDeviceEvidence: false,
};
await writeFile(
  path.join(output, "final-performance-review.json"),
  JSON.stringify(review, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      reviewStatus: review.reviewStatus,
      laboratoryVerdict: review.laboratoryVerdict,
      completeMatrix: review.completeMatrix,
      resourceBudget: review.resourceBudget,
    },
    null,
    2,
  ),
);
