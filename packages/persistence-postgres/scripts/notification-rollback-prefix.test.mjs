import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { rollbackEmptyNotifications } from "./notification-rollback-prefix.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const supportedHeads = [
  "0029",
  "0030",
  "0031",
  "0032",
  "0033",
  "0034",
  "0035",
  "0036",
  "0037",
  "0038",
  "0039",
  "0040",
  "0041",
  "0042",
  "0043",
  "0044",
  "0045",
  "0046",
  "0047",
  "0048",
  "0049",
  "0050",
  "0051",
  "0052",
  "0053",
  "0054",
  "0055",
  "0056",
  "0057",
  "0058",
  "0059",
  "0060",
  "0061",
];
const latestKnownHead = supportedHeads.at(-1);
const protectedHistory = [
  "notifications",
  "contact_accesses",
  "bootstraps",
  "expiries",
  "login_challenges",
  "access_audits",
  "order_notes",
  "private_accesses",
  "private_confirmations",
  "message_reviews",
  "operation_receipts",
  "fulfillment_receipts",
  "review_locale_grants",
  "order_audits",
  "resends",
  "resend_outbox",
  "resend_attempts",
  "resend_contact_accesses",
  "resend_audits",
  "resend_link_audits",
  "health_policies",
  "health_state",
  "health_observations",
  "finance_operations",
  "finance_receipts",
  "finance_applications",
  "finance_schedule",
  "finance_audits",
  "finance_aliases",
  "configuration_revisions",
  "configuration_validations",
  "configuration_receipts",
  "configuration_activations",
  "configuration_copies",
  "configuration_audits",
  "exception_operations",
  "exception_receipts",
  "exception_audits",
  "digital_deliveries",
  "proof_uploads",
  "proofs",
  "proof_withdrawals",
  "proof_audits",
  "filled_media_jobs",
  "layout_revisions",
  "layout_publications",
  "layout_receipts",
  "layout_audits",
  "theme_revisions",
  "theme_publications",
  "theme_receipts",
  "theme_audits",
  "navigation_revisions",
  "navigation_publications",
  "navigation_receipts",
  "navigation_audits",
  "information_revisions",
  "information_publications",
  "information_receipts",
  "information_outbox",
  "information_audits",
  "native_submissions",
  "artist_assignments",
  "ledger_exports",
  "wish_bindings",
  "wish_purchase_links",
  "wish_supports",
  "wish_preferences",
  "wish_consents",
  "wish_entries",
  "wish_withdrawals",
];
function fixture(version, retained) {
  const migrations = [];
  const client = {
    query: async (sql) => ({
      rows: [
        sql.includes("AS notifications")
          ? Object.fromEntries([
              ["version", version],
              ...protectedHistory
                .filter((key) => sql.includes(`AS ${key}`))
                .map((key) => [key, key === retained ? 1 : 0]),
            ])
          : { version },
      ],
    }),
  };
  return {
    client,
    clientConfig: {},
    workspaceRoot,
    migrations,
    migrate: async ({ command }) => {
      migrations.push(command.confirmVersion);
      return {
        revertedVersions: [command.confirmVersion],
        currentVersion: String(Number(command.confirmVersion) - 1).padStart(
          4,
          "0",
        ),
      };
    },
  };
}
for (const head of supportedHeads) {
  test(`empty known head ${head} uses the ordinary exact-version down sequence`, async () => {
    const options = fixture(head);
    await rollbackEmptyNotifications(options);
    assert.deepEqual(
      options.migrations,
      supportedHeads.filter((v) => v <= head).reverse(),
    );
  });
}
for (const history of protectedHistory) {
  test(`retained ${history} rejects before any migration is attempted`, async () => {
    const options = fixture(latestKnownHead, history);
    await assert.rejects(
      rollbackEmptyNotifications(options),
      /without .*history/u,
    );
    assert.deepEqual(options.migrations, []);
  });
}
for (const head of [null, "0028", "0062"]) {
  test(`unknown head ${head} is not silently rewound`, async () => {
    const options = fixture(head);
    await assert.rejects(rollbackEmptyNotifications(options), /known .*head/u);
    assert.deepEqual(options.migrations, []);
  });
}

test("real PostgreSQL preserves login and audit history and rewinds only empty known prefixes", async () => {
  await withEphemeralPostgres(async (clientConfig) => {
    const client = new Client(clientConfig);
    await client.connect();
    const options = { client, clientConfig, workspaceRoot };
    try {
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up" },
      });
      const head = async () =>
        (
          await client.query(
            "SELECT max(version) AS version FROM schema_migrations",
          )
        ).rows[0].version;
      assert.equal(await head(), latestKnownHead);
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO admin_login_challenges(id,state_digest,binding_digest,configuration_digest,locale,expires_at) VALUES($1,$2,$3,$4,'en',clock_timestamp()+interval '5 minutes')",
        [randomUUID(), randomBytes(32), randomBytes(32), randomBytes(32)],
      );
      await assert.rejects(
        rollbackEmptyNotifications(options),
        /without .*history/u,
      );
      assert.equal(await head(), latestKnownHead);
      await client.query("ROLLBACK");
      for (const [action, task] of [
        ...[
          "ADMIN_LOGIN_SUCCEEDED",
          "ADMIN_LOGIN_REJECTED",
          "ADMIN_SESSION_REVOKED",
          "ADMIN_SESSIONS_REVOKED",
        ].map((action) => [action, "admin-access"]),
        ...[
          "ORDER_NOTE_ADDED",
          "ORDER_PRIVATE_READ",
          "ORDER_MESSAGE_REVIEWED",
          "ORDER_MESSAGE_LOCALE_GRANT",
          "ORDER_MESSAGE_LOCALE_REVOKE",
          "FULFILLMENT_STATUS_CHANGED",
        ].map((action) => [action, "rollback-proof"]),
        ["RESEND_ORDER_NOTIFICATION", "rollback-proof"],
        ["AUTHORIZE_NOTIFICATION_CONTACT_READ", "admin-order-resend"],
        ["PAYMENT_CONFIGURATION_VALIDATE", "rollback-proof"],
        ["PAYMENT_CONFIGURATION_SAVE", "rollback-proof"],
        ["PAYMENT_CONFIGURATION_APPROVE", "rollback-proof"],
        ["FINANCE_CANCEL_REQUESTED", "rollback-proof"],
        ["FINANCE_RECONCILE_REQUESTED", "rollback-proof"],
        ["FINANCE_PAYMENT_CANCELED", "rollback-proof"],
        ["PAYMENT_PROVIDER_RECONCILE", "admin-finance"],
        ["EXCEPTION_REPLAY_WEBHOOK", "rollback-proof"],
        ["EXCEPTION_RETRY_DEAD_LETTER", "rollback-proof"],
        ["EXCEPTION_RECONCILE_PAYMENT", "rollback-proof"],
        ["EXCEPTION_RETRY_NOTIFICATION", "rollback-proof"],
      ]) {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,outcome) VALUES($1,'SYSTEM',$2,$3,'ORDER',$4,'SUCCEEDED')",
          [randomUUID(), task, action, randomUUID()],
        );
        await assert.rejects(
          rollbackEmptyNotifications(options),
          /without .*history/u,
          action,
        );
        assert.equal(await head(), latestKnownHead);
        await client.query("ROLLBACK");
      }
      for (const version of [...supportedHeads].reverse()) {
        await runMigrations({
          clientConfig,
          workspaceRoot,
          command: { direction: "up", targetVersion: version },
        });
        assert.equal(await head(), version);
        await rollbackEmptyNotifications(options);
        assert.equal(await head(), "0028");
      }
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
