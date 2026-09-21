#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { withEphemeralPostgres } from "../dist/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderAccessFixture } from "../../../apps/api/scripts/order-access-runtime.mjs";
import { verifyAdminFinance } from "./admin-finance-fixture.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const safeError = (error) => ({
  name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
  code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
  parameter:
    /inconsistent types deduced for parameter \$\d+/u.exec(
      error?.message ?? "",
    )?.[0] ?? null,
  detail: /^[a-z_ ]+ versus [a-z_ ]+$/u.test(error?.detail ?? "")
    ? error.detail
    : null,
  position: error?.position ?? null,
  guard:
    /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
      error?.where ?? "",
    )?.[1] ?? null,
  constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(error?.constraint ?? "")
    ? error.constraint
    : null,
});
async function inputs() {
  const files = [
    "database/migrations/0035_admin-finance.up.sql",
    "database/migrations/0035_admin-finance.down.sql",
    "database/migrations/0032_admin-order-resends.up.sql",
    "apps/api/scripts/admin-orders-fixtures.mjs",
  ];
  for (const folder of ["src", "dist", "scripts"])
    for (const name of await readdir(
      path.join(workspaceRoot, "packages/persistence-postgres", folder),
    ))
      if (/^admin-finance.*\.(?:ts|js|mjs)$/u.test(name))
        files.push(`packages/persistence-postgres/${folder}/${name}`);
  return Promise.all(
    files.sort().map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(path.join(workspaceRoot, name)))
        .digest("hex"),
    })),
  );
}
export async function runAdminFinance(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p5-03-refund-operations/storage",
    `run-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  const save = (name, value) =>
    writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
  let assertions = 0,
    stage = "prepare",
    status = "FAIL";
  const before = await inputs();
  await save("source-before.json", before);
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (label) => {
    stage = label;
    console.log(`Admin finance: ${label}`);
  };
  const originalQuery = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const result = originalQuery.apply(this, args);
    return result?.catch
      ? result.catch((error) => {
          console.error(
            `Admin finance PG ${JSON.stringify({ ...safeError(error), statement: typeof args[0] === "string" ? (args[0].match(/(?:INSERT INTO|UPDATE|FROM)\s+(?:public\.)?([a-z_]+)/iu)?.[1] ?? null) : null })}`,
          );
          throw error;
        })
      : result;
  };
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        const setupAssertions = assertions;
        const result = await verifyAdminFinance({ context });
        await save("protocol-results.json", {
          status: "PASS",
          setupAssertions,
          assertions: assertions - setupAssertions,
          result,
        });
      },
    });
    check(
      JSON.stringify(before) === JSON.stringify(await inputs()),
      "selected admin finance inputs remain byte-identical",
    );
    status = "PASS";
    console.log(`PASS admin finance repositories ${assertions}; ${output}`);
  } catch (error) {
    await save("failure.json", { stage, assertions, ...safeError(error) });
    throw error;
  } finally {
    Client.prototype.query = originalQuery;
    await save("run-result.json", {
      status,
      assertions,
      stage,
      completedAt: new Date().toISOString(),
      sourceUnchanged:
        JSON.stringify(before) === JSON.stringify(await inputs()),
    });
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  try {
    if (process.argv[2] === "--run-admin-finance") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) => runAdminFinance(database, s3));
    } else {
      assert.equal(process.argv.length, 2);
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-admin-finance",
          timeoutMs: 1200000,
        }),
      );
    }
  } catch (error) {
    console.error(`FAIL admin finance ${JSON.stringify(safeError(error))}`);
    process.exitCode = 1;
  }
