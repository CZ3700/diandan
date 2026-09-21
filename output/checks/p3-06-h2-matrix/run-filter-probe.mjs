#!/usr/bin/env node
import assert from "node:assert/strict";
import { verifyBrowser } from "./probe-filter.mjs";

const internalArgument = "--run-owned-filter-probe";

async function main() {
  assert.ok(process.argv.slice(2).every((value) => value === internalArgument));
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

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      scope: "TEST mobile filter supplemental evidence",
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    }),
  );
  process.exitCode = 1;
}
