#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const internalArgument = "--run-compositor-diagnostic";
async function verifyBrowser(context) {
  const { verifyGiftTraceComparison } =
    await import("../../../apps/api/scripts/storefront-gift-trace-verification.mjs");
  return verifyGiftTraceComparison({
    ...context,
    mode: "candidate",
    traceProfile: "compositor-diagnostic",
  });
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
        verifyBrowser,
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
