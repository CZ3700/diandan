import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

type MigrationEntry = Readonly<{
  version: string;
  name: string;
  up: string;
  down: string;
  sha256: Readonly<{ up: string; down: string }>;
}>;

type MigrationManifest = Readonly<{
  schemaVersion: number;
  migrations: readonly MigrationEntry[];
}>;

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function readWorkspaceFile(relativePath: string): Promise<string> {
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  expect(absolutePath.startsWith(`${workspaceRoot}${path.sep}`)).toBe(true);
  return readFile(absolutePath, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sqlDefinition(sql: string, declaration: string): string {
  const start = sql.indexOf(declaration);
  expect(start, declaration).toBeGreaterThanOrEqual(0);
  const nextDeclaration = sql.indexOf("\nCREATE ", start + declaration.length);
  return sql.slice(start, nextDeclaration === -1 ? undefined : nextDeclaration);
}

describe("PostgreSQL migration manifest", () => {
  test("uses only PostgreSQL-compatible regular-expression syntax", async () => {
    const migrationFiles = [
      "0001_foundation-security.up.sql",
      "0002_content-catalog.up.sql",
      "0003_inventory-cart-private-data.up.sql",
      "0004_orders-fulfillment.up.sql",
      "0005_payments-reliable-events.up.sql",
      "0006_publication-heads-outbox.up.sql",
    ];

    for (const migrationFile of migrationFiles) {
      const sql = await readWorkspaceFile(
        `database/migrations/${migrationFile}`,
      );
      expect(sql, migrationFile).not.toContain("(?:");
      for (const match of sql.matchAll(/\{\d+,(\d+)\}/gu)) {
        expect(Number(match[1]), `${migrationFile}: ${match[0]}`).toBeLessThan(
          256,
        );
      }
    }
  });

  test("pins an ordered, reversible, tamper-evident migration sequence", async () => {
    const manifest = JSON.parse(
      await readWorkspaceFile("database/migrations/manifest.json"),
    ) as MigrationManifest;

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.migrations.length).toBeGreaterThanOrEqual(3);

    const versions = manifest.migrations.map(({ version }) => version);
    expect(versions).toEqual([...versions].sort());
    expect(new Set(versions).size).toBe(versions.length);

    for (const migration of manifest.migrations) {
      expect(migration.version).toMatch(/^\d{4}$/u);
      expect(migration.name).toMatch(/^[a-z][a-z0-9-]*$/u);
      expect(migration.up).toBe(
        `database/migrations/${migration.version}_${migration.name}.up.sql`,
      );
      expect(migration.down).toBe(
        `database/migrations/${migration.version}_${migration.name}.down.sql`,
      );

      const [upSql, downSql] = await Promise.all([
        readWorkspaceFile(migration.up),
        readWorkspaceFile(migration.down),
      ]);

      expect(upSql).not.toMatch(/(?:^|\n)\s*(?:BEGIN|COMMIT)\s*;/iu);
      expect(downSql).not.toMatch(/(?:^|\n)\s*(?:BEGIN|COMMIT)\s*;/iu);
      expect(upSql.trim().length).toBeGreaterThan(0);
      expect(downSql.trim().length).toBeGreaterThan(0);
      expect(migration.sha256.up).toBe(sha256(upSql));
      expect(migration.sha256.down).toBe(sha256(downSql));
    }
  });

  test("binds policy acceptance to both English lineage and localized content", async () => {
    const orderMigration = await readWorkspaceFile(
      "database/migrations/0004_orders-fulfillment.up.sql",
    );

    expect(orderMigration).toContain(
      "review.reviewed_source_hash = translation.translated_from_source_hash",
    );
    expect(orderMigration).toContain(
      "review.reviewed_content_hash = translation.source_hash",
    );
  });

  test("keeps reviewed payment-provider translations append-only", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain(
      "payment_provider_config_translations_append_only_trigger",
    );
  });

  test("round-trips pre-0006 content and payment publication history without data loss", async () => {
    const publicationUp = await readWorkspaceFile(
      "database/migrations/0006_publication-heads-outbox.up.sql",
    );
    const publicationDown = await readWorkspaceFile(
      "database/migrations/0006_publication-heads-outbox.down.sql",
    );

    expect(publicationUp).toContain(
      "DROP CONSTRAINT outbox_events_event_type_check",
    );
    expect(publicationDown).not.toContain(
      "EXISTS (SELECT 1 FROM public.content_publications)",
    );
    expect(publicationDown).not.toContain(
      "EXISTS (SELECT 1 FROM public.payment_config_publications)",
    );
    expect(publicationDown).toContain(
      "migration 0006 cannot be reverted after price-book publication history exists",
    );
    expect(publicationUp).not.toContain(
      "migration 0006 requires empty preexisting publication history",
    );
    expect(publicationUp).toContain("MIGRATION_BACKFILL");
    expect(publicationUp).toMatch(
      /ALTER TABLE public\.content_publications\s+ALTER COLUMN audit_log_id SET NOT NULL/u,
    );
    expect(publicationDown).toContain(
      "DROP CONSTRAINT outbox_events_event_type_check",
    );
  });

  test("binds each webhook inbox digest to its encrypted payload envelope", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain(
      "FOREIGN KEY (webhook_payload_id, payload_sha256)",
    );
    expect(paymentMigration).toContain(
      "REFERENCES webhook_payloads(id, payload_sha256)",
    );
  });

  test("does not allow a cart item to lose its private support-intent owner", async () => {
    const privateDataMigration = await readWorkspaceFile(
      "database/migrations/0003_inventory-cart-private-data.up.sql",
    );

    expect(privateDataMigration).toContain(
      "support_intents_delete_guard_trigger",
    );
  });

  test("binds refund and dispute evidence to the exact provider amount", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain(
      "event.amount_minor = NEW.requested_amount_minor",
    );
    expect(paymentMigration).toContain("event.amount_minor = NEW.amount_minor");
  });

  test("prevents a paid order from gaining another active payment attempt", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain(
      "payment_attempts_one_nonterminal_or_succeeded_per_order_idx",
    );
    expect(paymentMigration).toContain(
      "payment attempt retry requires a payable order and only terminal failed predecessors",
    );
  });

  test("requires every reconciled terminal state to bind a normalized provider event", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(
      paymentMigration.match(
        /event\.evidence_kind = NEW\.status_evidence_kind/gu,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(paymentMigration).toContain(
      "event.reconcile_audit_log_id IS NOT DISTINCT FROM NEW.evidence_audit_log_id",
    );
    expect(paymentMigration).toContain("validate_provider_event_evidence");
  });

  test("binds each reservation state to its exact inventory-ledger deltas", async () => {
    const privateDataMigration = await readWorkspaceFile(
      "database/migrations/0003_inventory-cart-private-data.up.sql",
    );

    expect(privateDataMigration).toContain(
      "assert_inventory_reservation_ledger_semantics",
    );
    expect(privateDataMigration).toContain(
      "delta_on_hand = -NEW.quantity AND delta_reserved = -NEW.quantity",
    );
    expect(privateDataMigration).toContain(
      "delta_on_hand = 0 AND delta_reserved = -NEW.quantity",
    );
    expect(privateDataMigration).toContain(
      "only TRACKED inventory may be reserved",
    );
  });

  test("makes payment success an atomic cross-aggregate plan", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );
    const successFunction = sqlDefinition(
      paymentMigration,
      "CREATE FUNCTION assert_payment_success_aggregate_plan()",
    );

    expect(successFunction).toContain("LATE_PAYMENT_SUCCESS_APPLIED");
    expect(successFunction).toContain(
      "order_event.from_order_status = 'PENDING_PAYMENT'",
    );
    expect(successFunction).toContain(
      "order_event.event_type = 'PAYMENT_STATUS_CHANGED'",
    );
    expect(successFunction).toContain(
      "order_event.from_order_status = 'CANCELED'",
    );
    expect(successFunction).toContain(
      "order_event.event_type = 'LATE_PAYMENT_RECOVERED'",
    );
    expect(successFunction).toContain("OLD.status = 'UNKNOWN' AND NOT EXISTS");
    expect(successFunction).toContain("current_reservation");
    expect(successFunction).toContain(
      "tracked order-item reservation coverage is incomplete",
    );
    expect(successFunction).toContain(
      "current_reservation.checkout_session_id <> source_order.checkout_session_id",
    );
    expect(successFunction).toContain(
      "current_reservation.checkout_quote_id <> source_order.checkout_quote_id",
    );
    expect(successFunction).toContain(
      "payment success aggregate plan is incomplete",
    );
  });

  test("keeps cart and inventory locked while a payment outcome is nonterminal", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain("guard_nonterminal_payment_lock");
    expect(paymentMigration).toContain(
      "nonterminal payment keeps cart and reservation locked",
    );
    expect(paymentMigration).toContain(
      "UNKNOWN reservation expiry requires its elapsed hold window",
    );
    expect(paymentMigration).toContain(
      "attempt.status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING')",
    );
    expect(paymentMigration).toContain(
      "succeeded payment cannot release or expire reservations",
    );
  });

  test("binds every order event type to one authority and declared field set", async () => {
    const orderMigration = await readWorkspaceFile(
      "database/migrations/0004_orders-fulfillment.up.sql",
    );
    const validationFunction = sqlDefinition(
      orderMigration,
      "CREATE FUNCTION validate_order_event()",
    );

    expect(orderMigration).toContain(
      "order event authority or changed-field set is invalid",
    );
    expect(orderMigration).toContain("ORDER_PAYMENT_CONFIRMED");
    expect(orderMigration).toContain("LATE_PAYMENT_RECOVERED");
    expect(validationFunction).toContain(
      "NEW.from_fulfillment_status = 'PENDING'",
    );
    expect(validationFunction).toContain(
      "NEW.to_fulfillment_status IN ('PENDING', 'ON_HOLD')",
    );
  });

  test("accepts provider-neutral secret references instead of arbitrary strings", async () => {
    const foundationMigration = await readWorkspaceFile(
      "database/migrations/0001_foundation-security.up.sql",
    );
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(foundationMigration).toContain(
      "CREATE DOMAIN secret_reference AS text",
    );
    expect(
      paymentMigration.match(/secret_reference NOT NULL/gu)?.length ?? 0,
    ).toBe(2);
  });

  test("caps cumulative nonfailed refunds at each order-line total", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain("assert_refund_item_capacity");
    expect(paymentMigration).toContain(
      "refund allocation exceeds order-item total",
    );
  });

  test("requires every refund request to reference its successful audit row", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain("requested_audit_log_id uuid NOT NULL");
    expect(paymentMigration).toContain(
      "refund request requires matching audit evidence",
    );
  });

  test("prevents mutable account status from bypassing published payment config", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain("payment_provider_health_events");
    expect(paymentMigration).toContain(
      "payment provider health and append-only evidence diverge",
    );
    expect(paymentMigration).toContain(
      "'account_reference_digest', 'credential_secret_ref', 'status', 'created_at'",
    );
  });

  test("accepts webhook inbox rows only within the configured endpoint window", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain(
      "validate_webhook_inbox_endpoint_window",
    );
    expect(paymentMigration).toContain(
      "webhook endpoint is not active at receipt time",
    );
  });

  test("makes each state-transition outbox row authoritative and unique", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain(
      "outbox_events_state_transition_unique_idx",
    );
    expect(paymentMigration).toContain(
      "event_type NOT IN ('CONTENT_PUBLICATION_CHANGED', 'PAYMENT_CONFIG_PUBLISHED', 'PRICE_BOOK_PUBLISHED')",
    );
    expect(paymentMigration).toContain("assert_outbox_event_authority");
    expect(paymentMigration).toContain(
      "outbox event has no exact authoritative source",
    );
  });

  test("binds ordinary outbox events to exact source provenance in both directions", async () => {
    const [cartMigration, orderMigration, paymentMigration] = await Promise.all(
      [
        readWorkspaceFile(
          "database/migrations/0003_inventory-cart-private-data.up.sql",
        ),
        readWorkspaceFile("database/migrations/0004_orders-fulfillment.up.sql"),
        readWorkspaceFile(
          "database/migrations/0005_payments-reliable-events.up.sql",
        ),
      ],
    );

    for (const [migration, table] of [
      [cartMigration, "cart_items"],
      [orderMigration, "order_events"],
      [orderMigration, "fulfillment_events"],
      [orderMigration, "notification_deliveries"],
      [paymentMigration, "payment_attempt_events"],
      [paymentMigration, "refund_events"],
      [paymentMigration, "dispute_events"],
    ] as const) {
      const definition = sqlDefinition(migration, `CREATE TABLE ${table} (`);
      expect(definition, `${table}.request_id`).toContain(
        "request_id uuid NOT NULL",
      );
      expect(definition, `${table}.correlation_id`).toContain(
        "correlation_id uuid NOT NULL",
      );
    }
    expect(cartMigration).toContain("NEW.request_id <> OLD.request_id");
    expect(cartMigration).toContain("NEW.correlation_id <> OLD.correlation_id");

    const reverseAuthority = sqlDefinition(
      paymentMigration,
      "CREATE FUNCTION assert_outbox_event_authority()",
    );
    for (const [sourceAlias, sourceTimestamp] of [
      ["item", "created_at"],
      ["event", "occurred_at"],
      ["order_event", "occurred_at"],
      ["delivery", "created_at"],
    ] as const) {
      expect(reverseAuthority).toContain(
        `${sourceAlias}.request_id = NEW.request_id`,
      );
      expect(reverseAuthority).toContain(
        `${sourceAlias}.correlation_id = NEW.correlation_id`,
      );
      expect(reverseAuthority).toContain(
        `${sourceAlias}.${sourceTimestamp} = NEW.occurred_at`,
      );
    }
    expect(
      reverseAuthority.match(/\bevent\.request_id = NEW\.request_id/gu),
    ).toHaveLength(4);
    expect(
      reverseAuthority.match(/\bevent\.correlation_id = NEW\.correlation_id/gu),
    ).toHaveLength(4);
    expect(
      reverseAuthority.match(/\bevent\.occurred_at = NEW\.occurred_at/gu),
    ).toHaveLength(4);

    for (const functionName of [
      "assert_cart_item_added_outbox",
      "assert_fulfillment_event_outbox",
      "assert_notification_request_outbox",
      "assert_payment_state_event_outbox",
      "assert_refund_state_event_outbox",
      "assert_dispute_state_event_outbox",
    ]) {
      const sourceAuthority = sqlDefinition(
        paymentMigration,
        `CREATE FUNCTION ${functionName}()`,
      );
      expect(sourceAuthority, functionName).toContain(
        "event.request_id = NEW.request_id",
      );
      expect(sourceAuthority, functionName).toContain(
        "event.correlation_id = NEW.correlation_id",
      );
      expect(sourceAuthority, functionName).toMatch(
        /event\.occurred_at = NEW\.(?:occurred_at|created_at)/u,
      );
    }

    const paymentSourceAuthority = sqlDefinition(
      paymentMigration,
      "CREATE FUNCTION assert_payment_state_event_outbox()",
    );
    expect(paymentSourceAuthority).toContain(
      "order_event.request_id = event.request_id",
    );
    expect(paymentSourceAuthority).toContain(
      "order_event.correlation_id = event.correlation_id",
    );
    expect(paymentSourceAuthority).toContain(
      "order_event.occurred_at = event.occurred_at",
    );
  });

  test("binds append-only financial events back to the current aggregate head", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain("assert_financial_event_head");
    expect(paymentMigration).toContain(
      "financial event does not match its aggregate head",
    );
    expect(paymentMigration).toContain(
      "cart item and outbox record must commit together",
    );
    expect(paymentMigration).toContain(
      "fulfillment event and outbox record must commit together",
    );
    expect(paymentMigration).toContain(
      "notification request and outbox record must commit together",
    );
  });

  test("maps every payment transaction kind to compatible provider evidence", async () => {
    const paymentMigration = await readWorkspaceFile(
      "database/migrations/0005_payments-reliable-events.up.sql",
    );

    expect(paymentMigration).toContain(
      "payment transaction type does not match provider evidence",
    );
    expect(paymentMigration).toContain("NEW.transaction_type = 'CAPTURE'");
    expect(paymentMigration).toContain("event.event_type = 'REFUND_STATUS'");
    expect(paymentMigration).toContain("event.event_type = 'DISPUTE_STATUS'");
    expect(paymentMigration).toContain(
      "event.provider_transaction_type = NEW.transaction_type",
    );
    expect(paymentMigration).toContain(
      "event.provider_transaction_reference = NEW.provider_transaction_reference",
    );
    expect(paymentMigration).toContain("event.occurred_at = NEW.occurred_at");
    expect(paymentMigration).toContain(
      "payment_transactions_provider_event_type_unique",
    );
    expect(paymentMigration).toContain("assert_provider_transaction_ledger");
    expect(paymentMigration).toContain(
      "provider_event_associations_transaction_ledger_trigger",
    );
    expect(paymentMigration).toContain(
      "provider transaction evidence and exact ledger record must commit together",
    );
    expect(paymentMigration).toContain(
      "provider transaction type does not match normalized evidence",
    );
  });

  test("commits the catalog contract consumed by the integration gate", async () => {
    const catalog = JSON.parse(
      await readWorkspaceFile("database/schema/expected-catalog.json"),
    ) as Readonly<{ schemaVersion?: number; tables?: readonly unknown[] }>;

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.tables?.length).toBeGreaterThan(40);
  });
});
