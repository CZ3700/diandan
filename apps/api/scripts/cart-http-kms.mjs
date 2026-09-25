import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { createKmsKeyManagementAdapterForTesting } from "../../../packages/key-management-kms/dist/adapter.js";

/** Real adapter/AES-GCM/HMAC; only the remote KMS command boundary is TEST-local. */
export function createCartHttpTestKms() {
  const master = randomBytes(32),
    macKey = randomBytes(32);
  const keyId =
    "arn:aws:kms:us-east-1:111122223333:key/11111111-1111-4111-8111-111111111111";
  const context = (input) =>
    Buffer.from(JSON.stringify(input.EncryptionContext));
  let unavailable = false;
  let encryptionUnavailable = false;
  const counts = {};
  const adapter = createKmsKeyManagementAdapterForTesting(
    {
      schemaVersion: 1,
      region: "us-east-1",
      activeEncryptionKeyVersion: "test-envelope",
      encryptionKeyIdsByVersion: { "test-envelope": keyId },
      activeBlindIndexKeyVersion: "test-mac",
      blindIndexKeyIdsByVersion: { "test-mac": keyId },
    },
    {
      randomBytes,
      async send(command) {
        const kind = command.constructor.name,
          input = command.input;
        counts[kind] = (counts[kind] ?? 0) + 1;
        if (
          unavailable ||
          (encryptionUnavailable && kind !== "GenerateMacCommand")
        )
          throw new Error("TEST KMS unavailable");
        if (kind === "GenerateMacCommand")
          return {
            KeyId: input.KeyId,
            MacAlgorithm: "HMAC_SHA_256",
            Mac: createHmac("sha256", macKey).update(input.Message).digest(),
          };
        if (
          kind === "GenerateDataKeyCommand" ||
          kind === "GenerateDataKeyWithoutPlaintextCommand"
        ) {
          const plaintext = randomBytes(32),
            iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", master, iv);
          cipher.setAAD(context(input));
          const payload = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
          ]);
          const response = {
            KeyId: input.KeyId,
            CiphertextBlob: Buffer.concat([iv, cipher.getAuthTag(), payload]),
            ...(kind === "GenerateDataKeyCommand"
              ? { Plaintext: Buffer.from(plaintext) }
              : {}),
          };
          plaintext.fill(0);
          return response;
        }
        if (kind === "DecryptCommand") {
          const bytes = Buffer.from(input.CiphertextBlob),
            decipher = createDecipheriv(
              "aes-256-gcm",
              master,
              bytes.subarray(0, 12),
            );
          decipher.setAAD(context(input));
          decipher.setAuthTag(bytes.subarray(12, 28));
          return {
            KeyId: input.KeyId,
            Plaintext: Buffer.concat([
              decipher.update(bytes.subarray(28)),
              decipher.final(),
            ]),
          };
        }
        throw new Error("Unexpected TEST KMS command");
      },
    },
  );
  return {
    adapter,
    counts,
    setEncryptionUnavailable(value) {
      encryptionUnavailable = value;
    },
    setUnavailable(value) {
      unavailable = value;
    },
    close() {
      master.fill(0);
      macKey.fill(0);
    },
  };
}
