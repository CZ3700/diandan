#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toleranceMs = 0.000001;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function verifyCaptureBinding({
  lhr,
  artifacts,
  config,
  capturedFiles,
  inputFiles,
}) {
  assert.equal(
    config.url,
    lhr.requestedUrl,
    "configured URL must match the original report",
  );
  assert.equal(
    artifacts.URL.requestedUrl,
    lhr.requestedUrl,
    "captured artifacts must belong to the original navigation",
  );
  assert.deepEqual(
    config.lhrSettings,
    lhr.configSettings,
    "capture config must preserve the exact audited settings",
  );
  assert.deepEqual(
    config.artifactSettings,
    artifacts.settings,
    "capture config must preserve the exact gathered settings",
  );
  let verifiedFiles = 0;
  if (capturedFiles !== undefined || inputFiles !== undefined) {
    assert.ok(
      capturedFiles && inputFiles && Object.keys(inputFiles).length > 0,
    );
    for (const [file, actual] of Object.entries(inputFiles)) {
      const expected = Object.values(capturedFiles).find(
        (entry) => entry.file === file,
      );
      assert.ok(
        expected,
        "every analyzed input must have an original capture fingerprint",
      );
      assert.equal(
        actual.bytes,
        expected.bytes,
        "input byte length must match its original capture",
      );
      assert.equal(
        actual.sha256,
        expected.sha256,
        "input SHA256 must match its original capture",
      );
      verifiedFiles++;
    }
  }
  return {
    matched: true,
    requestedUrlSha256: hash(lhr.requestedUrl),
    verifiedFiles,
  };
}

function resourceIdentity(value) {
  if (typeof value !== "string") return null;
  let file = null;
  try {
    file = path.basename(new globalThis.URL(value).pathname);
  } catch {
    /* Non-URL resources retain only a digest. */
  }
  return { file, urlSha256: hash(value) };
}

/** Exact pinned-model replay is a prerequisite, independent of whether a budget passes. */
export function verifyLanternReplay(lhr, fcp, lcp) {
  const values = [
    ["FCP", "first-contentful-paint", fcp],
    ["LCP", "largest-contentful-paint", lcp],
  ].map(([metric, audit, result]) => {
    const expectedMs = lhr.audits?.[audit]?.numericValue;
    assert.ok(
      Number.isFinite(expectedMs) && Number.isFinite(result?.timing),
      `${metric}: replay and report must be finite`,
    );
    const differenceMs = result.timing - expectedMs;
    assert.ok(
      Math.abs(differenceMs) <= toleranceMs,
      `${metric}: pinned replay does not match its original LHR`,
    );
    return { metric, expectedMs, replayMs: result.timing, differenceMs };
  });
  return { matched: true, toleranceMs, values };
}

function nodeDetails(node, timeOriginUs) {
  const value = {
    id: String(node.id),
    type: node.type,
    observedStartMs: (node.startTime - timeOriginUs) / 1000,
    observedEndMs: (node.endTime - timeOriginUs) / 1000,
    dependencies: node
      .getDependencies()
      .map((dependency) => String(dependency.id))
      .sort(),
  };
  if (node.type === "network") {
    const request = node.request;
    Object.assign(value, {
      resource: resourceIdentity(request.url),
      resourceType: request.resourceType ?? null,
      priority: request.priority ?? null,
      transferSize: request.transferSize ?? null,
      resourceSize: request.resourceSize ?? null,
      initiatorType: request.initiator?.type ?? null,
    });
  } else {
    assert.equal(node.type, "cpu");
    Object.assign(value, {
      event: node.event?.name ?? null,
      pid: node.event?.pid ?? null,
      tid: node.event?.tid ?? null,
      childEventCounts: Object.fromEntries(
        [...new Set(node.childEvents.map((event) => event.name))]
          .sort()
          .map((name) => [
            name,
            node.childEvents.filter((event) => event.name === name).length,
          ]),
      ),
      evaluatedScripts: [
        ...new Set(
          node.childEvents
            .filter((event) => event.name === "EvaluateScript")
            .map((event) => event.args?.data?.url)
            .filter(Boolean),
        ),
      ].map(resourceIdentity),
    });
  }
  return value;
}

/** Preserves all graph edges. A latest-finished dependency chain is not a contention-causality graph. */
export function summarizeLanternSimulation(estimate, { metric, timeOriginUs }) {
  assert.ok(["FCP", "LCP"].includes(metric));
  assert.ok(
    Number.isFinite(estimate.timeInMs) &&
      estimate.nodeTimings instanceof Map &&
      estimate.nodeTimings.size > 0,
  );
  const nodes = [...estimate.nodeTimings].map(([node, timing]) => {
    assert.ok(
      Number.isFinite(timing.startTime) && Number.isFinite(timing.endTime),
    );
    return {
      ...nodeDetails(node, timeOriginUs),
      simulatedStartMs: timing.startTime,
      simulatedEndMs: timing.endTime,
      simulatedDurationMs: timing.endTime - timing.startTime,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  assert.equal(byId.size, nodes.length, "simulation node IDs must be unique");
  for (const node of nodes) {
    const dependencies = node.dependencies.map((id) => {
      assert.ok(
        byId.has(id),
        "all dependencies require actual simulator timings",
      );
      return byId.get(id);
    });
    const latest = Math.max(
      0,
      ...dependencies.map((dependency) => dependency.simulatedEndMs),
    );
    node.latestDependencyIds = dependencies
      .filter(
        (dependency) =>
          Math.abs(dependency.simulatedEndMs - latest) <= toleranceMs,
      )
      .map((dependency) => dependency.id)
      .sort();
    node.waitAfterDependenciesMs = node.simulatedStartMs - latest;
    node.waitAttribution =
      node.waitAfterDependenciesMs > toleranceMs
        ? "UNRESOLVED_SCHEDULER_OR_CONTENTION"
        : "NO_POSITIVE_WAIT_MEASURED";
  }
  const terminals = nodes
    .filter(
      (node) =>
        Math.abs(node.simulatedEndMs - estimate.timeInMs) <= toleranceMs &&
        !(
          metric === "LCP" &&
          node.resourceType === "Image" &&
          ["Low", "VeryLow"].includes(node.priority)
        ),
    )
    .map((node) => node.id)
    .sort();
  assert.ok(
    terminals.length > 0,
    "simulation metric must have an eligible terminal node",
  );
  const terminalDependencyChains = terminals.map((terminal) => {
    const ids = [],
      seen = new Set();
    let id = terminal;
    while (id !== undefined) {
      assert.ok(!seen.has(id), "a dependency cycle cannot be summarized");
      seen.add(id);
      ids.push(id);
      id = byId.get(id).latestDependencyIds[0];
    }
    return {
      terminal,
      ids,
      interpretation:
        "LATEST_FINISHED_EXPLICIT_DEPENDENCY_ONLY; ties are retained on each node; not resource-contention attribution",
    };
  });
  return {
    metric,
    timeInMs: estimate.timeInMs,
    terminals,
    terminalDependencyChains,
    nodes: nodes.sort(
      (left, right) =>
        left.simulatedEndMs - right.simulatedEndMs ||
        left.id.localeCompare(right.id),
    ),
    edges: nodes.flatMap((node) =>
      node.dependencies.map((dependency) => ({
        from: dependency,
        to: node.id,
      })),
    ),
  };
}

const correlationKeys = [
  "nodeId",
  "DOMNodeId",
  "backendNodeId",
  "layerId",
  "layer_id",
  "layerTreeId",
  "frame",
  "frameId",
  "frame_token",
  "frameToken",
  "frame_sequence",
  "frameSequenceNumber",
  "sequence_id",
  "sequenceId",
  "surface_frame_trace_id",
  "navigationId",
];
function safeEvent(event, timeOriginUs, association) {
  const correlation = {};
  for (const key of correlationKeys) {
    const value = event.args?.data?.[key] ?? event.args?.[key];
    if (["number", "string", "boolean"].includes(typeof value))
      correlation[key] = value;
  }
  return {
    name: event.name,
    phase: event.ph ?? null,
    pid: event.pid,
    tid: event.tid,
    startMs: (event.ts - timeOriginUs) / 1000,
    durationMs: Number.isFinite(event.dur) ? event.dur / 1000 : null,
    association,
    correlation,
  };
}

/** Observed events remain explicitly separate from the counterfactual simulated graph. */
export function summarizeObservedPaint({
  trace,
  processedTrace,
  navigation,
  topLevelTasks,
}) {
  const timeOriginUs = processedTrace.timeOriginEvt.ts;
  const lcp = navigation.largestContentfulPaintEvt;
  assert.ok(
    lcp && Number.isFinite(lcp.ts),
    "the official selected navigation must have an LCP event",
  );
  const nodeId = lcp.args?.data?.nodeId ?? null;
  const endUs = lcp.ts + 250_000;
  const events = trace.traceEvents
    .filter((event) => event.ts >= timeOriginUs && event.ts <= endUs)
    .sort((left, right) => left.ts - right.ts);
  const imageCandidates = events.filter(
    (event) =>
      event.name === "LargestImagePaint::Candidate" &&
      event.pid === lcp.pid &&
      nodeId !== null &&
      event.args?.data?.DOMNodeId === nodeId &&
      event.ts <= lcp.ts,
  );
  const imageUrl = imageCandidates.at(-1)?.args?.data?.imageUrl;
  const matchedImagePaintEvents = events
    .filter((event) => event.pid === lcp.pid && event.name === "PaintImage")
    .flatMap((event) => {
      const nodeMatches =
        nodeId !== null &&
        [
          event.args?.data?.nodeId,
          event.args?.data?.DOMNodeId,
          event.args?.data?.backendNodeId,
        ].includes(nodeId);
      const urlMatches =
        typeof imageUrl === "string" &&
        [event.args?.data?.url, event.args?.data?.imageUrl].includes(imageUrl);
      if (!nodeMatches && !urlMatches) return [];
      return [
        {
          ...safeEvent(
            event,
            timeOriginUs,
            nodeMatches
              ? "MATCHED_LCP_PROCESS_AND_NODE"
              : "URL_ONLY_POSSIBLY_OTHER_NODE_USING_SAME_IMAGE",
          ),
          nodeMatches,
          urlMatches,
        },
      ];
    });
  const renderEvent = (event) =>
    /(?:RasterTask|ActivateLayerTree|DrawFrame|SubmitCompositorFrame|Presentation|Presented|FrameDisplayed|DrawAndSwap|DroppedFrame|PipelineReporter|Visibility|WasShown|WasHidden|Decode Image|ImageDecodeTask)/u.test(
      event.name,
    );
  const nearbyRendererEvents = events
    .filter((event) => event.pid === lcp.pid && renderEvent(event))
    .map((event) =>
      safeEvent(event, timeOriginUs, "SAME_RENDERER_UNLINKED_TO_IMAGE"),
    );
  const otherProcessEvents = events
    .filter((event) => event.pid !== lcp.pid && renderEvent(event))
    .map((event) =>
      safeEvent(event, timeOriginUs, "OTHER_PROCESS_UNLINKED_TO_IMAGE"),
    );
  return {
    timeOriginUs,
    mainFrame: processedTrace.mainFrameInfo,
    selectedLcp: safeEvent(
      lcp,
      timeOriginUs,
      "OFFICIAL_PROCESSED_NAVIGATION_SELECTION",
    ),
    observedTimingsMs: navigation.timings,
    imageIdentity: resourceIdentity(imageUrl),
    imageCandidates: imageCandidates.map((event) =>
      safeEvent(event, timeOriginUs, "MATCHED_LCP_PROCESS_AND_NODE"),
    ),
    matchedImagePaintEvents,
    nearbyRendererEvents,
    otherProcessEvents,
    topLevelTasks: topLevelTasks.filter(
      (task) => task.end >= 0 && task.start <= (endUs - timeOriginUs) / 1000,
    ),
    eventWindow: { startMs: 0, endMs: (endUs - timeOriginUs) / 1000 },
    compositorCause: "UNKNOWN",
    limitations:
      "Only node/process/URL matches associate PaintImage. Renderer or global raster/frame/visibility events are proximity evidence, not image causality. Missing trace events do not prove absence of work, continuous visibility or compositor idleness.",
  };
}

export async function analyzeGiftTraceRun({
  lhr,
  artifacts,
  trace,
  devtoolsLog,
  config,
  capturedFiles,
  inputFiles,
}) {
  const binding = verifyCaptureBinding({
    lhr,
    artifacts,
    config,
    capturedFiles,
    inputFiles,
  });
  assert.equal(lhr.lighthouseVersion, "13.4.1");
  const { default: installed } = await import("lighthouse/package.json", {
    with: { type: "json" },
  });
  assert.equal(
    installed.version,
    lhr.lighthouseVersion,
    "installed replay engine must equal the captured exact Lighthouse version",
  );
  assert.equal(lhr.configSettings.throttlingMethod, "simulate");
  assert.equal(
    config.internalLanternUseTracePresent,
    false,
    "capture must use the pinned default DevtoolsLog graph source",
  );
  assert.equal(
    process.env.INTERNAL_LANTERN_USE_TRACE,
    undefined,
    "offline process must not switch Lantern graph sources",
  );
  assert.deepEqual(
    trace,
    artifacts.Trace,
    "standalone trace must match the complete captured artifacts",
  );
  assert.deepEqual(
    devtoolsLog,
    artifacts.DevtoolsLog,
    "standalone DevTools log must match captured artifacts",
  );
  assert.equal(
    artifacts.settings.throttlingMethod,
    lhr.configSettings.throttlingMethod,
    "captured gather and audit methods must agree",
  );
  assert.deepEqual(
    artifacts.settings.throttling,
    lhr.configSettings.throttling,
    "captured gather and audit throttling must agree",
  );
  assert.equal(artifacts.GatherContext.gatherMode, "navigation");
  assert.equal(
    lhr.audits["storefront-content"].score,
    1,
    "trace only describes a valid same-navigation gift page",
  );
  const [
    { FirstContentfulPaint },
    { LargestContentfulPaint },
    { ProcessedTrace },
    { ProcessedNavigation },
    { NetworkRecords },
    { TraceProcessor },
  ] = await Promise.all([
    import("lighthouse/core/computed/metrics/first-contentful-paint.js"),
    import("lighthouse/core/computed/metrics/largest-contentful-paint.js"),
    import("lighthouse/core/computed/processed-trace.js"),
    import("lighthouse/core/computed/processed-navigation.js"),
    import("lighthouse/core/computed/network-records.js"),
    import("lighthouse/core/lib/tracehouse/trace-processor.js"),
  ]);
  const data = {
    trace,
    devtoolsLog,
    gatherContext: artifacts.GatherContext,
    settings: lhr.configSettings,
    URL: artifacts.URL,
    SourceMaps: artifacts.SourceMaps,
    HostDPR: artifacts.HostDPR,
    simulator: null,
  };
  const context = { computedCache: new Map() };
  const fcp = await FirstContentfulPaint.request(data, context);
  const lcp = await LargestContentfulPaint.request(data, context);
  const equivalence = verifyLanternReplay(lhr, fcp, lcp);
  const processedTrace = await ProcessedTrace.request(trace, context);
  const navigation = await ProcessedNavigation.request(trace, context);
  const metrics = lhr.audits.metrics.details.items[0];
  assert.equal(
    Math.round(navigation.timings.firstContentfulPaint),
    metrics.observedFirstContentfulPaint,
    "official observed FCP rounds to the original audit value",
  );
  assert.equal(
    Math.round(navigation.timings.largestContentfulPaint),
    metrics.observedLargestContentfulPaint,
    "official observed LCP rounds to the original audit value",
  );
  const observed = summarizeObservedPaint({
    trace,
    processedTrace,
    navigation,
    topLevelTasks: TraceProcessor.getMainThreadTopLevelEvents(processedTrace),
  });
  const records = await NetworkRecords.request(devtoolsLog, context);
  observed.imageNetworkRequests = records
    .filter(
      (request) =>
        resourceIdentity(request.url)?.urlSha256 ===
        observed.imageIdentity?.urlSha256,
    )
    .map((request) => ({
      resource: resourceIdentity(request.url),
      requestId: request.requestId,
      resourceType: request.resourceType,
      startMs: request.rendererStartTime - observed.timeOriginUs / 1000,
      endMs: request.networkEndTime - observed.timeOriginUs / 1000,
      transferSize: request.transferSize,
      resourceSize: request.resourceSize,
      finished: request.finished,
      statusCode: request.statusCode,
    }));
  const simulated = {};
  for (const [metric, result] of [
    ["FCP", fcp],
    ["LCP", lcp],
  ])
    simulated[metric] = {
      timing: result.timing,
      optimistic: summarizeLanternSimulation(result.optimisticEstimate, {
        metric,
        timeOriginUs: observed.timeOriginUs,
      }),
      pessimistic: summarizeLanternSimulation(result.pessimisticEstimate, {
        metric,
        timeOriginUs: observed.timeOriginUs,
      }),
    };
  return {
    schemaVersion: 1,
    status: "REPLAY_MATCHED",
    lighthouseVersion: lhr.lighthouseVersion,
    graphSource: "PINNED_DEFAULT_DEVTOOLS_LOG",
    binding,
    equivalence,
    observed,
    simulated,
    performanceAcceptance: false,
  };
}

async function main() {
  assert.equal(
    process.argv.length,
    6,
    "usage: --input <capture directory> --output <new analysis directory>",
  );
  assert.equal(process.argv[2], "--input");
  assert.equal(process.argv[4], "--output");
  const input = path.resolve(process.argv[3]),
    output = path.resolve(process.argv[5]);
  await mkdir(output, { recursive: false });
  const capture = JSON.parse(
    await readFile(path.join(input, "results.json"), "utf8"),
  );
  assert.equal(capture.schemaVersion, 1);
  assert.equal(
    capture.attempts.length,
    3,
    "the fixed capture group must retain exactly three attempts",
  );
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    input,
    generatedAt: new Date().toISOString(),
    runs: [],
    performanceAcceptance: false,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const name = `zh-CN-gift-mobile-${attempt}`;
    try {
      const filenames = {
        lhr: `${name}.json`,
        trace: `${name}-trace.json`,
        devtoolsLog: `${name}-devtools.json`,
        artifacts: `${name}-artifacts.json`,
        config: `${name}-config.json`,
      };
      const values = {},
        fingerprints = {},
        inputFiles = {};
      for (const [key, file] of Object.entries(filenames)) {
        const bytes = await readFile(path.join(input, file));
        values[key] = JSON.parse(bytes.toString());
        fingerprints[file] = hash(bytes);
        inputFiles[file] = { bytes: bytes.length, sha256: fingerprints[file] };
      }
      const capturedAttempt = capture.attempts.find(
        (entry) => entry.name === name,
      );
      assert.ok(
        capturedAttempt && capturedAttempt.failure === null,
        "only a retained valid captured navigation can be replayed",
      );
      Object.assign(values, {
        inputFiles,
        capturedFiles: capturedAttempt.files,
      });
      const result = await analyzeGiftTraceRun(values);
      await writeFile(
        path.join(output, `${name}-analysis.json`),
        JSON.stringify({ ...result, inputSha256: fingerprints }, null, 2) +
          "\n",
        { flag: "wx" },
      );
      report.runs.push({
        name,
        status: result.status,
        equivalence: result.equivalence,
      });
    } catch (error) {
      report.runs.push({
        name,
        status: "FAIL",
        failure: {
          name: error?.name,
          assertion: error?.name === "AssertionError" ? error.message : null,
        },
      });
    }
    await writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  report.status = report.runs.every((run) => run.status === "REPLAY_MATCHED")
    ? "ALL_REPLAYS_MATCHED"
    : "FAIL";
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ status: report.status, runs: report.runs.length, output }),
  );
  if (report.status === "FAIL") process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  await main();
