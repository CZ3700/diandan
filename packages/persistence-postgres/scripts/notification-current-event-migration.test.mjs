import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import {
  assertCatalogMatches,
  captureDatabaseCatalog,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const headVersion = "0065";
const guardMessage =
  "notification resend history cannot be downgraded to aggregate-based stages";

test("notification stage migration restores the prior catalog only without retained resend history", async () => {
  await withEphemeralPostgres(async (clientConfig) => {
    const migrate = (command) =>
      runMigrations({ clientConfig, workspaceRoot, command });
    await migrate({ direction: "up", targetVersion: "0064" });
    const client = new Client(clientConfig);
    await client.connect();
    const capture = () =>
      captureDatabaseCatalog({
        query: async (text, values = []) => {
          const result = await client.query(text, [...values]);
          return { rows: result.rows };
        },
      });
    const evidence = async () =>
      (
        await client.query(`SELECT
          (SELECT max(version) FROM public.schema_migrations) AS head,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.version)::text,'[]')) FROM public.schema_migrations m) AS migrations_hash,
          md5(pg_get_functiondef('public.admin_notification_current_event(uuid)'::regprocedure)) AS function_hash,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM public.audit_logs a) AS audit_hash,
          (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'[]')) FROM public.admin_notification_resends r) AS resend_hash`)
      ).rows[0];
    const insertAudit = (action, task) =>
      client.query(
        "INSERT INTO public.audit_logs(id,actor_type,task_name,action,subject_type,subject_id,outcome) VALUES($1,'SYSTEM',$2,$3,'ORDER',$4,'SUCCEEDED')",
        [randomUUID(), task, action, randomUUID()],
      );
    try {
      const originalCatalog = await capture();
      const original = await evidence();
      const upgraded = await migrate({
        direction: "up",
        targetVersion: headVersion,
      });
      assert.equal(upgraded.currentVersion, headVersion);
      assert.deepEqual(upgraded.appliedVersions, [headVersion]);
      const currentCatalog = await capture();
      const current = await evidence();
      assert.notEqual(current.function_hash, original.function_hash);
      assert.equal(
        (
          await client.query(
            "SELECT public.admin_notification_current_event($1::uuid) event",
            [randomUUID()],
          )
        ).rows[0].event,
        null,
      );
      assert.deepEqual(
        (await migrate({ direction: "down", confirmVersion: headVersion }))
          .revertedVersions,
        [headVersion],
      );
      assert.equal((await evidence()).function_hash, original.function_hash);
      assertCatalogMatches(await capture(), originalCatalog);
      await migrate({ direction: "up", targetVersion: headVersion });
      assertCatalogMatches(await capture(), currentCatalog);

      const down = await readFile(
        new URL(
          "../../../database/migrations/0065_notification-current-event.down.sql",
          import.meta.url,
        ),
        "utf8",
      );
      // Explicit TEST audit fixtures prove each guard without manufacturing business payments.
      for (const [action, task] of [
        ["RESEND_ORDER_NOTIFICATION", "migration-proof"],
        ["AUTHORIZE_NOTIFICATION_CONTACT_READ", "admin-order-resend"],
      ]) {
        await client.query("BEGIN");
        try {
          await insertAudit(action, task);
          const before = await evidence();
          assert.equal(before.head, headVersion);
          await client.query("SAVEPOINT retained_history");
          await assert.rejects(
            client.query(down),
            (error) => error.code === "55000" && error.message === guardMessage,
          );
          await client.query("ROLLBACK TO SAVEPOINT retained_history");
          assert.deepEqual(await evidence(), before);
        } finally {
          await client.query("ROLLBACK");
        }
      }

      // Commit one owned TEST audit so the ordinary runner sees the same genuine latest-head guard.
      await insertAudit("RESEND_ORDER_NOTIFICATION", "migration-proof");
      const retained = await evidence();
      assert.equal(retained.head, headVersion);
      await assert.rejects(
        migrate({ direction: "down", confirmVersion: headVersion }),
        {
          name: "MigrationExecutionError",
          message: "migration 0065 down failed",
        },
      );
      assert.deepEqual(await evidence(), retained);
    } catch (error) {
      if (error instanceof assert.AssertionError)
        console.error("Notification migration assertion:", error.message);
      throw error;
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
