#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
import { createPersistentNotificationGatewayHarness } from "../../../apps/worker/scripts/notification-gateway-harness.mjs";
import { verifyNotificationWorker } from "../../../apps/worker/scripts/notification-worker-fixture.mjs";
import { verifyOrderNotifications } from "./notification-fixture.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const safeError = (error) => ({
  name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
  code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
});
async function inputs() {
  const files = new Set([
    "database/migrations/0029_notifications.up.sql",
    "packages/persistence-postgres/src/postgres-persistence.ts",
    "packages/persistence-postgres/dist/postgres-persistence.js",
    "packages/contracts/src/order-notification.ts",
    "packages/contracts/dist/order-notification.js",
    "packages/persistence-port/src/order-notification.ts",
    "packages/persistence-port/dist/order-notification.js",
    "apps/api/scripts/order-access-runtime.mjs",
    "apps/api/scripts/order-payment-client.mjs",
    "apps/api/scripts/checkout-preflight-client.mjs",
    "apps/worker/scripts/notification-worker-fixture.mjs",
    "apps/worker/scripts/notification-link-browser.mjs",
    "apps/api/scripts/payment-runtime-next.mjs",
    "apps/api/scripts/order-storefront-gateway.mjs",
    "apps/api/scripts/order-storefront-observer.mjs",
    "apps/storefront/next.config.ts",
    "apps/worker/src/reliable-events-composition.ts",
    "apps/worker/src/reliable-events-runtime.ts",
    "apps/worker/dist/reliable-events-composition.js",
    "apps/worker/dist/reliable-events-runtime.js",
    "packages/application/src/notification-credentials.ts",
    "packages/application/src/notification-recipient.ts",
    "packages/application/dist/notification-credentials.js",
    "packages/application/dist/notification-recipient.js",
  ]);
  const prefixes = [
    [
      "packages/persistence-postgres/src",
      /^(?:notification-|order-access-).*\.ts$/u,
    ],
    [
      "packages/persistence-postgres/dist",
      /^(?:notification-|order-access-).*\.js$/u,
    ],
    ["packages/persistence-postgres/scripts", /^notification-.*\.mjs$/u],
    ["packages/application/src", /^order-notification.*\.ts$/u],
    ["packages/application/dist", /^order-notification.*\.js$/u],
    ["packages/notification-provider/src", /^gateway.*\.ts$/u],
    ["packages/notification-provider/dist", /^gateway.*\.js$/u],
    ["apps/worker/scripts", /^notification-gateway.*\.mjs$/u],
  ];
  for (const [directory, pattern] of prefixes)
    for (const file of await readdir(path.join(workspaceRoot, directory)))
      if (pattern.test(file) && !file.includes(".test."))
        files.add(`${directory}/${file}`);
  async function tree(directory) {
    for (const item of await readdir(path.join(workspaceRoot, directory), {
      withFileTypes: true,
    })) {
      const name = `${directory}/${item.name}`;
      if (item.isDirectory()) await tree(name);
      else if (
        /\.(?:tsx?|js|json|css)$/u.test(name) &&
        !name.includes(".test.") &&
        !name.endsWith(".d.ts")
      )
        files.add(name);
    }
  }
  await tree("packages/i18n/src/notifications");
  await tree("packages/i18n/dist/notifications");
  await tree("apps/storefront/src");
  return Promise.all(
    [...files].sort().map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(path.join(workspaceRoot, name)))
        .digest("hex"),
    })),
  );
}

export async function runOrderNotifications(
  database,
  s3,
  { verifyWorker = verifyNotificationWorker } = {},
) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p4-06-notifications/persistence",
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
    console.log(`Order notification: ${label}`);
  };
  const originalQuery = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const result = originalQuery.apply(this, args);
    return result?.catch
      ? result.catch((error) => {
          console.error(
            `Notification PG ${JSON.stringify({
              ...safeError(error),
              guard:
                /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
                  error?.where ?? "",
                )?.[1] ?? null,
              constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(
                error?.constraint ?? "",
              )
                ? error.constraint
                : null,
            })}`,
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
        const result = await verifyOrderNotifications({
          context,
          transportFactory: createPersistentNotificationGatewayHarness,
        });
        const worker = verifyWorker ? await verifyWorker(context) : null;
        await save("protocol-results.json", {
          status: "PASS",
          setupAssertions,
          assertions: assertions - setupAssertions,
          result,
          worker,
          scope:
            "Actual Application, PostgreSQL, HTTPS receiver and owned TEST PSP; optional worker hook is reported separately, never implied.",
        });
      },
    });
    check(
      JSON.stringify(before) === JSON.stringify(await inputs()),
      "selected notification source/runtime inputs remain byte-identical during this run",
    );
    status = "PASS";
    console.log(`PASS order notifications ${assertions}; ${output}`);
  } catch (error) {
    await save("failure.json", { stage, assertions, ...safeError(error) });
    throw error;
  } finally {
    Client.prototype.query = originalQuery;
    const after = await inputs();
    await save("source-after.json", after);
    await save("run-result.json", {
      status,
      assertions,
      sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
      fingerprintScope:
        "Selected notification implementation, source contracts, templates and directly selected harness inputs; final whole-repository provenance is separate.",
      completedAt: new Date().toISOString(),
    });
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--run-order-notifications") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runOrderNotifications(database, s3),
      );
    } else {
      assert.equal(process.argv.length, 2);
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-order-notifications",
          timeoutMs: 1200000,
        }),
      );
    }
  } catch (error) {
    console.error(
      `FAIL order notifications ${JSON.stringify(safeError(error))}`,
    );
    process.exitCode = 1;
  }
}
