import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import {
  verifyCaptureBinding,
  verifyLanternReplay,
} from "../../../apps/api/scripts/storefront-gift-trace-analysis.mjs";
import { summarizeGiftReadWindow } from "../../../apps/api/scripts/storefront-gift-read-verification.mjs";

const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, "../../..");
const run = path.join(
  root,
  "output/checks/p3-06-storefront-acceptance/run-2026-09-21T15-55-54-248Z",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const median = (values) => [...values].sort((a, b) => a - b)[1];
const report = {
  schemaVersion: 1,
  scope: "Fixed six original H2 font-range captures",
  formalPerformanceAcceptance: false,
  groups: [],
  originalFileCount: 0,
};
let referenceSettings,
  referenceLauncher,
  referencePublication,
  referenceManifest,
  viewerOrigin;
for (const [index, stage] of ["baseline", "candidate"].entries()) {
  const directory = path.join(run, `browser-attempt-${index + 1}`);
  const captureDirectory = path.join(directory, "gift-render-trace");
  const capture = await json(path.join(captureDirectory, "results.json"));
  const viewer = await json(path.join(directory, "font-range-viewer.json"));
  assert.equal(viewer.stage, stage);
  assert.equal(viewer.protocol, "h2");
  assert.equal(viewer.activeRequests, 0);
  assert.equal(viewer.overflowRequests, 0);
  viewerOrigin ??= viewer.origin;
  assert.equal(viewer.origin, viewerOrigin);
  assert.ok(
    viewer.requests.every(
      (request) =>
        request.alpnProtocol === "h2" && request.httpVersion === "2.0",
    ),
  );
  assert.equal(
    viewer.requestEnd - viewer.requestOffset,
    viewer.requests.length,
  );
  assert.equal(
    viewer.requestOffset,
    index === 0 ? 0 : report.groups[0].requestEnd,
  );
  const publication = await readFile(
    path.join(captureDirectory, "fixture-publication-response.txt"),
  );
  const manifest = await readFile(
    path.join(captureDirectory, "fixture-manifest.json"),
  );
  referencePublication ??= publication;
  referenceManifest ??= manifest;
  assert.deepEqual(publication, referencePublication);
  assert.deepEqual(manifest, referenceManifest);
  assert.equal(capture.attempts.length, 3);
  const group = {
    stage,
    buildId: viewer.buildId,
    nextGeneration: viewer.nextGeneration,
    requestOffset: viewer.requestOffset,
    requestEnd: viewer.requestEnd,
    auxiliaryFailuresRetained: viewer.requests.filter(
      (request) => !request.complete || request.failure,
    ),
    publicationSha256: sha(publication),
    manifestSha256: sha(manifest),
    samples: [],
  };
  report.groups.push(group);
  for (const attempt of capture.attempts) {
    const inputFiles = {};
    for (const file of Object.values(attempt.files)) {
      const bytes = await readFile(path.join(captureDirectory, file.file));
      assert.equal(bytes.length, file.bytes);
      assert.equal(sha(bytes), file.sha256);
      inputFiles[file.file] = { bytes: bytes.length, sha256: sha(bytes) };
      report.originalFileCount++;
    }
    const load = (suffix) =>
      json(path.join(captureDirectory, attempt.name + suffix));
    const lhr = await load(".json"),
      artifacts = await load("-artifacts.json"),
      config = await load("-config.json"),
      devtools = await load("-devtools.json");
    const replay = await json(
      path.join(output, "replay", stage, attempt.name + "-analysis.json"),
    );
    const binding = verifyCaptureBinding({
      lhr,
      artifacts,
      config,
      capturedFiles: attempt.files,
      inputFiles,
    });
    assert.equal(binding.verifiedFiles, 9);
    referenceSettings ??= lhr.configSettings;
    referenceLauncher ??= config.launchOptions;
    assert.deepEqual(lhr.configSettings, referenceSettings);
    assert.deepEqual(config.launchOptions, referenceLauncher);
    assert.equal(lhr.audits["storefront-content"].score, 1);
    assert.equal(lhr.runtimeError, undefined);
    assert.equal(new URL(lhr.requestedUrl).origin, viewer.origin);
    const responses = devtools.filter(
      (entry) =>
        entry.method === "Network.responseReceived" &&
        new URL(entry.params.response.url).origin === viewer.origin,
    );
    assert.ok(
      responses.length > 0 &&
        responses.every((entry) => entry.params.response.protocol === "h2"),
    );
    const reads = summarizeGiftReadWindow(
      await readFile(
        path.join(captureDirectory, attempt.name + "-native.log"),
        "utf8",
      ),
      attempt.reads.afterSequence,
    );
    assert.deepEqual(reads, attempt.reads);
    assert.deepEqual(reads.counts, { GIFT_CONTENT: 0, STOREFRONT_GIFT: 1 });
    assert.equal(replay.status, "REPLAY_MATCHED");
    const replayInputs = Object.fromEntries(
      [
        ".json",
        "-trace.json",
        "-devtools.json",
        "-artifacts.json",
        "-config.json",
      ].map((suffix) => [
        attempt.name + suffix,
        inputFiles[attempt.name + suffix].sha256,
      ]),
    );
    assert.deepEqual(replay.inputSha256, replayInputs);
    assert.deepEqual(replay.binding, { ...binding, verifiedFiles: 5 });
    const equivalence = verifyLanternReplay(
      lhr,
      replay.simulated.FCP,
      replay.simulated.LCP,
    );
    assert.equal(equivalence.matched, true);
    const fonts = lhr.audits["network-requests"].details.items
      .filter((item) => item.resourceType === "Font")
      .map((item) => {
        const pathname = new URL(item.url).pathname;
        const entities = viewer.requests.filter(
          (request) =>
            request.path === pathname && request.complete && !request.failure,
        );
        assert.ok(
          entities.length > 0 &&
            entities.every(
              (entity) =>
                entity.status === 200 &&
                entity.sha256 === entities[0].sha256 &&
                entity.byteLength === entities[0].byteLength,
            ),
        );
        assert.equal(item.statusCode, 200);
        assert.equal(item.resourceSize, entities[0].byteLength);
        return {
          pathname,
          resourceBytes: item.resourceSize,
          transferBytes: item.transferSize,
          entitySha256: entities[0].sha256,
        };
      })
      .sort((a, b) => a.pathname.localeCompare(b.pathname));
    group.samples.push({
      name: attempt.name,
      files: attempt.files,
      binding,
      equivalence,
      reads: reads.counts,
      fonts,
      fontResourceBytes: fonts.reduce(
        (total, font) => total + font.resourceBytes,
        0,
      ),
      fontTransferBytes: fonts.reduce(
        (total, font) => total + font.transferBytes,
        0,
      ),
      lcpMs: lhr.audits["largest-contentful-paint"].numericValue,
      performanceScore: lhr.categories.performance.score,
      cls: lhr.audits["cumulative-layout-shift"].numericValue,
      observedLcpMs: replay.observed.observedTimingsMs.largestContentfulPaint,
      lcpGraphFontCount: replay.simulated.LCP.optimistic.nodes.filter(
        (node) => node.resourceType === "Font",
      ).length,
    });
  }
  group.medianLcpMs = median(group.samples.map((sample) => sample.lcpMs));
  group.medianPerformanceScore = median(
    group.samples.map((sample) => sample.performanceScore),
  );
  group.laboratoryMedianBudgetPassed =
    group.medianLcpMs < 2500 &&
    group.medianPerformanceScore >= 0.9 &&
    median(group.samples.map((sample) => sample.cls)) < 0.1;
}
assert.equal(report.originalFileCount, 54);
const fontIdentity = (fonts) =>
  fonts.map(({ pathname, resourceBytes, entitySha256 }) => ({
    pathname,
    resourceBytes,
    entitySha256,
  }));
for (const group of report.groups)
  for (const sample of group.samples)
    assert.deepEqual(
      fontIdentity(sample.fonts),
      fontIdentity(group.samples[0].fonts),
    );
const before = report.groups[0].samples[0],
  after = report.groups[1].samples[0];
for (const font of after.fonts)
  assert.deepEqual(
    fontIdentity([font]),
    fontIdentity([
      before.fonts.find((candidate) => candidate.pathname === font.pathname),
    ]),
  );
report.removedFonts = before.fonts.filter(
  (font) =>
    !after.fonts.some((candidate) => candidate.pathname === font.pathname),
);
assert.equal(report.removedFonts.length, 2);
assert.ok(
  report.removedFonts.every((font) =>
    /noto-sans-sc-(108|119)-/.test(font.pathname),
  ),
);
report.fontResourceBytesSaved =
  before.fontResourceBytes - after.fontResourceBytes;
assert.equal(report.fontResourceBytesSaved, 141352);
report.fontResourceReductionPercent =
  (100 * report.fontResourceBytesSaved) / before.fontResourceBytes;
report.status = "SIX_ORIGINAL_CAPTURES_AND_RESOURCE_REDUCTION_VERIFIED";
report.limitations =
  "Both groups include an individual LCP above 2500ms. Cache state and observed-paint graph cutoffs can differ. Resource-byte reduction is verified; a stable end-to-end speedup, all-request transport pass, formal63 matrix or RUM is not established. Baseline auxiliary cancellations remain recorded.";
await writeFile(
  path.join(output, "comparison-summary-verified.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: report.status,
    originalFiles: report.originalFileCount,
    savedFontResourceBytes: report.fontResourceBytesSaved,
    medianLcpMs: report.groups.map((group) => group.medianLcpMs),
  }),
);
