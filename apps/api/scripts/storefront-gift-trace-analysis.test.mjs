import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyLanternReplay,
  summarizeLanternSimulation,
  summarizeObservedPaint,
  verifyCaptureBinding,
} from "./storefront-gift-trace-analysis.mjs";

test("binds captured URL/settings and immutable file fingerprints before replay", () => {
  const settings = { throttlingMethod: "simulate" };
  const lhr = {
    requestedUrl: "http://localhost:3456/zh-CN/gifts/fixture",
    configSettings: settings,
  };
  const artifacts = { URL: { requestedUrl: lhr.requestedUrl }, settings };
  const config = {
    url: lhr.requestedUrl,
    lhrSettings: settings,
    artifactSettings: settings,
  };
  assert.equal(verifyCaptureBinding({ lhr, artifacts, config }).matched, true);
  assert.throws(() =>
    verifyCaptureBinding({
      lhr,
      artifacts,
      config: { ...config, url: "http://localhost:3456/different" },
    }),
  );
  assert.throws(() =>
    verifyCaptureBinding({
      lhr,
      artifacts: {
        ...artifacts,
        URL: { requestedUrl: "http://localhost:3456/different" },
      },
      config,
    }),
  );
  assert.throws(() =>
    verifyCaptureBinding({
      lhr,
      artifacts,
      config: { ...config, lhrSettings: { throttlingMethod: "provided" } },
    }),
  );
  const capturedFiles = {
    ".json": { file: "sample.json", bytes: 12, sha256: "a".repeat(64) },
  };
  const inputFiles = { "sample.json": { bytes: 12, sha256: "a".repeat(64) } };
  assert.equal(
    verifyCaptureBinding({ lhr, artifacts, config, capturedFiles, inputFiles })
      .verifiedFiles,
    1,
  );
  assert.throws(() =>
    verifyCaptureBinding({
      lhr,
      artifacts,
      config,
      capturedFiles,
      inputFiles: {
        "sample.json": { ...inputFiles["sample.json"], sha256: "b".repeat(64) },
      },
    }),
  );
});

function node(id, type, dependencies = [], extras = {}) {
  return {
    id,
    type,
    startTime: 1_000_000,
    endTime: 1_010_000,
    getDependencies: () => dependencies,
    ...extras,
  };
}

test("replay equivalence refuses missing and numerically different FCP/LCP instead of reporting a graph as authoritative", () => {
  const lhr = {
    audits: {
      "first-contentful-paint": { numericValue: 1000 },
      "largest-contentful-paint": { numericValue: 1500 },
    },
  };
  assert.equal(
    verifyLanternReplay(lhr, { timing: 1000 }, { timing: 1500 }).matched,
    true,
  );
  assert.throws(() =>
    verifyLanternReplay(lhr, { timing: 1000.01 }, { timing: 1500 }),
  );
  assert.throws(() =>
    verifyLanternReplay(lhr, { timing: NaN }, { timing: 1500 }),
  );
});

test("serializes every simulated dependency and distinguishes latest dependency from resource contention", () => {
  const document = node("doc", "network", [], {
    request: {
      url: "http://localhost:3456/zh-CN/gifts/fixture?private=canary",
      resourceType: "Document",
      transferSize: 123,
    },
  });
  const css = node("css", "network", [document], {
    request: {
      url: "http://localhost:3456/_next/static/chunks/style.css",
      resourceType: "Stylesheet",
      transferSize: 456,
    },
  });
  const cpu = node("cpu", "cpu", [document, css], {
    event: { name: "RunTask", pid: 1, tid: 2 },
    childEvents: [{ name: "Layout" }],
  });
  const simulation = {
    timeInMs: 1200,
    nodeTimings: new Map([
      [document, { startTime: 0, endTime: 100 }],
      [css, { startTime: 100, endTime: 900 }],
      [cpu, { startTime: 1100, endTime: 1200 }],
    ]),
  };
  const result = summarizeLanternSimulation(simulation, {
    metric: "FCP",
    timeOriginUs: 1_000_000,
  });
  assert.equal(result.nodes.length, 3);
  assert.deepEqual(result.terminals, ["cpu"]);
  assert.deepEqual(result.terminalDependencyChains[0].ids, [
    "cpu",
    "css",
    "doc",
  ]);
  assert.equal(
    result.nodes.find((value) => value.id === "cpu").waitAfterDependenciesMs,
    200,
  );
  assert.equal(
    result.nodes.find((value) => value.id === "cpu").waitAttribution,
    "UNRESOLVED_SCHEDULER_OR_CONTENTION",
  );
  assert.equal(JSON.stringify(result).includes("canary"), false);
});

test("LCP terminal selection excludes low priority images and rejects absent dependency timings", () => {
  const doc = node("doc", "network", [], {
    request: { resourceType: "Document" },
  });
  const image = node("offscreen", "network", [doc], {
    request: { resourceType: "Image", priority: "Low" },
  });
  const result = summarizeLanternSimulation(
    {
      timeInMs: 100,
      nodeTimings: new Map([
        [doc, { startTime: 0, endTime: 100 }],
        [image, { startTime: 100, endTime: 300 }],
      ]),
    },
    { metric: "LCP", timeOriginUs: 1_000_000 },
  );
  assert.deepEqual(result.terminals, ["doc"]);
  assert.equal(result.nodes.length, 2);
  assert.throws(() =>
    summarizeLanternSimulation(
      {
        timeInMs: 300,
        nodeTimings: new Map([[image, { startTime: 100, endTime: 300 }]]),
      },
      { metric: "FCP", timeOriginUs: 1_000_000 },
    ),
  );
});

test("observed evidence follows the selected LCP node and process without claiming unlinked raster causality", () => {
  const event = (name, ts, pid, data = {}, extra = {}) => ({
    name,
    ts,
    pid,
    tid: 10,
    args: { data },
    ...extra,
  });
  const lcp = event(
    "largestContentfulPaint::Candidate",
    1_500_000,
    1,
    { nodeId: 42, navigationId: "nav" },
    { args: { frame: "main", data: { nodeId: 42, navigationId: "nav" } } },
  );
  const trace = {
    traceEvents: [
      event("LargestImagePaint::Candidate", 1_490_000, 1, {
        DOMNodeId: 42,
        imageUrl: "http://localhost:3456/image?private=canary",
      }),
      event("LargestImagePaint::Candidate", 1_499_000, 2, {
        DOMNodeId: 42,
        imageUrl: "http://localhost:3456/other",
      }),
      event("PaintImage", 1_200_000, 1, { nodeId: 42 }),
      event("PaintImage", 1_210_000, 2, { nodeId: 42 }),
      event("RasterTask", 1_490_000, 1, { layerId: 99 }),
      event("DroppedFrame", 1_495_000, 5),
      lcp,
    ],
  };
  const result = summarizeObservedPaint({
    trace,
    processedTrace: {
      mainFrameInfo: { frameId: "main", pid: 1, tid: 10 },
      timeOriginEvt: { ts: 1_000_000 },
    },
    navigation: {
      largestContentfulPaintEvt: lcp,
      timings: { firstContentfulPaint: 500, largestContentfulPaint: 500 },
    },
    topLevelTasks: [{ start: 200, end: 240, duration: 40 }],
  });
  assert.equal(result.matchedImagePaintEvents.length, 1);
  assert.equal(result.matchedImagePaintEvents[0].pid, 1);
  assert.equal(
    result.nearbyRendererEvents.find((value) => value.name === "RasterTask")
      .association,
    "SAME_RENDERER_UNLINKED_TO_IMAGE",
  );
  assert.equal(
    result.otherProcessEvents.find((value) => value.name === "DroppedFrame")
      .association,
    "OTHER_PROCESS_UNLINKED_TO_IMAGE",
  );
  assert.equal(result.compositorCause, "UNKNOWN");
  assert.equal(JSON.stringify(result).includes("canary"), false);
});
