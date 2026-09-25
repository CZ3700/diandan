import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function readMigration(name: string): Promise<string> {
  return readFile(
    path.join(workspaceRoot, "database/migrations", name),
    "utf8",
  );
}

describe("private-data migration security", () => {
  let foundationUp = "";
  let privateDataUp = "";
  let privateDataDown = "";
  let fulfillmentUp = "";
  let paymentUp = "";

  beforeAll(async () => {
    [foundationUp, privateDataUp, privateDataDown, fulfillmentUp, paymentUp] =
      await Promise.all([
        readMigration("0001_foundation-security.up.sql"),
        readMigration("0003_inventory-cart-private-data.up.sql"),
        readMigration("0003_inventory-cart-private-data.down.sql"),
        readMigration("0004_orders-fulfillment.up.sql"),
        readMigration("0005_payments-reliable-events.up.sql"),
      ]);
  });

  test("keeps idempotency identity and results out of free-form or PII-shaped text", () => {
    expect(foundationUp).toContain(
      "CREATE DOMAIN idempotency_actor_reference AS text",
    );
    expect(foundationUp).toContain(
      "CREATE DOMAIN safe_idempotency_result_reference AS text",
    );
    expect(foundationUp).toContain(
      "actor idempotency_actor_reference NOT NULL",
    );
    expect(foundationUp).toContain(
      "canonical_request_hash sha256_hex NOT NULL",
    );
    expect(foundationUp).toContain(
      "safe_result_reference safe_idempotency_result_reference",
    );
    expect(foundationUp).toContain(
      "VALUE ~ '^actor-ref:v1:(guest|admin|system|worker):([a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'",
    );
    expect(foundationUp).toContain(
      "VALUE ~ '^result-ref:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
    );
    expect(foundationUp).toContain("OR VALUE IN (");
    expect(foundationUp).toContain("'error-ref:v1:IDEMPOTENCY_CONFLICT'");
    expect(foundationUp).not.toContain("OR VALUE ~ '^error-ref:v1:");
    expect(foundationUp).not.toContain("canonical_request_hash text NOT NULL");
  });

  test("persists an exact controlled actor and reason for late payment recovery", () => {
    expect(foundationUp).toContain("task_name text CHECK");
    expect(foundationUp).toContain(
      "actor_type = 'ADMIN' AND actor_id IS NOT NULL AND task_name IS NULL",
    );
    expect(foundationUp).toContain(
      "actor_type IN ('SYSTEM', 'WORKER') AND actor_id IS NULL AND task_name IS NOT NULL",
    );
    expect(paymentUp).toContain("audit.task_name IS NOT NULL");
    expect(paymentUp).toContain(
      "audit.reason_code = CASE WHEN unavailable_reservation_count > 0",
    );
    expect(paymentUp).toContain("audit.request_id = payment_event.request_id");
    expect(paymentUp).toContain(
      "audit.correlation_id = payment_event.correlation_id",
    );
    expect(paymentUp).toContain(
      "payment_event.provider_event_id = NEW.provider_event_id",
    );
    expect(paymentUp).toContain("audit.created_at = transaction_timestamp()");
  });

  test("binds automated moderation to immutable evidence for the exact encrypted message", () => {
    expect(privateDataUp).toContain("CREATE TABLE moderation_evidence");
    expect(privateDataUp).toContain(
      "support_intent_version positive_version NOT NULL",
    );
    expect(privateDataUp).toContain("rule_version text NOT NULL");
    expect(privateDataUp).toContain(
      "content_ciphertext_sha256 sha256_hex NOT NULL",
    );
    expect(privateDataUp).toContain(
      "decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'REDACTED'))",
    );
    expect(privateDataUp).toContain("FOREIGN KEY (moderation_evidence_id, id)");
    expect(privateDataUp).toContain(
      "REFERENCES moderation_evidence(id, support_intent_id)",
    );
    expect(privateDataUp).toContain(
      "CREATE FUNCTION validate_support_intent_moderation_evidence()",
    );
    expect(privateDataUp).toMatch(
      /evidence\.content_ciphertext_sha256\s*<>\s*pg_catalog\.encode\(pg_catalog\.sha256\(NEW\.fan_message_ciphertext\), 'hex'\)/u,
    );
    expect(privateDataUp).toContain(
      "evidence.rule_version <> NEW.moderation_rule_version",
    );
    expect(privateDataUp).toContain(
      "evidence.decision <> NEW.moderation_status",
    );
    expect(privateDataUp).toContain("evidence.decided_at <> NEW.reviewed_at");
    expect(privateDataUp).toContain("moderation_evidence_append_only_trigger");
    expect(privateDataUp).toContain("moderation_evidence_no_truncate_trigger");
  });

  test("gates preparing and delivery on the current support-intent moderation state", () => {
    expect(fulfillmentUp).toContain("NEW.status IN ('PREPARING', 'DELIVERED')");
    expect(fulfillmentUp).toContain(
      "JOIN public.support_intents intent ON intent.id = item.support_intent_id",
    );
    expect(fulfillmentUp).toContain(
      "JOIN public.cart_items cart_item ON cart_item.id = item.cart_item_id",
    );
    expect(fulfillmentUp).toContain("intent.moderation_status = 'APPROVED'");
    expect(fulfillmentUp).toContain("intent.privacy_state <> 'PURGED'");
    expect(fulfillmentUp).toContain(
      "intent.moderation_status NOT IN ('REJECTED', 'REDACTED')",
    );
    expect(fulfillmentUp).toContain(
      "fulfillment cannot prepare or deliver an unsafe support intent",
    );
  });

  test.each([
    ["support_intents", "support_intents"],
    ["customer_contacts", "customer_contacts"],
    ["idol_fulfillment_profiles", "idol_fulfillment_profiles"],
  ])("keeps %s tombstones against delete and truncate", (_label, table) => {
    expect(privateDataUp).toContain(`${table}_delete_guard_trigger`);
    expect(privateDataUp).toContain(`${table}_no_truncate_trigger`);
  });

  test.each(["order_access_tokens", "order_access_sessions"])(
    "keeps %s evidence against delete and truncate",
    (table) => {
      expect(fulfillmentUp).toContain(`${table}_delete_guard_trigger`);
      expect(fulfillmentUp).toContain(`${table}_no_truncate_trigger`);
    },
  );

  test("reverses the moderation evidence schema cleanly", () => {
    expect(privateDataDown).toContain(
      "DROP CONSTRAINT support_intents_moderation_evidence_fk",
    );
    expect(privateDataDown).toContain("DROP TABLE moderation_evidence");
    expect(privateDataDown).toContain(
      "DROP FUNCTION validate_support_intent_moderation_evidence()",
    );
  });
});
