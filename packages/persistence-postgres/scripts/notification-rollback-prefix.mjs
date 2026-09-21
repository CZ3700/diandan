import assert from "node:assert/strict";
import { runMigrations } from "../dist/index.js";

const supportedHeads = ["0029", "0030", "0031", "0032"];

/** Legacy probes may rewind only explicitly known, empty migration prefixes. */
export async function rollbackEmptyNotifications({
  client,
  clientConfig,
  workspaceRoot,
  check = assert.deepEqual,
  migrate = runMigrations,
}) {
  const version = (
    await client.query(
      "SELECT max(version) AS version FROM public.schema_migrations",
    )
  ).rows[0]?.version;
  assert.ok(
    supportedHeads.includes(version),
    "legacy rollback probe requires a known exact current head",
  );
  const counts = {
    notifications: "public.notification_runtime_state",
    contact_accesses: "public.notification_contact_access_receipts",
    bootstraps: "public.order_access_tokens WHERE purpose='CHECKOUT_BOOTSTRAP'",
    expiries:
      "public.order_events WHERE authority_kind='SYSTEM' AND reason_code='CHECKOUT_QUOTE_EXPIRED'",
    ...(version >= "0030"
      ? {
          login_challenges: "public.admin_login_challenges",
          access_audits:
            "public.audit_logs WHERE action IN ('ADMIN_LOGIN_SUCCEEDED','ADMIN_LOGIN_REJECTED','ADMIN_SESSION_REVOKED','ADMIN_SESSIONS_REVOKED')",
        }
      : {}),
    ...(version >= "0031"
      ? {
          order_notes: "public.admin_order_notes",
          private_accesses: "public.admin_order_private_accesses",
          private_confirmations: "public.admin_order_private_confirmations",
          message_reviews: "public.admin_order_message_reviews",
          operation_receipts: "public.admin_order_operation_receipts",
          fulfillment_receipts: "public.admin_order_fulfillment_receipts",
          review_locale_grants: "public.admin_order_message_locale_grants",
          order_audits:
            "public.audit_logs WHERE action IN ('ORDER_NOTE_ADDED','ORDER_PRIVATE_READ','ORDER_MESSAGE_REVIEWED','ORDER_MESSAGE_LOCALE_GRANT','ORDER_MESSAGE_LOCALE_REVOKE','FULFILLMENT_STATUS_CHANGED')",
        }
      : {}),
    ...(version >= "0032"
      ? {
          resends: "public.admin_notification_resends",
          resend_outbox: "public.admin_notification_resend_outbox",
          resend_attempts: "public.admin_notification_resend_attempts",
          resend_contact_accesses:
            "public.admin_notification_resend_contact_access",
          resend_audits:
            "public.audit_logs WHERE action='RESEND_ORDER_NOTIFICATION' OR task_name='admin-order-resend'",
          resend_link_audits:
            "public.order_access_audits WHERE task_name='admin-order-resend'",
        }
      : {}),
  };
  // Read every retained-history guard before dropping even the first empty schema.
  // Each original down migration still executes its authoritative locking guards.
  check(
    (
      await client.query(`SELECT (SELECT max(version) FROM public.schema_migrations) AS version,
      ${Object.entries(counts)
        .map(
          ([name, table]) =>
            `(SELECT count(*)::integer FROM ${table}) AS ${name}`,
        )
        .join(",\n      ")}`)
    ).rows[0],
    {
      version,
      ...Object.fromEntries(Object.keys(counts).map((key) => [key, 0])),
    },
    "legacy rollback probe requires an exact known head without notification, bootstrap, SYSTEM expiry or admin history",
  );
  for (const current of supportedHeads
    .filter((head) => head <= version)
    .reverse()) {
    const reverted = await migrate({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: current },
    });
    check(
      [reverted.revertedVersions, reverted.currentVersion],
      [[current], String(Number(current) - 1).padStart(4, "0")],
      `normal migration runner reverts only empty ${current} support before the original rollback proof`,
    );
  }
}
