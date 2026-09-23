#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withAcceptanceFixture } from "./storefront-acceptance-runtime.mjs";
import { withAcceptanceBrowser } from "./storefront-acceptance-browser.mjs";
import { createRegressionSeoFaults } from "./regression-seo-faults.mjs";
import { verifyRegressionSeoRecovery } from "./regression-seo-recovery.mjs";
import { verifyRegressionEnglishSourcePurge } from "./regression-seo-purge.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
function failure(error) {
  return {
    name: error?.name,
    assertion: error?.name === "AssertionError" ? error.message : null,
    issues:
      error?.name === "ZodError"
        ? error.issues.map(({ code, path }) => ({ code, path }))
        : [],
    causes: error instanceof AggregateError ? error.errors.map(failure) : [],
  };
}
export async function runRegressionSeo(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p6-01-regression",
    `seo-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`,
  );
  await mkdir(output, { recursive: true });
  let assertions = 0;
  const check = (value, label) => {
    assertions++;
    assert.ok(value, label);
  };
  const faults = createRegressionSeoFaults();
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    assertions,
    actualPostgres: true,
    actualTlsS3: true,
    actualCompiledBrowser: true,
    scope:
      "SPEC 18.2 #13 incident English recovery and #14 exact English-source purge",
    actualCdn: false,
    merchantAcceptance: false,
    cloudAcceptance: false,
    humanAcceptance: false,
  };
  const save = async () => {
    report.assertions = assertions;
    await writeFile(
      path.join(output, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  };
  try {
    await withAcceptanceFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress: (stage) => console.log(`SEO regression: ${stage}`),
      diagnostics: { createReadPersistence: faults.createReadPersistence },
      verify: async (context) => {
        await writeFile(
          path.join(output, "fixture-manifest.json"),
          JSON.stringify(context.manifest, null, 2) + "\n",
        );
        await context.startStorefront();
        await withAcceptanceBrowser(context, async (browser) => {
          report.recovery = await verifyRegressionSeoRecovery({
            ...context,
            faults,
            browser,
          });
          const browserContext = await browser.newContext({
            viewport: { width: 390, height: 844 },
            reducedMotion: "reduce",
          });
          try {
            report.purge = await verifyRegressionEnglishSourcePurge({
              ...context,
              faults,
              page: await browserContext.newPage(),
            });
          } finally {
            await browserContext.close();
          }
        });
      },
    });
    report.status = "PASS";
    await save();
    console.log(`PASS SEO regression (${assertions} assertions); ${output}`);
    return report;
  } catch (error) {
    report.status = "FAIL";
    report.failure = failure(error);
    await save();
    throw error;
  } finally {
    faults.clear();
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(
      process.argv
        .slice(2)
        .every((argument) => argument === "--run-regression-seo"),
      "Unknown SEO regression option",
    );
    if (process.argv.includes("--run-regression-seo")) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) => runRegressionSeo(database, s3));
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-regression-seo",
          timeoutMs: 1500000,
        }),
      );
  } catch (error) {
    console.error(`FAIL SEO regression ${JSON.stringify(failure(error))}`);
    process.exitCode = 1;
  }
}
