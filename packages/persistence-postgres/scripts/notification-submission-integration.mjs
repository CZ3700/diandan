#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "../dist/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderAccessFixture } from "../../../apps/api/scripts/order-access-runtime.mjs";
import { verifyNotificationSubmissions } from "./notification-submission-fixture.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const runId =
  process.env["NOTIFICATION_SUBMISSION_TEST_RUN"] ?? String(Date.now());
assert.match(runId, /^[0-9]+$/u);
process.env["NOTIFICATION_SUBMISSION_TEST_RUN"] = runId;
const output = path.join(
  workspaceRoot,
  "output/checks/l3-zeptomail/backend",
  `postgres-${runId}`,
);
async function run(database, s3) {
  await mkdir(output, { recursive: true });
  let checks = 0,
    stage = "setup",
    status = "FAIL",
    result;
  const check = (condition, label) => {
    checks++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress: (label) => {
        stage = label;
      },
      verify: async (context) => {
        result = await verifyNotificationSubmissions(context, workspaceRoot);
      },
    });
    status = "CHECKS_PASSED";
  } catch (error) {
    console.error(
      JSON.stringify({
        stage,
        error: error?.name,
        code: error?.code,
        reason: error?.failure?.error?.code,
        assertion: error?.name === "AssertionError",
      }),
    );
    throw error;
  } finally {
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(
        { schemaVersion: 1, status, checks, stage, result },
        null,
        2,
      ) + "\n",
    );
  }
}
try {
  if (process.argv[2] === "--owned-submissions") {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => run(database, s3));
  } else {
    assert.equal(process.argv.length, 2);
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--owned-submissions",
        timeoutMs: 300000,
      }),
    );
    const report = JSON.parse(
      await readFile(path.join(output, "report.json"), "utf8"),
    );
    assert.equal(report.status, "CHECKS_PASSED");
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(
        { ...report, status: "PASS", ownedRuntimeCleanup: true },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        status: "PASS",
        checks: report.checks,
        output,
        ownedRuntimeCleanup: true,
      }),
    );
  }
} catch {
  console.error("Native mail submission PG verification failed");
  if (process.argv[2] !== "--owned-submissions") {
    await mkdir(output, { recursive: true });
    const prior = await readFile(path.join(output, "report.json"), "utf8")
      .then(JSON.parse)
      .catch(() => ({}));
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(
        { ...prior, status: "FAIL", ownedRuntimeCleanup: false },
        null,
        2,
      ) + "\n",
    );
  }
  process.exitCode = 1;
}
