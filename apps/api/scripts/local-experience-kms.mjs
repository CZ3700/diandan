import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { createKmsKeyManagementAdapterForTesting } from "../../../packages/key-management-kms/dist/adapter.js";

/** Persisted TEST wrapping keys back the real envelope adapter; this is never a production KMS. */
export function createLocalExperienceKms({ environment, masterKey, macKey }) {
  if (environment !== "TEST") throw new TypeError("Local KMS requires TEST");
  if (
    ![masterKey, macKey].every(
      (value) =>
        typeof value === "string" &&
        /^[A-Za-z0-9_-]{43}$/u.test(value) &&
        Buffer.from(value, "base64url").toString("base64url") === value,
    ) ||
    masterKey === macKey
  )
    throw new TypeError("Invalid persistent local key material");
  const master = Buffer.from(masterKey, "base64url"),
    mac = Buffer.from(macKey, "base64url");
  const keyId =
    "arn:aws:kms:us-east-1:111122223333:key/11111111-1111-4111-8111-111111111111";
  let closed = false;
  const context = (input) =>
    Buffer.from(JSON.stringify(input.EncryptionContext));
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
        if (closed) throw new Error("Local TEST KMS stopped");
        const input = command.input,
          kind = command.constructor.name;
        if (kind === "GenerateMacCommand")
          return {
            KeyId: input.KeyId,
            MacAlgorithm: "HMAC_SHA_256",
            Mac: createHmac("sha256", mac).update(input.Message).digest(),
          };
        if (
          kind === "GenerateDataKeyCommand" ||
          kind === "GenerateDataKeyWithoutPlaintextCommand"
        ) {
          const plaintext = randomBytes(32),
            iv = randomBytes(12),
            cipher = createCipheriv("aes-256-gcm", master, iv);
          try {
            cipher.setAAD(context(input));
            const payload = Buffer.concat([
              cipher.update(plaintext),
              cipher.final(),
            ]);
            return {
              KeyId: input.KeyId,
              CiphertextBlob: Buffer.concat([iv, cipher.getAuthTag(), payload]),
              ...(kind === "GenerateDataKeyCommand"
                ? { Plaintext: Buffer.from(plaintext) }
                : {}),
            };
          } finally {
            plaintext.fill(0);
          }
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
        throw new Error("Unsupported local TEST KMS operation");
      },
    },
  );
  return {
    adapter,
    close() {
      closed = true;
      master.fill(0);
      mac.fill(0);
    },
  };
}
