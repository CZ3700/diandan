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
import { withCheckoutPreflightFixture } from "./checkout-preflight-runtime.mjs";

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
export async function runCheckoutPreflight(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p4-03-checkout-preflight",
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
    console.log(`Checkout preflight: ${value}`);
  };
  const save = (file, value) =>
    writeFile(path.join(output, file), JSON.stringify(value, null, 2) + "\n");
  const restore = observePostgres();
  let status = "FAIL";
  try {
    await withCheckoutPreflightFixture({
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
        });
        const setupAssertions = assertions;
        const setupRequests = context.content.requestCount();
        progress("real checkout protocol");
        const protocol = await (
          await import("./checkout-preflight-protocol.mjs")
        ).verifyCheckoutPreflightProtocol(context);
        progress("actual checkout rollback protection");
        const rollback = await (
          await import("../../../packages/persistence-postgres/scripts/checkout-preflight-rollback-proof.mjs")
        ).verifyCheckoutPreflightRollbackProtection({
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
          browserEvidence: false,
          paymentProviderEvidence: false,
        });
      },
    });
    status = "PASS";
    console.log(`PASS checkout preflight ${assertions} assertions; ${output}`);
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
      browserStarted: false,
      completedAt: new Date().toISOString(),
    });
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const internal = process.argv.includes("--run-checkout-preflight");
    assert.ok(
      process.argv
        .slice(2)
        .every((value) => value === "--run-checkout-preflight"),
      "Unknown checkout preflight option",
    );
    if (internal) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runCheckoutPreflight(database, s3),
      );
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-checkout-preflight",
          timeoutMs: 1_200_000,
        }),
      );
  } catch (error) {
    console.error(
      `FAIL checkout preflight ${JSON.stringify(safeFailure(error))}`,
    );
    process.exitCode = 1;
  }
}
