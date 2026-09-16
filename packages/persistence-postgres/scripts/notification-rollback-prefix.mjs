import assert from "node:assert/strict";
import { runMigrations } from "../dist/index.js";

/** Legacy probes may rewind 0029 only when no new durable history exists. */
export async function rollbackEmptyNotifications({
  client,
  clientConfig,
  workspaceRoot,
  check = assert.deepEqual,
}) {
  check(
    (
      await client.query(`SELECT
      (SELECT max(version) FROM public.schema_migrations) AS version,
      (SELECT count(*)::integer FROM public.notification_runtime_state) AS notifications,
      (SELECT count(*)::integer FROM public.notification_contact_access_receipts) AS contact_accesses,
      (SELECT count(*)::integer FROM public.order_access_tokens WHERE purpose='CHECKOUT_BOOTSTRAP') AS bootstraps,
      (SELECT count(*)::integer FROM public.order_events WHERE authority_kind='SYSTEM' AND reason_code='CHECKOUT_QUOTE_EXPIRED') AS expiries`)
    ).rows[0],
    {
      version: "0029",
      notifications: 0,
      contact_accesses: 0,
      bootstraps: 0,
      expiries: 0,
    },
    "legacy rollback probe requires an exact current head without notification, bootstrap or SYSTEM expiry history",
  );
  const reverted = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "down", confirmVersion: "0029" },
  });
  check(
    [reverted.revertedVersions, reverted.currentVersion],
    [["0029"], "0028"],
    "normal migration runner reverts only empty notification support before the original rollback proof",
  );
}
