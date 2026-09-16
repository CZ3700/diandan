import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, URL } from "node:url";

const require = createRequire(import.meta.url);
const lighthouseRoot = path.dirname(require.resolve("lighthouse/package.json"));
const load = (relative) =>
  import(pathToFileURL(path.join(lighthouseRoot, relative)).href);
const { LanternFirstContentfulPaint } = await load(
  "core/computed/metrics/lantern-first-contentful-paint.js",
);
const { LanternLargestContentfulPaint } = await load(
  "core/computed/metrics/lantern-largest-contentful-paint.js",
);
const { getComputationDataParams } = await load(
  "core/computed/metrics/lantern-metric.js",
);

function summarizeEstimate(estimate, navigationStart) {
  const nodes = [...estimate.nodeTimings].map(([node, timing]) => ({
    id: node.id,
    type: node.type,
    ...(node.type === "network"
      ? {
          asset: new URL(node.request.url).pathname,
          resourceType: node.request.resourceType,
          priority: node.request.priority,
          transferSize: node.request.transferSize,
        }
      : { eventName: node.event.name }),
    observedStartMs: (node.startTime - navigationStart) / 1000,
    observedEndMs: (node.endTime - navigationStart) / 1000,
    dependencies: node.getDependencies().map((dependency) => dependency.id),
    simulated: timing,
  }));
  nodes.sort((a, b) => b.simulated.endTime - a.simulated.endTime);
  return {
    timeInMs: estimate.timeInMs,
    // LCP excludes low-priority images from its estimate, so raw last nodes
    // and nodes matching the actual estimate are retained separately.
    estimateTerminalIds: nodes
      .filter((node) => node.simulated.endTime === estimate.timeInMs)
      .map((node) => node.id),
    nodes,
  };
}

export async function verifyRetainedNavigation(directory, stem) {
  assert.match(stem, /^(en|ja|zh-CN)-(home|artist|gift)-mobile-[1-3]$/);
  const sources = [];
  const read = async (suffix) => {
    const filename = `${stem}${suffix}`;
    const buffer = await readFile(path.join(directory, filename));
    sources.push({
      file: filename,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    });
    return JSON.parse(buffer.toString("utf8"));
  };
  const lhr = await read(".json");
  const inputs = await read(".lantern-inputs.json");
  const trace = await read(".trace.json");
  const devtoolsLog = await read(".devtoolslog.json");
  assert.equal(lhr.lighthouseVersion, "13.4.1");
  assert.equal(lhr.configSettings.throttlingMethod, "simulate");
  assert.deepEqual(inputs.settings, lhr.configSettings);
  assert.deepEqual(inputs.SourceMaps, []);
  assert.equal(inputs.sourceMapsSummary.count, 0);
  assert.equal(inputs.GatherContext.gatherMode, "navigation");
  const data = {
    trace,
    devtoolsLog,
    gatherContext: inputs.GatherContext,
    URL: inputs.URL,
    HostDPR: inputs.HostDPR,
    SourceMaps: inputs.SourceMaps,
    settings: inputs.settings,
    simulator: null,
  };
  const context = { computedCache: new Map() };
  const { graph, processedNavigation } = await getComputationDataParams(
    data,
    context,
  );
  const fcp = await LanternFirstContentfulPaint.request(data, context);
  const lcp = await LanternLargestContentfulPaint.request(data, context);
  const timestamps = processedNavigation.timestamps;
  const originalMetrics = lhr.audits.metrics.details.items[0];
  const navigationStart = originalMetrics.observedNavigationStartTs;
  const metrics = {};
  for (const [name, metric, audit] of [
    ["fcp", fcp, "first-contentful-paint"],
    ["lcp", lcp, "largest-contentful-paint"],
  ]) {
    const observedKey = name === "fcp" ? "First" : "Largest";
    const timestampKey =
      name === "fcp" ? "firstContentfulPaint" : "largestContentfulPaint";
    const originalTimestamp =
      originalMetrics[`observed${observedKey}ContentfulPaintTs`];
    metrics[name] = {
      originalSimulatedMs: lhr.audits[audit].numericValue,
      recomputedSimulatedMs: metric.timing,
      exactSimulationMatch: metric.timing === lhr.audits[audit].numericValue,
      observedTimestampUs: timestamps[timestampKey],
      originalObservedTimestampUs: originalTimestamp,
      exactObservedMatch: timestamps[timestampKey] === originalTimestamp,
      observedMs: (timestamps[timestampKey] - navigationStart) / 1000,
      optimistic: summarizeEstimate(metric.optimisticEstimate, navigationStart),
      pessimistic: summarizeEstimate(
        metric.pessimisticEstimate,
        navigationStart,
      ),
    };
  }
  const fonts = [];
  graph.traverse((node) => {
    if (node.type !== "network" || node.request.resourceType !== "Font") return;
    fonts.push({
      id: node.id,
      asset: new URL(node.request.url).pathname,
      transferSize: node.request.transferSize,
      rawStartTimestampUs: node.startTime,
      rawEndTimestampUs: node.endTime,
      observedEndMs: (node.endTime - navigationStart) / 1000,
      priority: node.request.priority,
      initiatorType: node.initiatorType,
      hasRenderBlockingPriority: node.hasRenderBlockingPriority(),
      lcpCutoffEligible:
        node.startTime <= timestamps.largestContentfulPaint &&
        node.endTime <= timestamps.largestContentfulPaint,
      fcpCutoffEligible:
        node.startTime <= timestamps.firstContentfulPaint &&
        node.endTime <= timestamps.firstContentfulPaint,
      membership: Object.fromEntries(
        Object.entries(metrics).map(([name, metric]) => [
          name,
          Object.fromEntries(
            ["optimistic", "pessimistic"].map((estimate) => [
              estimate,
              metric[estimate].nodes.some((item) => item.id === node.id),
            ]),
          ),
        ]),
      ),
    });
  });
  return {
    stem,
    sources,
    contentValid: lhr.audits["storefront-content"]?.score === 1,
    runtimeErrorPresent: Boolean(lhr.runtimeError),
    status: Object.values(metrics).every(
      (metric) => metric.exactSimulationMatch && metric.exactObservedMatch,
    )
      ? "EXACT_OFFICIAL_REPLAY"
      : "REPLAY_MISMATCH_DO_NOT_INTERPRET",
    metrics,
    fonts,
  };
}

async function main() {
  assert.equal(
    process.env.INTERNAL_LANTERN_USE_TRACE,
    undefined,
    "use the collected default DevTools graph, never switch algorithms",
  );
  const [directoryArgument, outputArgument, ...stems] = process.argv.slice(2);
  assert.ok(directoryArgument && outputArgument && stems.length);
  assert.equal(new Set(stems).size, stems.length);
  const installedPackage = JSON.parse(
    await readFile(path.join(lighthouseRoot, "package.json"), "utf8"),
  );
  assert.equal(installedPackage.version, "13.4.1");
  const directory = path.resolve(directoryArgument);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    lighthouseVersion: installedPackage.version,
    graphMode: "default DevTools graph with preserved trace paint timestamps",
    inputDirectory: directory,
    scope:
      "Offline official Lighthouse 13.4.1 default DevTools graph replay from preserved trace, log and exact settings; no new navigation, counterfactual, budget or metric change. Graph membership is inspectable only after exact original metric and observed timestamp agreement.",
    runs: [],
  };
  for (const stem of stems) {
    const run = await verifyRetainedNavigation(directory, stem);
    report.runs.push(run);
    console.log(JSON.stringify({ stem, status: run.status }));
  }
  await writeFile(
    path.resolve(outputArgument),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  assert.ok(
    report.runs.every((run) => run.status === "EXACT_OFFICIAL_REPLAY"),
    "preserved replay mismatch; do not interpret its graph",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
