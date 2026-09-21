#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const modeFile = path.join(
  workspaceRoot,
  "output/checks/p3-06-font-range/stage.json",
);
const internalArgument = "--run-gift-trace-comparison";

function parseGiftTraceMode(value) {
  assert.deepEqual(Object.keys(value).sort(), ["schemaVersion", "stage"]);
  assert.equal(value.schemaVersion, 1);
  assert.ok(["baseline", "candidate", "ui"].includes(value.stage));
  return value.stage;
}
let viewer;
async function verifyBrowser(context) {
  const stage = parseGiftTraceMode(
    JSON.parse(await readFile(modeFile, "utf8")),
  );
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path.join(context.output, "font-range-stage.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        stage,
        readImplementation: "scoped-shared-candidate-in-both-groups",
        scheduledNavigations: stage === "ui" ? null : 3,
        formalPerformanceAcceptance: false,
      },
      null,
      2,
    ) + "\n",
  );
  if (stage === "ui") {
    const { verifyAcceptanceBrowser } =
      await import("../../../apps/api/scripts/storefront-acceptance-matrix.mjs");
    return verifyAcceptanceBrowser(context);
  }
  const { createStorefrontViewerTransport } =
    await import("../../../apps/api/scripts/storefront-viewer-transport.mjs");
  if (!viewer) {
    viewer = await createStorefrontViewerTransport({
      upstreamOrigin: context.origin,
      certificatePath: context.gateway.certificatePath,
      privateKeyPath: path.join(
        path.dirname(context.gateway.certificatePath),
        "storefront-media.key",
      ),
      protocol: "h2",
    });
    const finalPath = path.join(
      path.dirname(context.output),
      "font-range-viewer-final.json",
    );
    context.own("owned H2 font-range TEST viewer", async () => {
      await viewer.close();
      await writeFile(
        finalPath,
        JSON.stringify(viewer.snapshot(), null, 2) + "\n",
      );
    });
  }
  const before = viewer.snapshot();
  const { verifyGiftTraceComparison } =
    await import("../../../apps/api/scripts/storefront-gift-trace-verification.mjs");
  try {
    return await verifyGiftTraceComparison({
      ...context,
      origin: viewer.origin,
      mode: "candidate",
    });
  } finally {
    const after = viewer.snapshot();
    await writeFile(
      path.join(context.output, "font-range-viewer.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          stage,
          origin: viewer.origin,
          protocol: after.protocol,
          nextGeneration: context.next.generation(),
          buildId: (
            await readFile(
              path.join(workspaceRoot, "apps/storefront/.next/BUILD_ID"),
              "utf8",
            )
          ).trim(),
          requestOffset: before.requests.length,
          requestEnd: after.requests.length,
          activeRequests: after.activeRequests,
          overflowRequests: after.overflowRequests,
          requests: after.requests.slice(before.requests.length),
          scope:
            "Server observations including auxiliary gatherer/cleanup requests; cancellation is retained and is not a measured-navigation failure verdict.",
          browserSystemTrustClaimed: false,
          browserUsesExistingTestSpkiException: true,
          formalPerformanceAcceptance: false,
        },
        null,
        2,
      ) + "\n",
    );
  }
}

async function main() {
  assert.ok(
    process.argv.slice(2).every((value) => value === internalArgument),
    "Unknown gift trace option",
  );
  assert.equal(
    process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS,
    "1",
    "Trace comparison requires explicit TEST read diagnostics",
  );
  parseGiftTraceMode(JSON.parse(await readFile(modeFile, "utf8")));
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
      runAcceptanceFixture(database, s3, {
        serve: true,
        ui: true,
        verifyBrowser,
      }),
    );
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: internalArgument,
        timeoutMs: 6_600_000,
      }),
    );
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "TEST gift render trace comparison",
        name: error?.name,
        assertion: error?.name === "AssertionError" ? error.message : null,
      }),
    );
    process.exitCode = 1;
  }
}
