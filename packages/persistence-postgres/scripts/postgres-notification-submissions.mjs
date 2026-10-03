#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let checks = 0;
let stage = "migration";
const check = (condition, label) => {
  stage = label;
  assert.ok(condition, label);
  checks++;
};
try {
  await withEphemeralPostgres(async (clientConfig) => {
    // The runner only rolls back the applied head, so the 0050 round trip runs
    // while 0050 is the head; the current head is applied on top at the end.
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0050" },
    });
    const client = new Client(clientConfig);
    await client.connect();
    try {
      check(
        (
          await client.query(
            "SELECT to_regclass('public.notification_submissions') name",
          )
        ).rows[0].name === "notification_submissions",
        "native submission journal is migrated",
      );
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0050" },
      });
      check(
        (
          await client.query(
            "SELECT to_regclass('public.notification_submissions') name",
          )
        ).rows[0].name === null,
        "empty journal rolls back without touching notifications",
      );
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up", targetVersion: "0050" },
      });
      check(
        (
          await client.query(
            "SELECT max(version) version FROM schema_migrations",
          )
        ).rows[0].version === "0050",
        "0050 re-applies after rollback",
      );
      const current = await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up" },
      });
      const head = (
        await client.query(
          "SELECT to_regclass('public.notification_submissions')::text AS name, max(version) AS version FROM schema_migrations",
        )
      ).rows[0];
      check(
        head.name === "notification_submissions" &&
          head.version === current.currentVersion,
        "later migrations apply on top of the restored journal",
      );
    } finally {
      await client.end();
    }
  });
  console.log(
    JSON.stringify({
      suite: "notification-submissions-migration",
      status: "PASS",
      checks,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      suite: "notification-submissions-migration",
      status: "FAIL",
      stage,
      checks,
    }),
  );
  process.exitCode = 1;
}
