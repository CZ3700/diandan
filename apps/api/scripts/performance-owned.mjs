import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { runAcceptanceFixture } from "./storefront-acceptance-http.mjs";
import { createStorefrontViewerTransport } from "./storefront-viewer-transport.mjs";
import { verifyPerformanceMatrix } from "./performance-browser.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const internal = "--owned-performance-child";
const args = process.argv.slice(2);
const childArgument = args.find((value) => value.startsWith(internal));
const diagnostic =
  args.includes("--diagnostic") ||
  Boolean(childArgument?.includes("-diagnostic"));

async function collect(context) {
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
  context.own("owned P6-03 H2 viewer", async () => {
    await viewer.close();
    await writeFile(
      path.join(context.output, "performance-viewer-final.json"),
      JSON.stringify(viewer.snapshot(), null, 2) + "\n",
    );
  });
  const metadata = {
    schemaVersion: 1,
    diagnostic,
    rumMode: "disabled",
    origin: viewer.origin,
    upstreamOrigin: context.origin,
    buildId: (
      await readFile(
        path.join(workspaceRoot, "apps/storefront/.next/BUILD_ID"),
        "utf8",
      )
    ).trim(),
    nodeVersion: process.version,
    nextGeneration: context.next.generation(),
    readDiagnostics: false,
    fieldEvidence: false,
    physicalDeviceEvidence: false,
  };
  await writeFile(
    path.join(context.output, "performance-context.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  try {
    return await verifyPerformanceMatrix({
      ...context,
      origin: viewer.origin,
      workspaceRoot,
      diagnostic,
    });
  } finally {
    await writeFile(
      path.join(context.output, "performance-viewer-after.json"),
      JSON.stringify(viewer.snapshot(), null, 2) + "\n",
    );
  }
}

async function main() {
  assert.ok(
    args.every((arg) =>
      [internal, internal + "-diagnostic", "--diagnostic"].includes(arg),
    ),
    "Only owned performance flags are allowed; existing instances and external URLs are rejected",
  );
  assert.equal(
    process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS,
    undefined,
    "Performance measurements keep read diagnostics disabled",
  );
  if (childArgument) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) =>
      runAcceptanceFixture(database, s3, {
        serve: false,
        ui: true,
        performance: false,
        verifyBrowser: collect,
      }),
    );
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: internal + (diagnostic ? "-diagnostic" : ""),
        timeoutMs: 3_600_000,
      }),
    );
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      scope: "Owned P6-03 laboratory collection",
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    }),
  );
  process.exitCode = 1;
});
