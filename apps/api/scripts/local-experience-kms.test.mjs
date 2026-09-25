import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

async function factory() {
  const module = await import("./local-experience-kms.mjs").catch(() => null);
  assert.ok(module, "persistent local KMS composition is available");
  return module.createLocalExperienceKms;
}
const configuration = () => ({
  environment: "TEST",
  masterKey: randomBytes(32).toString("base64url"),
  macKey: randomBytes(32).toString("base64url"),
});

test("reopening with persisted keys decrypts prior Unicode envelopes and retains credential indexes", async () => {
  const create = await factory(),
    config = configuration();
  const first = create(config),
    subjectId = randomUUID();
  const plaintextBase64 = Buffer.from("local synthetic 🎁 测试").toString(
    "base64url",
  );
  const encrypted = await first.adapter.encryptEnvelope({
    schemaVersion: 1,
    operation: "ENCRYPT_ENVELOPE",
    purpose: "FULFILLMENT_PROFILE",
    subjectId,
    plaintextBase64,
  });
  assert.equal(encrypted.outcome, "SUCCESS");
  const command = {
    schemaVersion: 1,
    operation: "COMPUTE_BLIND_INDEX",
    purpose: "ORDER_ACCESS_TOKEN",
    valueBase64: Buffer.from("synthetic token").toString("base64url"),
  };
  const before = await first.adapter.computeBlindIndex(command);
  assert.equal(before.outcome, "SUCCESS");
  first.close();
  const reopened = create(config);
  try {
    const decrypt = {
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      algorithm: "AES_256_GCM",
      purpose: "FULFILLMENT_PROFILE",
      subjectId,
      ...encrypted.value,
    };
    delete decrypt.algorithm;
    const response = await reopened.adapter.decryptEnvelope({
      ...decrypt,
      algorithm: "AES_256_GCM",
    });
    assert.equal(response.outcome, "SUCCESS");
    assert.equal(response.value.plaintextBase64, plaintextBase64);
    assert.deepEqual(await reopened.adapter.computeBlindIndex(command), before);
    assert.equal(
      (
        await reopened.adapter.decryptEnvelope({
          ...decrypt,
          algorithm: "AES_256_GCM",
          subjectId: randomUUID(),
        })
      ).outcome,
      "FAILURE",
    );
  } finally {
    reopened.close();
  }
});

test("local keys reject LIVE, malformed material and use after close", async () => {
  const create = await factory(),
    config = configuration();
  assert.throws(() => create({ ...config, environment: "LIVE" }), /TEST/u);
  assert.throws(() => create({ ...config, masterKey: "123" }), /key/u);
  const kms = create(config);
  kms.close();
  assert.equal(
    (
      await kms.adapter.generateSupportIntentKey({
        schemaVersion: 1,
        operation: "GENERATE_SUPPORT_INTENT_KEY",
        subjectId: randomUUID(),
      })
    ).outcome,
    "FAILURE",
  );
});
