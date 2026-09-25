import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
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
    // Isolated mutation-trigger proof only: real column CHECKs and original function, no simulated full provider evidence authority.
    await client.query(
      "CREATE TEMP TABLE payment_action_probe (LIKE public.payment_attempts INCLUDING DEFAULTS INCLUDING CONSTRAINTS)",
    );
    for (const mode of [
      "AUTHENTICATED_ACTION",
      "LOCAL_CREATE_RESULT",
      "WEBHOOK_ACTION",
      "MISSING_ACTION",
      "MISSING_AUDIT",
    ]) {
      stage = mode + "_INSERT";
      const id = randomUUID();
      await client.query(
        `INSERT INTO payment_action_probe(id,order_id,provider_account_id,environment,config_version_id,config_version,route_rule_id,rule_version,payment_method,status,amount_minor,currency,requested_locale,provider_locale,provider_locale_fallback_used,merchant_reference,provider_idempotency_key,provider_call_started,return_state_digest,return_state_expires_at,status_evidence_kind,evidence_reason_code,version,created_at,updated_at) VALUES($1::uuid,$2::uuid,$3::uuid,'TEST',$4::uuid,1,$5::uuid,1,'fake_card','UNKNOWN',500,'USD','ja','en',true,$1::text,$1::text,true,decode(repeat('a',64),'hex'),'2099-01-01','NETWORK_UNCERTAINTY','TEST_UNCERTAINTY',2,'2020-01-01','2020-01-01')`,
        [id, randomUUID(), randomUUID(), randomUUID(), randomUUID()],
      );
      await client.query(
        "CREATE TRIGGER test_payment_mutation BEFORE UPDATE ON payment_action_probe FOR EACH ROW EXECUTE FUNCTION public.validate_payment_attempt_mutation()",
      );
      stage = mode + "_TRANSITION";
      let failure = null;
      try {
        await client.query(
          `UPDATE payment_action_probe SET status='REQUIRES_ACTION',version=version+1,updated_at=clock_timestamp(),external_reference='actual-test-reference',action_type=$2,action_ciphertext=$3::bytea,action_encrypted_data_key=$3::bytea,action_key_version=$4,action_expires_at=$5::timestamptz,status_evidence_kind=$6,provider_event_id=$7::uuid,evidence_audit_log_id=$8::uuid WHERE id=$1::uuid`,
          [
            id,
            mode === "MISSING_ACTION" ? null : "REDIRECT",
            mode === "MISSING_ACTION" ? null : Buffer.alloc(32, 1),
            mode === "MISSING_ACTION" ? null : "test-key-v1",
            mode === "MISSING_ACTION" ? null : "2099-01-01",
            mode === "LOCAL_CREATE_RESULT"
              ? "CREATE_RESULT"
              : mode === "WEBHOOK_ACTION"
                ? "VERIFIED_WEBHOOK"
                : "AUTHENTICATED_RECONCILE",
            randomUUID(),
            mode === "MISSING_AUDIT" || mode === "WEBHOOK_ACTION"
              ? null
              : randomUUID(),
          ],
        );
      } catch (error) {
        failure = error;
      }
      if (mode === "AUTHENTICATED_ACTION")
        assert.equal(
          failure,
          null,
          "actual old mutation trigger must accept authenticated UNKNOWN action recovery",
        );
      else
        assert.equal(
          failure?.code,
          "23514",
          `${mode} remains rejected by real mutation/check constraints`,
        );
      assertions++;
      const row = (
        await client.query(
          "SELECT status,version::integer FROM payment_action_probe WHERE id=$1::uuid",
          [id],
        )
      ).rows[0];
      assert.deepEqual(
        row,
        mode === "AUTHENTICATED_ACTION"
          ? { status: "REQUIRES_ACTION", version: 3 }
          : { status: "UNKNOWN", version: 2 },
      );
      assertions++;
      await client.query(
        "DROP TRIGGER test_payment_mutation ON payment_action_probe",
      );
    }
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        scope:
          "Original mutation function plus real column checks on isolated LIKE table; complete authenticated evidence/FK/outbox validated separately by HTTP",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        stage,
        sqlState: error.actual?.code ?? error.code ?? null,
      }) + "\n",
    );
    throw new Error("Payment action mutation probe failed", { cause: error });
  } finally {
    await client.end();
  }
});
