import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { notificationGatewayReceiptSchema } from "@fan-support/contracts";

export function encryptMailCapture(key, identity, value) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(identity));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    schemaVersion: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}
export function decryptMailCapture(key, identity, value) {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(identity));
  cipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(value.ciphertext, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
const failure = (code) => ({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "FAILURE",
  error: { schemaVersion: 1, code, recovery: "NONE" },
});

/** Provider capture and admission receipt commit together in the isolated TEST database. */
export async function createLocalMailStore({
  pool,
  key,
  profile,
  profileHash,
}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS local_experience_mail (
    idempotency_key text PRIMARY KEY, notification_id uuid NOT NULL UNIQUE,
    request_hash text NOT NULL, receipt jsonb NOT NULL, capture jsonb NOT NULL,
    accepted_at timestamptz NOT NULL, retained_until timestamptz NOT NULL)`);
  const receipt = (email, hash, result) =>
    notificationGatewayReceiptSchema.parse({
      schemaVersion: 1,
      protocol: profile.protocol,
      profileHash,
      notificationId: email.notification.id,
      idempotencyKey: email.notification.idempotencyKey,
      requestHash: hash,
      result,
    });
  return {
    async accept(email, requestHash) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`local-mail:${email.notification.idempotencyKey}`],
        );
        const prior = (
          await client.query(
            "SELECT * FROM local_experience_mail WHERE idempotency_key=$1",
            [email.notification.idempotencyKey],
          )
        ).rows[0];
        if (prior) {
          await client.query("COMMIT");
          return prior.request_hash === requestHash
            ? prior.receipt
            : receipt(email, requestHash, failure("IDEMPOTENCY_CONFLICT"));
        }
        const now = (await client.query("SELECT clock_timestamp() now")).rows[0]
          .now;
        const cutoff = Date.parse(email.dispatchNotAfter);
        if (
          cutoff <= now.getTime() ||
          cutoff > now.getTime() + profile.idempotencyRetentionSeconds * 1000
        ) {
          await client.query("COMMIT");
          return receipt(email, requestHash, failure("CONFIGURATION_ERROR"));
        }
        const accepted = receipt(email, requestHash, {
          schemaVersion: 1,
          operation: "SEND_NOTIFICATION",
          outcome: "SUCCESS",
          value: {
            status: "ACCEPTED",
            providerReference: `local-test-mail/${email.notification.id}`,
            acceptedAt: now.toISOString(),
          },
        });
        const capture = encryptMailCapture(key, email.notification.id, {
          recipient: email.recipient,
          content: email.content,
          notificationId: email.notification.id,
        });
        await client.query(
          "INSERT INTO local_experience_mail VALUES($1,$2::uuid,$3,$4::jsonb,$5::jsonb,$6::timestamptz,$6::timestamptz+($7::integer*interval '1 second'))",
          [
            email.notification.idempotencyKey,
            email.notification.id,
            requestHash,
            JSON.stringify(accepted),
            JSON.stringify(capture),
            now,
            profile.idempotencyRetentionSeconds,
          ],
        );
        await client.query("COMMIT");
        return accepted;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async list() {
      const rows = (
        await pool.query(
          "SELECT notification_id,accepted_at,capture FROM local_experience_mail WHERE retained_until>clock_timestamp() ORDER BY accepted_at DESC LIMIT 100",
        )
      ).rows;
      return rows.map((row) => ({
        ...decryptMailCapture(key, row.notification_id, row.capture),
        acceptedAt: row.accepted_at.toISOString(),
      }));
    },
  };
}
