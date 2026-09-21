#!/usr/bin/env node
// Offline summary of this checkpoint's fixed H1/H2/H2/H1 groups. No capture or replay.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  verifyCaptureBinding,
  verifyLanternReplay,
} from "../../../apps/api/scripts/storefront-gift-trace-analysis.mjs";
import { summarizeGiftReadWindow } from "../../../apps/api/scripts/storefront-gift-read-verification.mjs";

const checkpoint = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(checkpoint, "../../..");
const groups = [
  { name: "h1-a", protocol: "http/1.1", httpVersion: "1.1" },
  { name: "h2-a", protocol: "h2", httpVersion: "2.0" },
  { name: "h2-b", protocol: "h2", httpVersion: "2.0" },
  { name: "h1-b", protocol: "http/1.1", httpVersion: "1.1" },
];
const names = [1, 2, 3].map((number) => `zh-CN-gift-mobile-${number}`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const median = (values) => [...values].sort((a, b) => a - b)[1];
const failure = (error) => ({ name: error.name, message: error.message });

function inputPath(value) {
  assert.equal(typeof value, "string", "input path must be explicit");
  const resolved = path.resolve(workspace, value);
  assert.ok(
    resolved.startsWith(workspace + path.sep),
    "input must be in workspace",
  );
  return resolved;
}

async function readJson(filename) {
  const bytes = await readFile(filename);
  return { value: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) };
}

function resource(url) {
  const parsed = new URL(url);
  return {
    file: path.basename(parsed.pathname),
    pathname: parsed.pathname,
    querySha256: sha256(parsed.search),
    urlSha256: sha256(url),
  };
}

function header(headers, name) {
  return (
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ??
    null
  );
}

function verifyGroupTransport(entry, expected, origin) {
  assert.equal(
    entry.name,
    expected.name,
    "transport group order must be fixed",
  );
  assert.equal(
    entry.protocol,
    expected.protocol,
    "declared group protocol must match",
  );
  assert.equal(
    entry.status,
    "COLLECTED",
    "failed transport group must remain failed",
  );
  assert.equal(
    entry.actualCollectedNavigations,
    3,
    "each transport group must actually collect three navigations",
  );
  const tls = entry.tls;
  assert.equal(
    tls.authorizedByExplicitTestCa,
    true,
    "explicit test CA validation is required",
  );
  assert.equal(
    tls.alpnProtocol,
    expected.protocol,
    "TLS probe ALPN must match",
  );
  assert.ok(
    ["TLSv1.2", "TLSv1.3"].includes(tls.tlsVersion),
    "unknown TLS version",
  );
  assert.match(
    tls.certificateSha256,
    digestPattern,
    "certificate digest is required",
  );
  assert.equal(
    tls.hostname,
    new URL(origin).hostname,
    "TLS probe hostname must match viewer",
  );
  assert.equal(
    tls.browserSystemTrustClaimed,
    false,
    "do not claim browser system trust",
  );
  assert.equal(
    tls.browserUsesExistingTestSpkiException,
    true,
    "retain actual browser trust scope",
  );
  assert.equal(tls.pageRequests, 0, "TLS probe must not warm a page");
  assert.ok(
    Array.isArray(entry.requests) && entry.requests.length > 0,
    "server requests required",
  );
  assert.ok(
    Number.isSafeInteger(entry.requestOffset) && entry.requestOffset >= 0,
  );
  assert.equal(
    entry.requestEnd - entry.requestOffset,
    entry.requests.length,
    "server slice length must match",
  );
  const ids = new Set();
  for (const request of entry.requests) {
    assert.ok(
      typeof request.id === "string" || Number.isSafeInteger(request.id),
      "unknown request ID",
    );
    assert.ok(
      !ids.has(request.id),
      "server request IDs must be unique within group",
    );
    ids.add(request.id);
    assert.equal(
      request.alpnProtocol,
      expected.protocol,
      "every server request ALPN must match",
    );
    assert.equal(
      request.httpVersion,
      expected.httpVersion,
      "server HTTP version must match ALPN",
    );
    assert.equal(
      request.complete,
      true,
      "incomplete server responses must not be hidden",
    );
    assert.equal(
      request.failure,
      null,
      "failed server responses must not be hidden",
    );
    assert.equal(typeof request.method, "string");
    assert.equal(typeof request.path, "string");
    assert.ok(
      request.path.startsWith("/") && !request.path.includes("?"),
      "server path must be pathname only",
    );
    assert.ok(
      Number.isInteger(request.status) &&
        request.status >= 100 &&
        request.status <= 599,
    );
    assert.ok(
      request.contentEncoding === null ||
        typeof request.contentEncoding === "string",
      "unknown content encoding field",
    );
    assert.ok(
      Number.isSafeInteger(request.byteLength) && request.byteLength >= 0,
    );
    assert.match(
      request.sha256,
      digestPattern,
      "server entity hash is required",
    );
    assert.ok(
      typeof request.startedAt === "string" &&
        typeof request.finishedAt === "string",
      "request timestamps must be date strings",
    );
    assert.ok(
      Number.isFinite(Date.parse(request.startedAt)) &&
        Number.isFinite(Date.parse(request.finishedAt)),
      "request timestamps are required",
    );
    assert.ok(
      Date.parse(request.finishedAt) >= Date.parse(request.startedAt),
      "request completion predates start",
    );
  }
  return {
    scope:
      "GROUP_LEVEL_TLS_PROBE_AND_ALL_SERVER_REQUESTS; no per-sample TLS connection binding",
    tls,
    requestOffset: entry.requestOffset,
    requestEnd: entry.requestEnd,
    requestCount: entry.requests.length,
    actualAlpnProtocols: [
      ...new Set(entry.requests.map((request) => request.alpnProtocol)),
    ].sort(),
    actualHttpVersions: [
      ...new Set(entry.requests.map((request) => request.httpVersion)),
    ].sort(),
  };
}

function serverEntities(entry) {
  const paths = new Map();
  for (const request of entry.requests) {
    if (
      !request.path.startsWith("/_next/static/") &&
      request.path !== "/_next/image"
    )
      continue;
    const row = paths.get(request.path) ?? {
      pathname: request.path,
      variants: new Map(),
      excludedRequests: [],
    };
    if (request.method === "GET" && request.status === 200) {
      const entity = {
        sha256: request.sha256,
        byteLength: request.byteLength,
        contentEncoding: request.contentEncoding,
      };
      const key = JSON.stringify(entity);
      const variant = row.variants.get(key) ?? { ...entity, requestIds: [] };
      variant.requestIds.push(request.id);
      row.variants.set(key, variant);
    } else {
      row.excludedRequests.push({
        id: request.id,
        method: request.method,
        status: request.status,
      });
    }
    paths.set(request.path, row);
  }
  return [...paths.values()]
    .sort((a, b) => a.pathname.localeCompare(b.pathname))
    .map((row) => ({
      pathname: row.pathname,
      variants: [...row.variants.values()].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
      excludedRequests: row.excludedRequests,
    }));
}

function summarizeGraph(graph) {
  assert.ok(
    Number.isFinite(graph.timeInMs),
    "replay graph timing must be finite",
  );
  assert.ok(
    Array.isArray(graph.nodes) && graph.nodes.length > 0,
    "replay graph nodes required",
  );
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  assert.equal(byId.size, graph.nodes.length, "duplicate replay graph node");
  const compact = (node) => {
    assert.ok(node, "referenced replay graph node missing");
    for (const key of [
      "observedStartMs",
      "observedEndMs",
      "simulatedStartMs",
      "simulatedEndMs",
      "simulatedDurationMs",
      "waitAfterDependenciesMs",
    ]) {
      assert.ok(Number.isFinite(node[key]), `graph ${key} must be finite`);
    }
    return Object.fromEntries(
      [
        "id",
        "type",
        "resource",
        "resourceType",
        "priority",
        "transferSize",
        "resourceSize",
        "observedStartMs",
        "observedEndMs",
        "simulatedStartMs",
        "simulatedEndMs",
        "simulatedDurationMs",
        "dependencies",
        "latestDependencyIds",
        "waitAfterDependenciesMs",
        "waitAttribution",
      ]
        .filter((key) => node[key] !== undefined)
        .map((key) => [key, node[key]]),
    );
  };
  const fonts = graph.nodes.filter((node) => node.resourceType === "Font");
  assert.ok(
    fonts.every(
      (node) => Number.isFinite(node.transferSize) && node.transferSize >= 0,
    ),
    "font transfer bytes must be finite",
  );
  return {
    timeInMs: graph.timeInMs,
    fontCount: fonts.length,
    fontTransferBytes: sum(fonts.map((node) => node.transferSize)),
    fontSet: fonts
      .map((node) => node.resource)
      .sort((a, b) => a.urlSha256.localeCompare(b.urlSha256)),
    terminals: graph.terminals.map((id) => compact(byId.get(id))),
    terminalDependencyChains: graph.terminalDependencyChains.map((chain) => {
      const nodes = chain.ids.map((id) => compact(byId.get(id)));
      const decompositionTotalMs = sum(
        nodes.map(
          (node) => node.simulatedDurationMs + node.waitAfterDependenciesMs,
        ),
      );
      assert.ok(
        Math.abs(
          decompositionTotalMs - byId.get(chain.terminal).simulatedEndMs,
        ) <= 0.000001,
        "chain decomposition must reach terminal time",
      );
      return {
        terminal: chain.terminal,
        interpretation: chain.interpretation,
        decompositionTotalMs,
        nodes,
      };
    }),
    networkNodes: graph.nodes
      .filter((node) => node.type === "network")
      .map(compact),
    cpuNodeCount: graph.nodes.filter((node) => node.type === "cpu").length,
    cpuDurationSumMs: sum(
      graph.nodes
        .filter((node) => node.type === "cpu")
        .map((node) => node.simulatedDurationMs),
    ),
  };
}

async function summarizeSample(
  group,
  captured,
  name,
  origin,
  expectedProtocol,
  capturedUrl,
) {
  assert.equal(captured.name, name, "capture sample order must be fixed");
  assert.equal(captured.failure, null, "failed capture must remain failed");
  const buffers = new Map();
  for (const record of Object.values(captured.files)) {
    assert.equal(
      path.basename(record.file),
      record.file,
      "capture file must be a basename",
    );
    assert.ok(!buffers.has(record.file), "duplicate captured filename");
    const bytes = await readFile(
      path.join(inputPath(group.captureDirectory), record.file),
    );
    assert.equal(
      bytes.length,
      record.bytes,
      "original capture byte length changed",
    );
    assert.equal(
      sha256(bytes),
      record.sha256,
      "original capture digest changed",
    );
    buffers.set(record.file, bytes);
  }
  const readCaptured = (suffix) => {
    const bytes = buffers.get(name + suffix);
    assert.ok(bytes, `missing captured ${suffix}`);
    return bytes;
  };
  const lhr = JSON.parse(readCaptured(".json"));
  const artifacts = JSON.parse(readCaptured("-artifacts.json"));
  const config = JSON.parse(readCaptured("-config.json"));
  const trace = JSON.parse(readCaptured("-trace.json"));
  const devtools = JSON.parse(readCaptured("-devtools.json"));
  const replayFile = await readJson(
    path.join(inputPath(group.analysisDirectory), name + "-analysis.json"),
  );
  const replay = replayFile.value;
  assert.equal(replay.schemaVersion, 1, "unknown replay schema");
  assert.equal(
    replay.status,
    "REPLAY_MATCHED",
    "only an existing exact replay can be summarized",
  );
  assert.equal(replay.graphSource, "PINNED_DEFAULT_DEVTOOLS_LOG");
  assert.equal(lhr.lighthouseVersion, "13.4.1");
  assert.equal(replay.lighthouseVersion, lhr.lighthouseVersion);
  assert.equal(replay.performanceAcceptance, false);
  assert.equal(
    new URL(lhr.requestedUrl).origin,
    origin,
    "sample must use the fixed viewer origin",
  );
  assert.equal(lhr.requestedUrl, capturedUrl, "group URL must match sample");
  assert.ok(!lhr.runtimeError, "runtime failure must remain failed");
  assert.equal(lhr.configSettings.throttlingMethod, "simulate");
  assert.equal(lhr.configSettings.formFactor, "mobile");
  assert.equal(config.internalLanternUseTracePresent, false);
  assert.deepEqual(
    artifacts.DevtoolsLog,
    devtools,
    "standalone CDP must equal captured artifact",
  );
  assert.deepEqual(
    artifacts.Trace,
    trace,
    "standalone trace must equal captured artifact",
  );
  assert.deepEqual(
    lhr.configSettings,
    artifacts.settings,
    "gather and audit settings must agree",
  );
  assert.equal(
    lhr.audits["storefront-content"].score,
    1,
    "same-navigation content must pass",
  );
  assert.deepEqual(
    captured.contentValidity,
    lhr.audits["storefront-content"],
    "capture content audit mismatch",
  );
  assert.equal(
    readCaptured("-document.html").toString("utf8"),
    artifacts.MainDocumentContent,
    "retained HTML must be same navigation",
  );
  const inputFiles = Object.fromEntries(
    [
      ".json",
      "-artifacts.json",
      "-config.json",
      "-trace.json",
      "-devtools.json",
    ].map((suffix) => {
      const bytes = readCaptured(suffix);
      return [name + suffix, { bytes: bytes.length, sha256: sha256(bytes) }];
    }),
  );
  const binding = verifyCaptureBinding({
    lhr,
    artifacts,
    config,
    capturedFiles: captured.files,
    inputFiles,
  });
  assert.deepEqual(binding, replay.binding, "saved replay binding mismatch");
  assert.deepEqual(
    replay.inputSha256,
    Object.fromEntries(
      Object.entries(inputFiles).map(([file, fingerprint]) => [
        file,
        fingerprint.sha256,
      ]),
    ),
    "saved replay must bind these original inputs",
  );
  const equivalence = verifyLanternReplay(
    lhr,
    replay.simulated.FCP,
    replay.simulated.LCP,
  );
  assert.deepEqual(
    equivalence,
    replay.equivalence,
    "saved replay metric verification mismatch",
  );
  const reads = summarizeGiftReadWindow(
    readCaptured("-native.log").toString("utf8"),
    captured.reads.afterSequence,
  );
  assert.deepEqual(
    reads,
    captured.reads,
    "native log must reproduce recorded read window",
  );
  const readsFile = await readJson(
    path.join(inputPath(group.captureDirectory), name + "-reads.json"),
  );
  assert.deepEqual(reads, readsFile.value, "standalone read window mismatch");
  assert.deepEqual(
    reads.counts,
    { GIFT_CONTENT: 0, STOREFRONT_GIFT: 1 },
    "candidate reads must remain zero plus one",
  );
  assert.ok(
    reads.requests.every((request) => request.status === 200),
    "content reads must succeed",
  );

  const finished = new Map(
    devtools
      .filter((event) => event.method === "Network.loadingFinished")
      .map((event) => [event.params.requestId, event.params.timestamp]),
  );
  const requested = new Map(
    devtools
      .filter((event) => event.method === "Network.requestWillBeSent")
      .map((event) => [event.params.requestId, event.params.timestamp]),
  );
  const responses = devtools
    .filter((event) => event.method === "Network.responseReceived")
    .map((event) => event.params);
  const viewerResponses = responses.filter(
    (record) => new URL(record.response.url).origin === origin,
  );
  assert.ok(viewerResponses.length > 0, "viewer CDP responses required");
  assert.ok(
    viewerResponses.some(
      (record) =>
        record.type === "Document" && record.response.url === lhr.requestedUrl,
    ),
    "measured viewer document response required",
  );
  const timeOriginMs = replay.observed.timeOriginUs / 1000;
  const actualResources = viewerResponses.map((record) => {
    const response = record.response;
    return {
      requestId: record.requestId,
      resource: resource(response.url),
      resourceType: record.type,
      actualHttpProtocol: response.protocol,
      connectionId: response.connectionId,
      connectionReused: response.connectionReused,
      status: response.status,
      startMs: requested.has(record.requestId)
        ? requested.get(record.requestId) * 1000 - timeOriginMs
        : null,
      endMs: finished.has(record.requestId)
        ? finished.get(record.requestId) * 1000 - timeOriginMs
        : null,
      sendStartMs: response.timing?.sendStart ?? null,
      contentEncoding: header(response.headers, "content-encoding"),
      cache: header(response.headers, "x-nextjs-cache"),
      etag: header(response.headers, "etag"),
    };
  });
  const simulated = Object.fromEntries(
    ["FCP", "LCP"].map((metric) => [
      metric,
      {
        timing: replay.simulated[metric].timing,
        optimistic: summarizeGraph(replay.simulated[metric].optimistic),
        pessimistic: summarizeGraph(replay.simulated[metric].pessimistic),
      },
    ]),
  );
  const breakdown = lhr.audits["lcp-breakdown-insight"]?.details?.items?.[0];
  assert.equal(
    breakdown?.type,
    "table",
    "unknown observed LCP breakdown schema",
  );
  return {
    name,
    status: "INPUTS_AND_SAVED_REPLAY_VERIFIED",
    rawFilesVerified: buffers.size,
    inputSha256: replay.inputSha256,
    replaySha256: replayFile.sha256,
    readsSha256: readsFile.sha256,
    html: {
      bytes: readCaptured("-document.html").length,
      sha256: sha256(readCaptured("-document.html")),
    },
    contentAuditScore: lhr.audits["storefront-content"].score,
    reads: { counts: reads.counts, requests: reads.requests },
    equivalence,
    settings: lhr.configSettings,
    observed: {
      timingsMs: replay.observed.observedTimingsMs,
      lcpBreakdownMs: Object.fromEntries(
        breakdown.items.map((item) => [item.subpart, item.duration]),
      ),
      imageNetworkRequests: replay.observed.imageNetworkRequests,
      compositorCause: replay.observed.compositorCause,
    },
    transport: {
      protocolMatchesExpected: actualResources.every(
        (record) => record.actualHttpProtocol === expectedProtocol,
      ),
      actualHttpProtocols: [
        ...new Set(actualResources.map((record) => record.actualHttpProtocol)),
      ],
      alpnEvidenceGroup: group.name,
      alpnEvidenceScope:
        "GROUP_LEVEL_ONLY; no sample-to-TLS-connection mapping",
      distinctConnectionIds: [
        ...new Set(actualResources.map((record) => record.connectionId)),
      ],
      nonViewerResponseCount: responses.length - viewerResponses.length,
      fontCompletionRelativeToObservedLcp: actualResources
        .filter((record) => record.resourceType === "Font")
        .map((record) => ({
          resource: record.resource,
          observedEndMs: record.endMs,
          endMinusObservedLcpMs:
            record.endMs === null
              ? null
              : record.endMs -
                replay.observed.observedTimingsMs.largestContentfulPaint,
        })),
      actualResources,
    },
    simulated,
    lighthousePerformanceScore: lhr.categories.performance.score,
    totalBlockingTimeMs: lhr.audits["total-blocking-time"].numericValue,
    cls: lhr.audits["cumulative-layout-shift"].numericValue,
    formalPerformanceAcceptance: false,
  };
}

function compareEntities(results) {
  const complete = results.every((group) =>
    Array.isArray(group.staticServerEntities),
  );
  if (!complete)
    return {
      comparable: false,
      reason: "A group failed server evidence validation",
    };
  const paths = [
    ...new Set(
      results.flatMap((group) =>
        group.staticServerEntities.map((row) => row.pathname),
      ),
    ),
  ].sort();
  const rows = paths.map((pathname) => {
    const variantsByGroup = results.map((group) => {
      const row = group.staticServerEntities.find(
        (entry) => entry.pathname === pathname,
      );
      return {
        group: group.name,
        variants: (row?.variants ?? [])
          .map(({ sha256, byteLength, contentEncoding }) => ({
            sha256,
            byteLength,
            contentEncoding,
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      };
    });
    return {
      pathname,
      equalAcrossFourGroups: variantsByGroup.every(
        (row) =>
          JSON.stringify(row.variants) ===
          JSON.stringify(variantsByGroup[0].variants),
      ),
      variantsByGroup,
    };
  });
  return {
    comparable: true,
    allStaticEntitySetsEqual:
      rows.length > 0 &&
      rows.every(
        (row) =>
          row.equalAcrossFourGroups &&
          row.variantsByGroup.every((group) => group.variants.length > 0),
      ),
    rows,
    scope:
      "Successful GET 200 entity hash/length/encoding sets by pathname, not HTTP framing bytes. Server logs omit query; image query-to-entity pairing is not established. Excluded server requests remain listed per group.",
  };
}

async function readFixtureProof(directory) {
  // These exact files are written by retainPublication/verifyGiftTraceComparison.
  const responseBytes = await readFile(
    path.join(directory, "fixture-publication-response.txt"),
  );
  const manifestBytes = await readFile(
    path.join(directory, "fixture-manifest.json"),
  );
  const publication = await readJson(
    path.join(directory, "fixture-publication.json"),
  );
  const body = JSON.parse(responseBytes.toString("utf8"));
  const fixtureManifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(
    publication.value.schemaVersion,
    1,
    "unknown publication evidence schema",
  );
  assert.equal(
    publication.value.status,
    200,
    "fixture publication request must succeed",
  );
  assert.equal(
    publication.value.requestCount,
    1,
    "exactly one group publication read is expected",
  );
  assert.equal(
    publication.value.source,
    "Existing public API; no browser or Next navigation",
  );
  assert.deepEqual(
    publication.value.body,
    body,
    "publication evidence body must match retained response text",
  );
  assert.equal(body.schemaVersion, 1, "unknown published response schema");
  assert.equal(body.outcome, "SUCCESS", "published gift must be successful");
  assert.equal(
    body.kind,
    "STOREFRONT_GIFT",
    "published proof must describe the measured gift",
  );
  assert.equal(
    fixtureManifest.schemaVersion,
    1,
    "unknown fixture manifest schema",
  );
  assert.equal(fixtureManifest.environment, "TEST");
  return {
    responseBytes,
    manifestBytes,
    body,
    fixtureManifest,
    evidence: {
      response: {
        file: "fixture-publication-response.txt",
        bytes: responseBytes.length,
        sha256: sha256(responseBytes),
      },
      manifest: {
        file: "fixture-manifest.json",
        bytes: manifestBytes.length,
        sha256: sha256(manifestBytes),
      },
      publication: {
        file: "fixture-publication.json",
        sha256: publication.sha256,
        observedAt: publication.value.observedAt,
        requestCount: publication.value.requestCount,
        status: publication.value.status,
      },
      responseBodyMatchesPublicationRecord: true,
    },
  };
}

async function main() {
  assert.equal(
    process.argv.length,
    6,
    "usage: --manifest <workspace-relative JSON> --output <new checkpoint JSON>",
  );
  assert.equal(process.argv[2], "--manifest");
  assert.equal(process.argv[4], "--output");
  const output = inputPath(process.argv[5]);
  assert.equal(
    path.dirname(output),
    checkpoint,
    "summary output must stay in this checkpoint directory",
  );
  const manifestFile = await readJson(inputPath(process.argv[3]));
  const manifest = manifestFile.value;
  assert.equal(manifest.schemaVersion, 1, "unknown manifest schema");
  assert.equal(
    path.isAbsolute(manifest.transportReport),
    false,
    "transportReport must be workspace-relative",
  );
  assert.deepEqual(
    manifest.groups.map((group) => group.name),
    groups.map((group) => group.name),
    "manifest must retain fixed H1/H2/H2/H1 order",
  );
  const transportFile = await readJson(inputPath(manifest.transportReport));
  const transport = transportFile.value;
  assert.equal(transport.schemaVersion, 1, "unknown transport schema");
  assert.ok(
    ["COLLECTED_DIAGNOSTIC", "FAIL"].includes(transport.status),
    "transport capture must have finished",
  );
  assert.equal(new URL(transport.origin).protocol, "https:");
  assert.equal(transport.scheduledNavigations, 12);
  assert.equal(transport.formalPerformanceAcceptance, false);
  assert.equal(transport.browserSystemTrustClaimed, false);
  assert.equal(transport.viewerClosed, true);
  assert.ok(
    typeof transport.buildId === "string" && transport.buildId.length > 0,
  );
  assert.ok(
    Number.isSafeInteger(transport.nextGeneration) &&
      transport.nextGeneration >= 0,
  );
  assert.deepEqual(
    transport.protocolOrder,
    groups.map((group) => group.protocol),
  );
  assert.deepEqual(
    transport.groups.map((group) => group.name),
    groups.map((group) => group.name),
  );
  assert.ok(
    Number.isSafeInteger(transport.actualCollectedNavigations) &&
      transport.actualCollectedNavigations >= 0,
    "actual navigation count is required",
  );
  const snapshot = transport.requests;
  assert.equal(
    snapshot.schemaVersion,
    1,
    "unknown final viewer snapshot schema",
  );
  assert.equal(
    snapshot.origin,
    transport.origin,
    "final snapshot must use the measured viewer origin",
  );
  assert.ok(
    Array.isArray(snapshot.requests),
    "final full server request snapshot is required",
  );
  const report = {
    schemaVersion: 1,
    status: "ANALYZING",
    manifestSha256: manifestFile.sha256,
    transportReportSha256: transportFile.sha256,
    origin: transport.origin,
    upstreamOrigin: transport.upstreamOrigin,
    buildId: transport.buildId,
    nextGeneration: transport.nextGeneration,
    viewerClosed: transport.viewerClosed,
    actualCollectedNavigations: transport.actualCollectedNavigations,
    finalViewerSnapshot: {
      closed: snapshot.closed,
      activeRequests: snapshot.activeRequests,
      overflowRequests: snapshot.overflowRequests,
      requestCount: snapshot.requests.length,
    },
    groups: [],
    failures: [],
    savedReplayOnly: true,
    newModelReplaysExecuted: 0,
    formalPerformanceAcceptance: false,
    limitations:
      "Observed localhost navigation, official slow-network simulation and production RUM are different evidence. No RUM, browser system-trust or staging acceptance is claimed. Resource graphs may change at the observed paint cutoff; a score difference alone does not identify a transport cause.",
  };
  try {
    assert.equal(
      transport.actualCollectedNavigations,
      12,
      "transport must actually collect all twelve navigations",
    );
    assert.equal(snapshot.closed, true, "final viewer snapshot must be closed");
    assert.equal(
      snapshot.activeRequests,
      0,
      "final viewer snapshot must have no active requests",
    );
    assert.equal(
      snapshot.overflowRequests,
      0,
      "final viewer snapshot must have no dropped request records",
    );
    assert.equal(
      transport.status,
      "COLLECTED_DIAGNOSTIC",
      "failed transport collection remains failed",
    );
  } catch (error) {
    report.failures.push(failure(error));
  }
  let referenceSettings;
  let referenceTls;
  let referenceFixture;
  let referenceFixtureGroup;
  for (let index = 0; index < groups.length; index++) {
    const expected = groups[index];
    const spec = manifest.groups[index];
    const entry = transport.groups[index];
    const result = {
      name: expected.name,
      expectedProtocol: expected.protocol,
      captureDirectory: spec.captureDirectory,
      analysisDirectory: spec.analysisDirectory,
      actualCollectedNavigations: entry.actualCollectedNavigations,
      originalTransportStatus: entry.status,
      originalTransportFailure: entry.failure ?? null,
      retainedServerFailures: entry.requests.filter(
        (request) => request.complete !== true || request.failure !== null,
      ),
      samples: [],
      failures: [],
      transportFailures: [],
    };
    report.groups.push(result);
    let capture;
    let analyses;
    let sourceIndexesValid = false;
    try {
      result.transport = verifyGroupTransport(
        entry,
        expected,
        transport.origin,
      );
      const tlsIdentity = {
        certificateSha256: entry.tls.certificateSha256,
        tlsVersion: entry.tls.tlsVersion,
        hostname: entry.tls.hostname,
      };
      referenceTls ??= tlsIdentity;
      assert.deepEqual(
        tlsIdentity,
        referenceTls,
        "TLS certificate/version/hostname must stay fixed",
      );
      result.staticServerEntities = serverEntities(entry);
    } catch (error) {
      const detail = { scope: "transport", ...failure(error) };
      result.transportFailures.push(detail);
      result.failures.push(detail);
    }
    try {
      assert.equal(
        entry.requestOffset,
        index === 0 ? 0 : transport.groups[index - 1].requestEnd,
        "server request group slices must be contiguous from zero",
      );
      assert.ok(
        Number.isSafeInteger(entry.requestEnd) &&
          entry.requestEnd <= snapshot.requests.length,
        "group end must be within the final snapshot",
      );
      assert.deepEqual(
        entry.requests,
        snapshot.requests.slice(entry.requestOffset, entry.requestEnd),
        "group server records must equal the final snapshot slice",
      );
      result.finalSnapshotSliceMatched = true;
    } catch (error) {
      const detail = { scope: "final-snapshot-slice", ...failure(error) };
      result.transportFailures.push(detail);
      result.failures.push(detail);
    }
    try {
      assert.equal(
        inputPath(spec.captureDirectory),
        path.join(inputPath(entry.output), "gift-render-trace"),
        "manifest capture path must bind the transport group",
      );
      const fixtureProof = await readFixtureProof(
        inputPath(spec.captureDirectory),
      );
      result.fixtureEvidence = fixtureProof.evidence;
      if (!referenceFixture) {
        referenceFixture = fixtureProof;
        referenceFixtureGroup = expected.name;
      }
      assert.deepEqual(
        fixtureProof.responseBytes,
        referenceFixture.responseBytes,
        "group publication response bytes must remain identical",
      );
      assert.deepEqual(
        fixtureProof.body,
        referenceFixture.body,
        "group publication response body must remain identical",
      );
      assert.deepEqual(
        fixtureProof.manifestBytes,
        referenceFixture.manifestBytes,
        "group fixture manifest bytes must remain identical",
      );
      assert.deepEqual(
        fixtureProof.fixtureManifest,
        referenceFixture.fixtureManifest,
        "group fixture manifest must remain deeply identical",
      );
      result.fixtureEvidence.identicalToGroup = referenceFixtureGroup;
    } catch (error) {
      result.failures.push({ scope: "fixture-proof", ...failure(error) });
    }
    try {
      assert.equal(
        inputPath(spec.captureDirectory),
        path.join(inputPath(entry.output), "gift-render-trace"),
        "manifest capture path must bind the transport group",
      );
      const captureFile = await readJson(
        path.join(inputPath(spec.captureDirectory), "results.json"),
      );
      capture = captureFile.value;
      result.captureSha256 = captureFile.sha256;
      assert.equal(capture.schemaVersion, 1, "unknown capture schema");
      assert.equal(capture.mode, "candidate");
      assert.equal(capture.url.startsWith(transport.origin + "/"), true);
      result.documentServerEntities = entry.requests
        .filter((request) => request.path === new URL(capture.url).pathname)
        .map((request) => ({
          id: request.id,
          method: request.method,
          status: request.status,
          contentEncoding: request.contentEncoding,
          byteLength: request.byteLength,
          sha256: request.sha256,
        }));
      assert.equal(capture.conditions.traceProfile, "standard");
      assert.equal(capture.conditions.scheduledNavigations, 3);
      assert.equal(capture.conditions.additionalBrowserNavigations, 0);
      assert.equal(capture.conditions.browserPrewarming, false);
      assert.equal(capture.conditions.allScheduledAttemptsRetained, true);
      assert.deepEqual(
        capture.attempts.map((attempt) => attempt.name),
        names,
      );
      assert.equal(
        capture.attempts.length,
        entry.actualCollectedNavigations,
        "original capture count must match actual transport count",
      );
      result.originalCaptureAttemptCount = capture.attempts.length;
      result.captureStatus = capture.status;
      const analysesFile = await readJson(
        path.join(inputPath(spec.analysisDirectory), "results.json"),
      );
      analyses = analysesFile.value;
      result.analysisIndexSha256 = analysesFile.sha256;
      assert.equal(analyses.schemaVersion, 1, "unknown analysis index schema");
      assert.equal(
        inputPath(analyses.input),
        inputPath(spec.captureDirectory),
        "analysis index input mismatch",
      );
      assert.deepEqual(
        analyses.runs.map((run) => run.name),
        names,
      );
      sourceIndexesValid = true;
    } catch (error) {
      result.failures.push({
        scope: "original-source-indexes",
        ...failure(error),
      });
    }
    for (const name of names) {
      try {
        assert.ok(sourceIndexesValid, "group source indexes failed validation");
        assert.equal(
          analyses.runs.find((run) => run.name === name).status,
          "REPLAY_MATCHED",
          "failed saved replay must remain failed",
        );
        const sample = await summarizeSample(
          spec,
          capture.attempts.find((attempt) => attempt.name === name),
          name,
          transport.origin,
          expected.protocol,
          capture.url,
        );
        referenceSettings ??= sample.settings;
        assert.deepEqual(
          sample.settings,
          referenceSettings,
          "all 12 audited settings must be identical",
        );
        result.samples.push(sample);
        if (!sample.transport.protocolMatchesExpected) {
          const detail = {
            scope: "sample-cdp-protocol",
            sample: name,
            name: "AssertionError",
            message: "original CDP response protocol must match group",
          };
          result.transportFailures.push(detail);
          result.failures.push(detail);
        }
      } catch (error) {
        result.samples.push({
          name,
          status: "FAIL",
          failure: failure(error),
          formalPerformanceAcceptance: false,
        });
      }
    }
    if (result.samples.every((sample) => sample.status !== "FAIL")) {
      result.medianSimulatedLcpMs = median(
        result.samples.map((sample) => sample.simulated.LCP.timing),
      );
      result.medianObservedLcpMs = median(
        result.samples.map(
          (sample) => sample.observed.timingsMs.largestContentfulPaint,
        ),
      );
      result.htmlSha256BySample = result.samples.map((sample) => ({
        name: sample.name,
        ...sample.html,
      }));
    }
  }
  try {
    assert.equal(
      transport.groups.at(-1).requestEnd,
      snapshot.requests.length,
      "four group slices must cover the complete final request snapshot",
    );
    assert.equal(
      sum(report.groups.map((group) => group.actualCollectedNavigations)),
      transport.actualCollectedNavigations,
      "group actual navigation counts must equal the actual total",
    );
  } catch (error) {
    report.failures.push(failure(error));
  }
  report.staticEntityComparison = compareEntities(report.groups);
  report.scheduledSlotsRepresented =
    report.groups.length === 4 &&
    report.groups.every((group) => group.samples.length === 3);
  report.verifiedSampleCount = sum(
    report.groups.map(
      (group) =>
        group.samples.filter((sample) => sample.status !== "FAIL").length,
    ),
  );
  report.validOriginalSamples = report.verifiedSampleCount;
  report.originalSampleValidationScope =
    "Original capture hashes, settings, same-navigation content, native reads and saved replay are validated independently of the separate transport gate.";
  report.allTwelveSamplesRetained =
    transport.actualCollectedNavigations === 12 &&
    report.verifiedSampleCount === 12 &&
    report.groups.every(
      (group) =>
        group.actualCollectedNavigations === 3 &&
        group.originalCaptureAttemptCount === 3,
    );
  report.finalSnapshotSlicesVerified =
    report.groups.every((group) => group.finalSnapshotSliceMatched === true) &&
    transport.groups.at(-1).requestEnd === snapshot.requests.length;
  report.wholeTransportGatePassed =
    report.failures.length === 0 &&
    report.finalSnapshotSlicesVerified &&
    report.groups.every(
      (group) =>
        group.transportFailures.length === 0 &&
        group.samples.every(
          (sample) =>
            sample.status !== "FAIL" &&
            sample.transport.protocolMatchesExpected === true,
        ),
    );
  report.allFixtureProofsIdentical = report.groups.every(
    (group) => group.fixtureEvidence?.identicalToGroup === groups[0].name,
  );
  report.rawFilesVerified = sum(
    report.groups.flatMap((group) =>
      group.samples.map((sample) => sample.rawFilesVerified ?? 0),
    ),
  );
  report.allSettingsEqual = report.verifiedSampleCount === 12;
  report.status =
    report.failures.length ||
    !report.wholeTransportGatePassed ||
    !report.allTwelveSamplesRetained ||
    report.groups.some(
      (group) =>
        group.failures.length ||
        group.samples.some((sample) => sample.status === "FAIL"),
    )
      ? "FAIL"
      : "OFFLINE_EVIDENCE_SUMMARIZED";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: report.status,
      verifiedSampleCount: report.verifiedSampleCount,
      validOriginalSamples: report.validOriginalSamples,
      allTwelveSamplesRetained: report.allTwelveSamplesRetained,
      wholeTransportGatePassed: report.wholeTransportGatePassed,
      allStaticEntitySetsEqual:
        report.staticEntityComparison.allStaticEntitySetsEqual ?? null,
      output,
    }),
  );
  if (report.status === "FAIL") process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      status: "INPUT_OR_SCHEMA_FAILURE",
      failure: failure(error),
    }),
  );
  process.exitCode = 1;
}
