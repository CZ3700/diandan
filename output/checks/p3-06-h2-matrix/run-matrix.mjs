#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const internalArgument = "--run-owned-h2-matrix";

async function verifyMatrix(context) {
  const { createStorefrontViewerTransport } =
    await import("../../../apps/api/scripts/storefront-viewer-transport.mjs");
  const viewer = await createStorefrontViewerTransport({
    upstreamOrigin: context.origin,
    certificatePath: context.gateway.certificatePath,
    privateKeyPath: path.join(
      path.dirname(context.gateway.certificatePath),
      "storefront-media.key",
    ),
    protocol: "h2",
    maxRecords: 100_000,
  });
  context.own("owned H2 matrix viewer", async () => {
    await viewer.close();
    await writeFile(
      path.join(context.output, "viewer-final.json"),
      JSON.stringify(viewer.snapshot(), null, 2) + "\n",
    );
  });
  await writeFile(
    path.join(context.output, "matrix-context.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        origin: viewer.origin,
        upstreamOrigin: context.origin,
        buildId: (
          await readFile(
            path.join(root, "apps/storefront/.next/BUILD_ID"),
            "utf8",
          )
        ).trim(),
        nextGeneration: context.next.generation(),
        plannedResourcePages: 84,
        plannedLighthouseSamples: 63,
        plannedGroups: 21,
        readDiagnostics: false,
        extraPrewarming: false,
        productionDeploymentEvidence: false,
        browserSystemTrustEvidence: false,
        existingTestSpkiException: true,
        scope:
          "Original full laboratory matrix through an owned H2 viewer; no production TLS, SEO, field or physical-device acceptance claim.",
      },
      null,
      2,
    ) + "\n",
  );
  try {
    const { verifyAcceptancePerformance } =
      await import("../../../apps/api/scripts/storefront-acceptance-performance.mjs");
    return await verifyAcceptancePerformance({
      ...context,
      origin: viewer.origin,
    });
  } finally {
    await writeFile(
      path.join(context.output, "viewer-after-matrix.json"),
      JSON.stringify(viewer.snapshot(), null, 2) + "\n",
    );
  }
}

async function main() {
  assert.ok(process.argv.slice(2).every((value) => value === internalArgument));
  assert.equal(
    process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS,
    undefined,
    "Original formal matrix keeps TEST read diagnostics off",
  );
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
        serve: false,
        ui: true,
        performance: false,
        verifyBrowser: verifyMatrix,
      }),
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
    JSON.stringify({
      scope: "TEST full H2 laboratory matrix",
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    }),
  );
  process.exitCode = 1;
}
