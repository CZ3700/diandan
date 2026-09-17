#!/usr/bin/env node
// Offline TEST evidence only. Does not execute captured JavaScript or contact a server.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { NetworkRecords } from "../../../node_modules/lighthouse/core/computed/network-records.js";
import { verifyCaptureBinding } from "../../../apps/api/scripts/storefront-gift-trace-analysis.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const featureSource = "apps/storefront/src/storefront/gift-filters-client.tsx";
const markers = ["data-gift-filters", "data-gift-price-min", "data-gift-price-max", "data-gift-reset"];
const notes = [
  "Markers come from unchanged GiftFiltersClient source, not minifier module IDs.",
  "Matching identifies characteristic source in an entire captured script; no factory is executed or separately byte-counted.",
  "Whole-body gzip level6 is a local diagnostic, not observed wire bytes or a promise of network savings.",
  "Network totals count requests once; parsed inline script bodies are not counted as separate network resources.",
  "Source manifests are root-supplied build associations; this script binds their bytes and reports source differences, but cannot prove a compiler consumed those files.",
  "Script removal does not establish LCP causality, directory functionality, or formal performance acceptance.",
];

async function input(file) {
  const bytes = await readFile(file);
  return { file: path.resolve(file), bytes: bytes.length, sha256: hash(bytes), value: JSON.parse(bytes.toString("utf8")) };
}
function fingerprint({ file, bytes, sha256 }) { return { file, bytes, sha256 }; }
function urlIdentity(value, kind) {
  let file = null;
  if (kind === "external-script") {
    try { file = path.basename(new URL(value).pathname); } catch { /* keep digest only */ }
  }
  return { file, urlSha256: hash(value) };
}
function markerCounts(content) {
  return Object.fromEntries(markers.map((marker) => [marker, content.split(marker).length - 1]));
}
function sourceMap(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  const rows = new Map();
  for (const row of manifest.files) {
    assert.equal(typeof row.path, "string");
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(!rows.has(row.path), "source manifest paths must be unique");
    rows.set(row.path, row.sha256);
  }
  return rows;
}

async function analyzeGroup({ directory, source, label, output, preservedBodies, sharedSettings }) {
  const stage = await input(path.join(directory, "../entry-isolation-stage.json"));
  assert.equal(stage.value.schemaVersion, 1);
  assert.equal(stage.value.stage, label === "before" ? "baseline" : "candidate", "capture stage must match the intended comparison group");
  assert.equal(stage.value.readImplementation, "scoped-shared-candidate-in-both-groups");
  assert.equal(stage.value.scheduledNavigations, 3);
  assert.equal(stage.value.formalPerformanceAcceptance, false);
  const capture = await input(path.join(directory, "results.json"));
  assert.equal(capture.value.mode, "candidate", "both groups use the same scoped-shared read implementation");
  const attempts = capture.value.attempts;
  assert.ok(Array.isArray(attempts) && attempts.length === 3, "retain exactly the three scheduled attempts");
  const sourceRows = sourceMap(source.value);
  const runs = [];
  for (const attempt of attempts) {
    assert.equal(attempt.failure, null, "failed capture is not usable as successful elimination evidence");
    assert.deepEqual(attempt.reads?.counts, { GIFT_CONTENT: 0, STOREFRONT_GIFT: 1 }, "each navigation must retain the identical zero-plus-one read semantics");
    assert.match(attempt.name, /^zh-CN-gift-mobile-[1-3]$/u);
    const suffixes = [".json", "-artifacts.json", "-devtools.json", "-config.json"];
    const files = {};
    for (const suffix of suffixes) {
      const descriptor = attempt.files[suffix];
      assert.ok(descriptor && path.basename(descriptor.file) === descriptor.file, "capture filename must stay in its directory");
      files[suffix] = await input(path.join(directory, descriptor.file));
    }
    const lhr = files[".json"].value;
    const artifacts = files["-artifacts.json"].value;
    const devtoolsLog = files["-devtools.json"].value;
    const config = files["-config.json"].value;
    const binding = verifyCaptureBinding({
      lhr, artifacts, config, capturedFiles: attempt.files,
      inputFiles: Object.fromEntries(Object.values(files).map((entry) => [path.basename(entry.file), fingerprint(entry)])),
    });
    assert.equal(lhr.lighthouseVersion, "13.4.1");
    if (sharedSettings.value === undefined) sharedSettings.value = lhr.configSettings;
    else assert.deepEqual(lhr.configSettings, sharedSettings.value, "all six navigation configSettings must be identical");
    assert.equal(lhr.audits["storefront-content"].score, 1, "same-navigation content must be valid");
    assert.deepEqual(devtoolsLog, artifacts.DevtoolsLog);
    assert.ok(Array.isArray(artifacts.Scripts) && artifacts.Scripts.length > 0);
    const records = await NetworkRecords.request(devtoolsLog, { computedCache: new Map() });
    const network = records.filter((record) => record.resourceType === "Script");
    assert.ok(network.length > 0, "must contain actual script requests");
    assert.ok(network.every((record) => typeof record.requestId === "string" && record.requestId.length > 0));
    assert.equal(new Set(network.map((record) => record.requestId)).size, network.length, "count each distinct requestId once; do not deduplicate requests by URL");
    const scripts = [];
    const bodyByUrl = new Map();
    for (const script of artifacts.Scripts) {
      assert.equal(typeof script.content, "string", "all captured script content must be available");
      assert.equal(script.content.length, script.length, "captured UTF-16 script length must be complete");
      const matching = network.filter((record) => record.url === script.url);
      const kind = matching.length ? "external-script" : "inline-or-non-network-script";
      const bytes = Buffer.from(script.content, "utf8");
      const sha256 = hash(bytes);
      if (matching.length) {
        if (bodyByUrl.has(script.url)) assert.equal(bodyByUrl.get(script.url).sha256, sha256, "one URL cannot bind ambiguous parsed bodies");
        bodyByUrl.set(script.url, { sha256, bytes: bytes.length });
      }
      if (!preservedBodies.has(sha256)) {
        // Raw bodies are already part of retained public TEST artifacts; preserve exact UTF-8 bytes for review.
        await writeFile(path.join(output, "bodies", `${sha256}.js`), bytes, { flag: "wx" });
        preservedBodies.add(sha256);
      }
      const counts = markerCounts(script.content);
      scripts.push({
        scriptId: script.scriptId, kind, ...urlIdentity(script.url, kind),
        sha256, rawBytes: bytes.length, utf16Length: script.length,
        localGzipLevel6Bytes: gzipSync(bytes, { level: 6 }).length,
        rawBody: `bodies/${sha256}.js`, markerCounts: counts,
        containsAllFilterMarkers: markers.every((marker) => counts[marker] > 0),
        requestIds: matching.map((record) => record.requestId),
      });
    }
    const requests = network.map((record) => {
      assert.equal(record.finished, true, "script requests must finish");
      assert.equal(record.failed, false, "script requests must not fail");
      assert.equal(record.statusCode, 200, "fixed cold navigations require complete 200 script bodies");
      const body = bodyByUrl.get(record.url);
      assert.ok(body, "every downloaded script request must bind a retained Scripts.content body");
      assert.equal(record.resourceSize, body.bytes, "decoded network byte count must equal complete captured UTF-8 body");
      assert.ok(Number.isFinite(record.transferSize) && record.transferSize >= 0);
      return {
        requestId: record.requestId, ...urlIdentity(record.url, "external-script"),
        contentSha256: body.sha256, status: record.statusCode,
        transferBytes: record.transferSize, resourceBytes: record.resourceSize,
        fromDiskCache: record.fromDiskCache, fromMemoryCache: record.fromMemoryCache, fromPrefetchCache: record.fromPrefetchCache,
        finished: record.finished, failed: record.failed,
      };
    });
    const external = scripts.filter((script) => script.kind === "external-script");
    const uniqueBodies = [...new Map(external.map((script) => [script.sha256, script])).values()];
    const filterBodies = external.filter((script) => script.containsAllFilterMarkers);
    const report = {
      schemaVersion: 1, label, name: attempt.name, binding,
      inputs: Object.values(files).map(fingerprint),
      scripts, networkRequests: requests,
      filterEvidence: {
        allMarkerBodySha256: [...new Set(filterBodies.map((script) => script.sha256))],
        anyMarkerBodySha256: [...new Set(external.filter((script) => markers.some((marker) => script.markerCounts[marker] > 0)).map((script) => script.sha256))],
        anyParsedScriptMarkerBodySha256: [...new Set(scripts.filter((script) => markers.some((marker) => script.markerCounts[marker] > 0)).map((script) => script.sha256))],
        htmlContainsFilterMarkup: artifacts.MainDocumentContent.includes("data-gift-filters="),
      },
      totals: {
        parsedScriptCount: scripts.length, externalParsedScriptCount: external.length,
        uniqueExternalBodyCount: uniqueBodies.length, scriptRequestCount: requests.length,
        uniqueExternalRawBytes: uniqueBodies.reduce((sum, script) => sum + script.rawBytes, 0),
        uniqueExternalLocalGzipLevel6Bytes: uniqueBodies.reduce((sum, script) => sum + script.localGzipLevel6Bytes, 0),
        observedRequestTransferBytes: requests.reduce((sum, request) => sum + request.transferBytes, 0),
        observedRequestResourceBytes: requests.reduce((sum, request) => sum + request.resourceBytes, 0),
      },
      formalPerformanceAcceptance: false,
    };
    await writeFile(path.join(output, `${label}-${attempt.name}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    runs.push({ name: report.name, totals: report.totals, filterEvidence: report.filterEvidence });
  }
  assert.equal(new Set(runs.map((run) => run.name)).size, 3);
  return {
    label, stage: fingerprint(stage), capture: fingerprint(capture),
    source: { ...fingerprint(source), head: source.value.head, capturedAt: source.value.capturedAt, declaredAggregateSha256: source.value.sha256, fileCount: sourceRows.size, featureSourceSha256: sourceRows.get(featureSource) },
    runs,
  };
}

async function main() {
  const options = {};
  const allowed = ["--before", "--after", "--before-source", "--after-source", "--output"];
  const args = process.argv.slice(2);
  assert.equal(args.length, allowed.length * 2, "requires --before DIR --after DIR --before-source JSON --after-source JSON --output NEW_DIR");
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(allowed.includes(args[index]) && !Object.hasOwn(options, args[index]));
    options[args[index]] = path.resolve(args[index + 1]);
  }
  const output = options["--output"];
  await mkdir(output, { recursive: false });
  await mkdir(path.join(output, "bodies"));
  const beforeSource = await input(options["--before-source"]);
  const afterSource = await input(options["--after-source"]);
  const beforeRows = sourceMap(beforeSource.value);
  const afterRows = sourceMap(afterSource.value);
  const featureBytes = await readFile(path.join(root, featureSource));
  const featureSha = hash(featureBytes);
  assert.equal(beforeRows.get(featureSource), featureSha, "source markers must bind original unchanged filter implementation");
  assert.equal(afterRows.get(featureSource), featureSha, "candidate must preserve the same filter implementation");
  for (const marker of markers) assert.ok(featureBytes.includes(marker), "marker must originate in filter source");
  const installedLighthouse = await input(path.join(root, "node_modules/lighthouse/package.json"));
  assert.equal(installedLighthouse.value.version, "13.4.1");
  const preservedBodies = new Set();
  const sharedSettings = {};
  const before = await analyzeGroup({ directory: options["--before"], source: beforeSource, label: "before", output, preservedBodies, sharedSettings });
  const after = await analyzeGroup({ directory: options["--after"], source: afterSource, label: "after", output, preservedBodies, sharedSettings });
  const sourceChanges = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort()
    .filter((file) => beforeRows.get(file) !== afterRows.get(file))
    .map((file) => ({ file, beforeSha256: beforeRows.get(file) ?? null, afterSha256: afterRows.get(file) ?? null }));
  const removed = before.runs.every((run) => run.filterEvidence.allMarkerBodySha256.length > 0)
    && after.runs.every((run) => run.filterEvidence.anyParsedScriptMarkerBodySha256.length === 0);
  const summary = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    status: removed ? "FILTER_SOURCE_MARKERS_REMOVED_FROM_ALL_THREE_PARSED_SCRIPT_SETS" : "EXPECTED_REMOVAL_NOT_PROVEN",
    tool: { sha256: hash(await readFile(fileURLToPath(import.meta.url))), node: process.version, lighthouse: installedLighthouse.value.version },
    featureSource: { path: featureSource, sha256: featureSha, markers },
    sourceChanges, before, after,
    comparisonGuards: { allSixSettingsIdentical: true, configSettingsSha256: hash(JSON.stringify(sharedSettings.value)), readCountsPerNavigation: { GIFT_CONTENT: 0, STOREFRONT_GIFT: 1 }, allAfterParsedScriptsChecked: true },
    notes, formalPerformanceAcceptance: false,
  };
  await writeFile(path.join(output, "results.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: summary.status, before: before.runs.map((run) => run.totals), after: after.runs.map((run) => run.totals), formalPerformanceAcceptance: false }));
  assert.ok(removed, "script elimination not demonstrated in all fixed navigations; all results retained");
}

try { await main(); }
catch (error) {
  console.error(JSON.stringify({ status: "FAILED", name: error.name, reason: error.name === "AssertionError" ? error.message : "Offline input or output failure" }));
  process.exitCode = 1;
}
