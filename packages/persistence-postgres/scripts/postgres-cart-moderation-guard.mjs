import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
let stage = "MIGRATIONS",
  assertions = 0;
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(configuration);
  await client.connect();
  try {
    // Clone the actual column/check shape and bind the actual installed function.
    // Foreign-key fixture authoring is deliberately outside this isolated trigger probe.
    await client.query(
      "CREATE TEMP TABLE cart_moderation_probe (LIKE public.support_intents INCLUDING DEFAULTS INCLUDING CONSTRAINTS)",
    );
    await client.query(
      "CREATE CONSTRAINT TRIGGER cart_moderation_probe_validate AFTER INSERT OR UPDATE ON cart_moderation_probe DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_support_intent_moderation_evidence()",
    );
    async function insert(status, kind) {
      return client.query(
        `INSERT INTO cart_moderation_probe
        (id,cart_item_id,idol_id,fan_message_ciphertext,display_mode,encrypted_data_key,encryption_key_version,
         moderation_status,moderation_decision_kind,moderation_rule_version,moderation_evidence_id,reviewed_at,
         created_presentation_locale,fan_message_locale,status,expires_at)
        VALUES($1,$2,$3,$4,'anonymous',$5,'test-cart-key',$6,$7,$8,$9,CASE WHEN $7::text IS NOT NULL THEN transaction_timestamp() END,'en','en','ACTIVE',clock_timestamp()+interval '1 hour')`,
        [
          randomUUID(),
          randomUUID(),
          randomUUID(),
          kind ? Buffer.alloc(40, 1) : null,
          Buffer.alloc(40, 2),
          status,
          kind,
          kind ? "test-rule-1" : null,
          kind ? randomUUID() : null,
        ],
      );
    }
    stage = "PENDING_WITHOUT_MODERATION_EVIDENCE";
    await client.query("BEGIN");
    await insert("PENDING", null);
    await client.query("COMMIT");
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::integer count FROM cart_moderation_probe WHERE moderation_status='PENDING' AND moderation_decision_kind IS NULL AND moderation_evidence_id IS NULL",
        )
      ).rows[0].count,
      1,
    );
    assertions++;
    stage = "AUTOMATED_WITHOUT_EXACT_EVIDENCE_REJECTED";
    await client.query("BEGIN");
    await insert("APPROVED", "AUTOMATED");
    let rejected = false;
    try {
      await client.query("COMMIT");
    } catch (error) {
      rejected =
        error.code === "23514" &&
        error.message ===
          "automated moderation must bind exact immutable evidence";
    }
    await client.query("ROLLBACK");
    assert.equal(rejected, true);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::integer count FROM cart_moderation_probe",
        )
      ).rows[0].count,
      1,
    );
    assertions += 2;
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        scope:
          "Actual installed moderation trigger with cloned column/check shape; no simulated approval evidence",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        stage,
        sqlState: typeof error.code === "string" ? error.code : null,
        guard:
          error.message ===
          "automated moderation must bind exact immutable evidence"
            ? "AUTOMATED_EVIDENCE_REQUIRED"
            : "OTHER",
      }) + "\n",
    );
    throw new Error("Cart moderation guard probe failed", { cause: error });
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});
