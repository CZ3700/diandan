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
  "output/checks/p3-06-critical-path/stage.json",
);
const internalArgument = "--run-gift-trace-comparison";

function parseGiftTraceMode(value) {
  assert.deepEqual(Object.keys(value).sort(), ["schemaVersion", "stage"]);
  assert.equal(value.schemaVersion, 1);
  assert.ok(["baseline", "candidate", "ui"].includes(value.stage));
  return value.stage;
}
async function verifyBrowser(context) {
  const stage = parseGiftTraceMode(
    JSON.parse(await readFile(modeFile, "utf8")),
  );
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path.join(context.output, "critical-path-stage.json"),
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
  const { verifyGiftTraceComparison } =
    await import("../../../apps/api/scripts/storefront-gift-trace-verification.mjs");
  return verifyGiftTraceComparison({ ...context, mode: "candidate" });
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
