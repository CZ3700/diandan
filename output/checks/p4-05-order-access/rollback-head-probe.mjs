import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const require = createRequire(
  path.join(workspaceRoot, "packages/persistence-postgres/package.json"),
);
const { Client } = require("pg");
const { runMigrations, withEphemeralPostgres } = await import(
  pathToFileURL(
    path.join(workspaceRoot, "packages/persistence-postgres/dist/index.js"),
  )
);
const cases = [
  [
    "cart-runtime",
    "verifyCartRuntimeRollbackProtection",
    "0023",
    "fixture must contain a real accepted cart intent owned only through the daily rule",
    {},
  ],
  [
    "cart-runtime-pending",
    "verifyCartRuntimeRollbackProtection",
    "0023",
    "fixture must contain a real explicit-recipient pending intent without fabricated moderation",
    { mode: "PENDING" },
  ],
  [
    "cart-edit",
    "verifyCartEditRollbackProtection",
    "0024",
    "actual accepted edits must exist",
    {},
  ],
  [
    "checkout-preflight",
    "verifyCheckoutPreflightRollbackProtection",
    "0025",
    "normal accepted checkout must exist",
    {},
  ],
  [
    "payment-runtime",
    "verifyPaymentRuntimeRollbackProtection",
    "0026",
    "real dispatched payment history must exist",
    {},
  ],
  [
    "order-payment",
    "verifyOrderPaymentRollbackProtection",
    "0027",
    "real order-payment application receipts must exist",
    {},
  ],
];

test("all existing rollback helpers cross only empty 0028 and retain their original required-history boundary", async (t) => {
  await withEphemeralPostgres(async (clientConfig) => {
    const client = new Client(clientConfig);
    await client.connect();
    try {
      for (const [name, exported, expectedHead, message, options] of cases) {
        await t.test(name, async () => {
          await runMigrations({
            clientConfig,
            workspaceRoot,
            command: { direction: "up" },
          });
          const filename =
            name === "cart-runtime-pending" ? "cart-runtime" : name;
          const helper = await import(
            pathToFileURL(
              path.join(
                workspaceRoot,
                `packages/persistence-postgres/scripts/${filename}-rollback-proof.mjs`,
              ),
            )
          );
          try {
            await assert.rejects(
              helper[exported]({ clientConfig, workspaceRoot, ...options }),
              { name: "AssertionError", message },
            );
            assert.equal(
              (
                await client.query(
                  "SELECT max(version) version FROM public.schema_migrations",
                )
              ).rows[0].version,
              expectedHead,
            );
          } finally {
            const restored = await runMigrations({
              clientConfig,
              workspaceRoot,
              command: { direction: "up" },
            });
            assert.equal(restored.currentVersion, "0028");
          }
        });
      }
    } finally {
      await client.end();
    }
  });
});
