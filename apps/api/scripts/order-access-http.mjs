#!/usr/bin/env node
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
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
import { withOrderAccessFixture } from "./order-access-runtime.mjs";
import { verifyOrderAccessProtocol } from "./order-access-protocol.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const safeFailure = (error) => ({
  kind: error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME",
  name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
  issues: Array.isArray(error?.issues)
    ? error.issues.map((issue) => ({ code: issue.code, path: issue.path }))
    : [],
  code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
});
function observePostgres(sqlStates) {
  const original = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const result = original.apply(this, args);
    if (!result?.catch) return result;
    return result.catch((error) => {
      if (/^[A-Z0-9]{5}$/u.test(error?.code ?? ""))
        sqlStates.getStore()?.push(error.code);
      const sql = typeof args[0] === "string" ? args[0] : args[0]?.text;
      console.error(
        `Order access PostgreSQL ${JSON.stringify({ operation: sql === "COMMIT" ? "COMMIT" : "STATEMENT", code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null, guard: /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(error?.where ?? "")?.[1] ?? null, constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(error?.constraint ?? "") ? error.constraint : null })}`,
      );
      throw error;
    });
  };
  return () => {
    Client.prototype.query = original;
  };
}

export async function runOrderAccess(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p4-05-order-access",
    `run-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  const save = (name, value) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
  let assertions = 0,
    stage = "seed",
    status = "FAIL";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Order access: ${stage}`);
  };
  const sqlStates = new AsyncLocalStorage();
  const restore = observePostgres(sqlStates);
  try {
    await withOrderAccessFixture({
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
        const result = await verifyOrderAccessProtocol({
          ...context,
          observeSqlStates(work) {
            const observed = [];
            return {
              sqlStates: observed,
              promise: sqlStates.run(observed, work),
            };
          },
        });
        await save("protocol-checkpoint.json", {
          schemaVersion: 1,
          status: "PASS",
          setupAssertions,
          assertions: assertions - setupAssertions,
          result,
        });
        await save("protocol-results.json", {
          schemaVersion: 1,
          status: "PASS",
          setupAssertions,
          assertions: assertions - setupAssertions,
          result,
          actualAwsKms: false,
          actualPspSandbox: false,
        });
      },
    });
    status = "PASS";
    console.log(`PASS order access ${assertions} assertions; ${output}`);
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
    assert.ok(
      process.argv.length === 2 ||
        (process.argv.length === 3 && process.argv[2] === "--run-order-access"),
      "Unknown order access option",
    );
    if (process.argv[2] === "--run-order-access") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) => runOrderAccess(database, s3));
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-order-access",
          timeoutMs: 1_200_000,
        }),
      );
  } catch (error) {
    console.error(`FAIL order access ${JSON.stringify(safeFailure(error))}`);
    process.exitCode = 1;
  }
}
