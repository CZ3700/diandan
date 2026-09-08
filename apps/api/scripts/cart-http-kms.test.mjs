import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createCartHttpTestKms } from "./cart-http-kms.mjs";

test("TEST remote boundary uses real authenticated wrapping and preserves Unicode through the production adapter", async () => {
  const kms = createCartHttpTestKms();
  try {
    const subjectId = randomUUID(),
      plaintextBase64 = Buffer.from("测试 private emoji 🎁").toString(
        "base64url",
      );
    const encrypted = await kms.adapter.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId,
      plaintextBase64,
    });
    assert.equal(encrypted.outcome, "SUCCESS");
    const command = {
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      algorithm: "AES_256_GCM",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId,
      ciphertext: encrypted.value.ciphertext,
      encryptedDataKey: encrypted.value.encryptedDataKey,
      keyVersion: encrypted.value.keyVersion,
    };
    const decrypted = await kms.adapter.decryptEnvelope(command);
    assert.equal(decrypted.outcome, "SUCCESS");
    assert.equal(decrypted.value.plaintextBase64, plaintextBase64);
    assert.equal(
      (
        await kms.adapter.decryptEnvelope({
          ...command,
          subjectId: randomUUID(),
        })
      ).outcome,
      "FAILURE",
    );
    assert.equal(
      (
        await kms.adapter.decryptEnvelope({
          ...command,
          purpose: "SUPPORT_INTENT_DISPLAY_NAME",
        })
      ).outcome,
      "FAILURE",
    );
  } finally {
    kms.close();
  }
});

test("empty intents receive a wrapped key and TEST outage cannot return invented success", async () => {
  const kms = createCartHttpTestKms();
  try {
    const command = {
      schemaVersion: 1,
      operation: "GENERATE_SUPPORT_INTENT_KEY",
      subjectId: randomUUID(),
    };
    const result = await kms.adapter.generateSupportIntentKey(command);
    assert.equal(result.outcome, "SUCCESS");
    assert.match(result.value.encryptedDataKey, /^enc:v1:/u);
    assert.equal(kms.counts.GenerateDataKeyCommand, undefined);
    assert.equal(kms.counts.GenerateDataKeyWithoutPlaintextCommand, 1);
    kms.setUnavailable(true);
    assert.equal(
      (await kms.adapter.generateSupportIntentKey(command)).outcome,
      "FAILURE",
    );
  } finally {
    kms.close();
  }
});
