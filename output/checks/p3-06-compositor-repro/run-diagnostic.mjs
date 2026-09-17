#!/usr/bin/env node
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const internalArgument = "--run-compositor-diagnostic";
async function verifyBrowser(context) {
  const { verifyGiftTraceComparison } =
    await import("../../../apps/api/scripts/storefront-gift-trace-verification.mjs");
  const generation = context.next.generation();
  const results = {
    schemaVersion: 1,
    status: "RUNNING",
    fixedGroups: 4,
    fixedNavigationsPerGroup: 3,
    formalPerformanceAcceptance: false,
    traceProfile: "compositor-diagnostic",
    buildGeneration: generation,
    groups: [],
  };
  const save = () =>
    writeFile(
      path.join(context.output, "reproduction-groups.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
  const failures = [];
  await save();
  for (let group = 1; group <= 4; group++) {
    const output = path.join(
      path.dirname(context.output),
      `compositor-group-${group}`,
    );
    const entry = { group, output, status: "RUNNING" };
    results.groups.push(entry);
    await save();
    try {
      assert.equal(
        context.next.generation(),
        generation,
        "One fixed build for all groups",
      );
      const report = await verifyGiftTraceComparison({
        ...context,
        output,
        mode: "candidate",
        traceProfile: "compositor-diagnostic",
      });
      entry.status = report.status;
      entry.attempts = report.attempts.length;
    } catch (error) {
      entry.status = "FAIL";
      entry.failure = {
        name: error?.name ?? "UnknownFailure",
        assertion: error?.name === "AssertionError" ? error.message : null,
      };
      failures.push(error);
    }
    await save();
  }
  results.status = failures.length ? "FAIL" : "COLLECTED_DIAGNOSTIC";
  await save();
  if (failures.length)
    throw new AggregateError(
      failures,
      "Fixed diagnostic groups include failures; all groups retained",
    );
  return results;
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
        scope: "TEST fixed compositor reproduction",
        name: error?.name,
        assertion: error?.name === "AssertionError" ? error.message : null,
      }),
    );
    process.exitCode = 1;
  }
}
