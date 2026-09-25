#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withPaymentRuntimeFixture } from "./payment-runtime-runtime.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
function safeFailure(error) {
  return {
    kind: error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME",
    code:
      typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)
        ? error.code
        : null,
  };
}
function observePostgres() {
  const original = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const value = original.apply(this, args);
    if (!value?.catch) return value;
    return value.catch((error) => {
      const sql = typeof args[0] === "string" ? args[0] : args[0]?.text;
      console.error(
        `Checkout PostgreSQL ${JSON.stringify({ operation: sql === "COMMIT" ? "COMMIT" : "STATEMENT", code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null, guard: /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(error?.where ?? "")?.[1] ?? null, constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(error?.constraint ?? "") ? error.constraint : null })}`,
      );
      throw error;
    });
  };
  return () => {
    Client.prototype.query = original;
  };
}
export async function runPaymentRuntime(database, s3, { ui = false } = {}) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p4-04-payment-runtime",
    `run-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  let assertions = 0,
    stage = "seed";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Payment runtime: ${value}`);
  };
  const save = (file, value) =>
    writeFile(path.join(output, file), JSON.stringify(value, null, 2) + "\n");
  const restore = observePostgres();
  let status = "FAIL",
    browserStarted = false;
  try {
    await withPaymentRuntimeFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        await save("fixture-manifest.json", {
          ...context.manifest,
          profiles: context.profiles,
          paymentConfiguration: context.published,
          actualPspSandbox: false,
        });
        const setupAssertions = assertions;
        const setupRequests = context.content.requestCount();
        progress("real checkout protocol");
        const protocol = await (
          await import("./payment-runtime-protocol.mjs")
        ).verifyPaymentRuntimeProtocol(context);
        protocol.retry = await (
          await import("./payment-runtime-retry-protocol.mjs")
        ).verifyPaymentRuntimeRetryProtocol(context);
        protocol.commitFaults = await (
          await import("./payment-runtime-commit-faults.mjs")
        ).verifyPaymentRuntimeCommitFaults(context);
        await save("protocol-checkpoint.json", {
          schemaVersion: 1,
          status: "PASS",
          protocol,
          assertions: assertions - setupAssertions,
          setupAssertions,
          scope:
            "Actual HTTP/PG/TEST PSP protocol before browser and migration checks",
        });
        let browser;
        if (ui) {
          progress("compiled checkout website and actual hosted browser");
          const next = (
            await import("./payment-runtime-next.mjs")
          ).createPaymentRuntimeNext(context);
          context.own("owned payment storefront Next", () => next.stop());
          await next.start();
          browserStarted = true;
          browser = await (
            await import("./payment-runtime-browser.mjs")
          ).verifyPaymentRuntimeBrowser(context);
          await next.stop();
        }
        progress("actual payment rollback protection");
        const rollback = await (
          await import("../../../packages/persistence-postgres/scripts/payment-runtime-rollback-proof.mjs")
        ).verifyPaymentRuntimeRollbackProtection({
          clientConfig: database,
          workspaceRoot,
        });
        await save("protocol-results.json", {
          schemaVersion: 1,
          status: "PASS",
          assertions: assertions - setupAssertions,
          setupAssertions,
          setupRequests,
          protocolOperatorRequests:
            context.content.requestCount() - setupRequests,
          protocol,
          rollback,
          actualPostgres: true,
          actualTlsS3: true,
          actualKmsAdapter: true,
          actualAwsKms: false,
          browserEvidence: Boolean(browser),
          browserSummary: browser
            ? {
                status: browser.status,
                cases: browser.cases.length,
                screenshots: browser.screenshots.length,
                axe: browser.axe.length,
              }
            : null,
          paymentProviderEvidence: "PERSISTENT_TEST_PSP_ONLY",
          actualPspSandbox: false,
        });
      },
    });
    status = "PASS";
    console.log(`PASS payment runtime ${assertions} assertions; ${output}`);
  } catch (error) {
    await save("failure.json", {
      schemaVersion: 1,
      status: "FAIL",
      stage,
      assertions,
      ...safeFailure(error),
    });
    throw error;
  } finally {
    restore();
    await save("run-result.json", {
      schemaVersion: 1,
      status,
      assertions,
      ownedFixtureCleanupAttempted: true,
      browserStarted,
      completedAt: new Date().toISOString(),
    });
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const internal = process.argv
      .slice(2)
      .find((value) =>
        /^--run-payment-runtime(?:-production-ui)?$/u.test(value),
      );
    const ui = internal
      ? internal.endsWith("-ui")
      : process.argv.includes("--ui");
    const production = internal
      ? internal.includes("-production")
      : process.argv.includes("--production");
    assert.ok(!ui || production, "Payment browser requires a production build");
    assert.ok(
      process.argv
        .slice(2)
        .every(
          (value) =>
            value === internal || ["--production", "--ui"].includes(value),
        ),
      "Unknown payment runtime option",
    );
    if (internal) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runPaymentRuntime(database, s3, { ui }),
      );
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: `--run-payment-runtime${ui ? "-production-ui" : ""}`,
          timeoutMs: 1_200_000,
        }),
      );
  } catch (error) {
    console.error(`FAIL payment runtime ${JSON.stringify(safeFailure(error))}`);
    process.exitCode = 1;
  }
}
