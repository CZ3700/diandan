#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "node:tls";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const internalArgument = "--run-viewer-transport";
const groups = [
  { name: "h1-a", protocol: "http/1.1" },
  { name: "h2-a", protocol: "h2" },
  { name: "h2-b", protocol: "h2" },
  { name: "h1-b", protocol: "http/1.1" },
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";

function verifyLocalTls(origin, ca, protocol) {
  const url = new globalThis.URL(origin);
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: "127.0.0.1",
      port: Number(url.port),
      servername: url.hostname,
      ca,
      ALPNProtocols: ["h2", "http/1.1"],
      rejectUnauthorized: true,
    });
    socket.setTimeout(5000, () =>
      socket.destroy(new Error("TEST TLS handshake timeout")),
    );
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      try {
        assert.equal(socket.authorized, true);
        assert.equal(socket.alpnProtocol, protocol);
        const peer = socket.getPeerCertificate();
        const proof = {
          authorizedByExplicitTestCa: socket.authorized,
          alpnProtocol: socket.alpnProtocol,
          tlsVersion: socket.getProtocol(),
          certificateSha256: digest(peer.raw),
          hostname: url.hostname,
          browserSystemTrustClaimed: false,
          browserUsesExistingTestSpkiException: true,
          pageRequests: 0,
        };
        socket.destroy();
        resolve(proof);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
  });
}

async function verifyBrowser(context) {
  const { createStorefrontViewerTransport } =
    await import("../../../apps/api/scripts/storefront-viewer-transport.mjs");
  const { verifyGiftTraceComparison } =
    await import("../../../apps/api/scripts/storefront-gift-trace-verification.mjs");
  const certificatePath = context.gateway.certificatePath;
  const directory = path.dirname(certificatePath);
  const ca = await readFile(path.join(directory, "ca.crt"));
  const viewer = await createStorefrontViewerTransport({
    upstreamOrigin: context.origin,
    certificatePath,
    privateKeyPath: path.join(directory, "storefront-media.key"),
    protocol: groups[0].protocol,
  });
  context.own("owned TEST viewer transport", () => viewer.close());
  const buildPath = path.join(workspaceRoot, "apps/storefront/.next/BUILD_ID");
  const buildId = (await readFile(buildPath, "utf8")).trim();
  const generation = context.next.generation();
  const report = {
    schemaVersion: 1,
    scope: "TEST pin-based HTTPS viewer protocol diagnostic",
    status: "RUNNING",
    origin: viewer.origin,
    upstreamOrigin: context.origin,
    buildId,
    nextGeneration: generation,
    protocolOrder: groups.map(({ protocol }) => protocol),
    scheduledNavigations: 12,
    actualCollectedNavigations: 0,
    formalPerformanceAcceptance: false,
    browserSystemTrustClaimed: false,
    serverAndImageCacheMayBeWarm: true,
    canonicalOriginRemainsUnchangedTestUpstream: true,
    groups: [],
  };
  const reportPath = path.join(context.output, "transport-results.json");
  const save = () => writeFile(reportPath, json(report));
  await save();
  const failures = [];
  try {
    for (const group of groups) {
      const groupOutput = path.join(
        path.dirname(context.output),
        `transport-${group.name}`,
      );
      await mkdir(groupOutput, { recursive: true });
      const entry = {
        ...group,
        output: path.relative(workspaceRoot, groupOutput),
        status: "RUNNING",
      };
      report.groups.push(entry);
      await save();
      try {
        await viewer.setProtocol(group.protocol);
        entry.tls = await verifyLocalTls(viewer.origin, ca, group.protocol);
        entry.requestOffset = viewer.snapshot().requests.length;
        const captured = await verifyGiftTraceComparison({
          ...context,
          origin: viewer.origin,
          output: groupOutput,
          mode: "candidate",
          traceProfile: "standard",
        });
        entry.collectorStatus = captured.status;
        entry.actualCollectedNavigations = captured.attempts.length;
        assert.equal(entry.actualCollectedNavigations, 3);
        entry.requestEnd = viewer.snapshot().requests.length;
        entry.requests = viewer
          .snapshot()
          .requests.slice(entry.requestOffset, entry.requestEnd);
        assert.ok(entry.requests.length > 0);
        assert.equal(viewer.snapshot().activeRequests, 0);
        assert.equal(viewer.snapshot().overflowRequests, 0);
        assert.ok(
          entry.requests.every(
            (request) => request.complete && request.failure === null,
          ),
          "Every observed viewer request must finish completely",
        );
        assert.ok(
          entry.requests.every(
            (request) => request.alpnProtocol === group.protocol,
          ),
        );
        assert.equal(context.next.generation(), generation);
        assert.equal((await readFile(buildPath, "utf8")).trim(), buildId);
        entry.status = "COLLECTED";
      } catch (error) {
        entry.status = "FAIL";
        entry.failure = {
          name: error?.name,
          assertion: error?.name === "AssertionError" ? error.message : null,
        };
        failures.push(error);
      } finally {
        entry.requestEnd = viewer.snapshot().requests.length;
        entry.requests = viewer
          .snapshot()
          .requests.slice(
            entry.requestOffset ?? entry.requestEnd,
            entry.requestEnd,
          );
        const retained = await readFile(
          path.join(groupOutput, "gift-render-trace/results.json"),
          "utf8",
        )
          .then(JSON.parse)
          .catch(() => null);
        entry.actualCollectedNavigations = retained?.attempts?.length ?? 0;
        report.actualCollectedNavigations += entry.actualCollectedNavigations;
      }
      await save();
    }
  } finally {
    await viewer.close();
    report.requests = viewer.snapshot();
    report.viewerClosed = true;
    report.status =
      failures.length === 0 &&
      report.groups.length === groups.length &&
      report.actualCollectedNavigations === report.scheduledNavigations &&
      report.groups.every((group) => group.status === "COLLECTED")
        ? "COLLECTED_DIAGNOSTIC"
        : "FAIL";
    await save();
  }
  assert.equal(report.groups.length, 4);
  assert.equal(report.actualCollectedNavigations, 12);
  if (failures.length)
    throw new AggregateError(
      failures,
      "Fixed transport groups contain invalid samples",
    );
  return report;
}

async function main() {
  assert.ok(process.argv.slice(2).every((value) => value === internalArgument));
  assert.equal(process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS, "1");
  const { withEphemeralPostgres } =
    await import("../../../packages/persistence-postgres/dist/index.js");
  const {
    withEphemeralS3,
    runS3IntegrationChild,
    readEphemeralS3Config,
    prepareEphemeralS3Buckets,
  } =
    await import("../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs");
  const { runAcceptanceFixture } =
    await import("../../../apps/api/scripts/storefront-acceptance-http.mjs");
  if (process.argv.includes(internalArgument)) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) =>
      runAcceptanceFixture(database, s3, { ui: true, verifyBrowser }),
    );
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: internalArgument,
        timeoutMs: 1_500_000,
      }),
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(
    json({
      scope: "TEST viewer transport diagnostic",
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    }),
  );
  process.exitCode = 1;
}
