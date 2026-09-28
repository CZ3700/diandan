#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
import { verifyAdminNotificationResends } from "./admin-notification-resend-fixture.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
async function inputs() {
  const files = new Set([
    "database/migrations/0032_admin-order-resends.up.sql",
    "database/migrations/0050_notification-submissions.up.sql",
    "packages/persistence-postgres/scripts/notification-fulfillment-fixture.mjs",
    "database/migrations/0032_admin-order-resends.down.sql",
    "packages/application/src/admin-order-resends.ts",
    "packages/application/dist/admin-order-resends.js",
    "packages/persistence-postgres/src/admin-orders-authorization.ts",
    "packages/persistence-postgres/dist/admin-orders-authorization.js",
    "apps/worker/src/notification-composition.ts",
    "apps/worker/dist/notification-composition.js",
    "apps/worker/src/reliable-events-composition.ts",
    "apps/worker/dist/reliable-events-composition.js",
  ]);
  for (const [directory, pattern] of [
    [
      "packages/persistence-postgres/src",
      /^(?:admin-notification-resend|notification-).*\.ts$/u,
    ],
    [
      "packages/persistence-postgres/dist",
      /^(?:admin-notification-resend|notification-).*\.js$/u,
    ],
    [
      "packages/persistence-postgres/scripts",
      /^admin-notification-resend.*\.mjs$/u,
    ],
  ]) {
    for (const name of await readdir(path.join(workspaceRoot, directory)))
      if (pattern.test(name)) files.add(`${directory}/${name}`);
  }
  return Object.fromEntries(
    await Promise.all(
      [...files].sort().map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(path.join(workspaceRoot, name)))
          .digest("hex"),
      ]),
    ),
  );
}
const safeError = (error) => ({
  name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
  code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
  guard:
    /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
      error?.where ?? "",
    )?.[1] ?? null,
  constraint: /^[a-z_][a-z_0-9]{0,127}$/u.test(error?.constraint ?? "")
    ? error.constraint
    : null,
  frames:
    typeof error?.stack === "string"
      ? [
          ...error.stack.matchAll(
            /\/(?:apps|packages)\/[A-Za-z0-9_./-]+:\d+:\d+/gu,
          ),
        ]
          .slice(0, 8)
          .map((match) => match[0])
      : [],
});
async function run(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p5-02-order-operations/notification-resends",
    `run-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  const before = await inputs();
  await writeFile(
    path.join(output, "source-before.json"),
    JSON.stringify(before, null, 2) + "\n",
  );
  let checks = 0,
    stage = "setup",
    status = "FAIL",
    result;
  const check = (condition, label) => {
    checks++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (label) => {
    stage = label;
    console.log(`RESEND ${label}`);
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
        result = await verifyAdminNotificationResends(context);
      },
    });
    check(
      JSON.stringify(before) === JSON.stringify(await inputs()),
      "selected notification resend sources and built inputs remain unchanged during the run",
    );
    status = "PASS";
    console.log(`PASS operator notification resend ${checks}; ${output}`);
  } catch (error) {
    await writeFile(
      path.join(output, "failure.json"),
      JSON.stringify({ stage, checks, ...safeError(error) }, null, 2) + "\n",
    );
    console.error(JSON.stringify(safeError(error)));
    throw error;
  } finally {
    const after = await inputs();
    await writeFile(
      path.join(output, "source-after.json"),
      JSON.stringify(after, null, 2) + "\n",
    );
    await writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          status,
          checks,
          stage,
          result,
          sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
          fingerprintScope:
            "Selected manual and automatic notification sources, built runtime and local test scripts; whole-repository candidate provenance is separate.",
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
  }
}
try {
  if (process.argv[2] === "--run-admin-resends") {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => run(database, s3));
  } else {
    assert.equal(process.argv.length, 2);
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--run-admin-resends",
        timeoutMs: 1200000,
      }),
    );
  }
} catch (error) {
  console.error(`FAIL operator resend ${JSON.stringify(safeError(error))}`);
  process.exitCode = 1;
}
