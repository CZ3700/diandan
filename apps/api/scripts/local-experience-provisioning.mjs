import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { setTimeout, clearTimeout } from "node:timers";
import { Pool } from "pg";

function encryptedBytes(value) {
  if (typeof value !== "string" || !/^enc:v1:[A-Za-z0-9_-]+$/u.test(value))
    throw new Error("Invalid TEST encrypted profile envelope");
  return Buffer.from(value.slice(7), "base64url");
}

/** TEST infrastructure supplies synthetic studio prerequisites without weakening checkout or replacing any prior profile. */
export function createLocalTestFulfillmentProvisioner({
  environment,
  database,
  operatorId,
  keyManagement,
  onFailure = () => undefined,
}) {
  if (environment !== "TEST")
    throw new TypeError("Synthetic fulfillment requires TEST");
  if (!["127.0.0.1", "::1", "localhost"].includes(database.host))
    throw new TypeError("Synthetic fulfillment requires loopback PostgreSQL");
  if (
    !/^[a-f0-9-]{36}$/iu.test(operatorId) ||
    typeof keyManagement.encryptEnvelope !== "function"
  )
    throw new TypeError("Invalid TEST fulfillment prerequisites");
  const pool = new Pool({ ...database, max: 2 });
  pool.on("error", () => onFailure("FULFILLMENT_POOL_UNAVAILABLE"));
  let running = false,
    pending,
    timer,
    closing;
  async function provision() {
    const candidates = await pool.query(`SELECT i.id FROM public.idols i
      WHERE i.status='active' AND i.accepting_gifts
      AND NOT EXISTS(SELECT 1 FROM public.idol_fulfillment_profiles p WHERE p.idol_id=i.id)
      ORDER BY i.id LIMIT 25`);
    let created = 0;
    for (const candidate of candidates.rows) {
      const id = randomUUID(),
        plaintext = Buffer.from(
          JSON.stringify({
            environment: "TEST",
            destination: "SYNTHETIC_TEST_STUDIO",
            recipient: "TEST_STAFF",
          }),
        );
      let encrypted;
      try {
        encrypted = await keyManagement.encryptEnvelope({
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          purpose: "FULFILLMENT_PROFILE",
          subjectId: id,
          plaintextBase64: plaintext.toString("base64url"),
        });
      } finally {
        plaintext.fill(0);
      }
      if (encrypted.outcome !== "SUCCESS")
        throw new Error("TEST fulfillment encryption failed");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          "SELECT id FROM public.idols WHERE id=$1 AND status='active' AND accepting_gifts FOR UPDATE",
          [candidate.id],
        );
        const prior = await client.query(
          "SELECT id FROM public.idol_fulfillment_profiles WHERE idol_id=$1",
          [candidate.id],
        );
        if (locked.rowCount && !prior.rowCount) {
          await client.query(
            `INSERT INTO public.idol_fulfillment_profiles
            (id,idol_id,profile_version,status,profile_ciphertext,encrypted_data_key,encryption_key_version,created_by)
            VALUES($1,$2,1,'ACTIVE',$3,$4,$5,$6)`,
            [
              id,
              candidate.id,
              encryptedBytes(encrypted.value.ciphertext),
              encryptedBytes(encrypted.value.encryptedDataKey),
              encrypted.value.keyVersion,
              operatorId,
            ],
          );
          const requestId = randomUUID();
          await client.query(
            `INSERT INTO public.audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome)
            VALUES($1,'SYSTEM','local-experience-test-provisioner','TEST_FULFILLMENT_PROFILE_PROVISIONED','IDOL_FULFILLMENT_PROFILE',$2,'SYNTHETIC_TEST_ONLY',$3,$3,'SUCCEEDED')`,
            [randomUUID(), id, requestId],
          );
          created++;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return { schemaVersion: 1, testOnly: true, created };
  }
  function runOnce() {
    if (closing)
      return Promise.resolve({ schemaVersion: 1, testOnly: true, created: 0 });
    pending ??= provision().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  function tick() {
    if (!running) return;
    void runOnce()
      .catch(() => onFailure("FULFILLMENT_PROVISIONING_UNAVAILABLE"))
      .finally(() => {
        if (running) {
          timer = setTimeout(tick, 1000);
          timer.unref();
        }
      });
  }
  return {
    runOnce,
    async start() {
      if (!running && !closing) {
        running = true;
        await runOnce();
        tick();
      }
    },
    stop() {
      closing ??= (async () => {
        running = false;
        clearTimeout(timer);
        await pending?.catch(() => undefined);
        await pool.end();
      })();
      return closing;
    },
  };
}
