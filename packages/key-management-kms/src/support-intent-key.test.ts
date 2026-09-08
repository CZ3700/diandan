import { Buffer } from "node:buffer";
import { GenerateDataKeyWithoutPlaintextCommand } from "@aws-sdk/client-kms";
import { expect, test, vi } from "vitest";
import { createKmsKeyManagementAdapterForTesting } from "./adapter.js";

const arn =
  "arn:aws:kms:us-east-1:111122223333:key/11111111-1111-4111-8111-111111111111";
const config = {
  schemaVersion: 1,
  region: "us-east-1",
  activeEncryptionKeyVersion: "test-envelope",
  encryptionKeyIdsByVersion: { "test-envelope": arn },
  activeBlindIndexKeyVersion: "test-mac",
  blindIndexKeyIdsByVersion: { "test-mac": arn },
} as const;
const command = {
  schemaVersion: 1,
  operation: "GENERATE_SUPPORT_INTENT_KEY",
  subjectId: "a0000000-0000-4000-8000-000000000001",
} as const;

test("anonymous empty intent gets only a wrapped key, without plaintext generation or invented message", async () => {
  const commands: unknown[] = [];
  const adapter = createKmsKeyManagementAdapterForTesting(config, {
    randomBytes: () => {
      throw new Error("No field nonce is needed");
    },
    send: async (value) => {
      commands.push(value);
      return { KeyId: arn, CiphertextBlob: Buffer.alloc(64, 7) };
    },
  });
  const generate = Reflect.get(adapter, "generateSupportIntentKey");
  expect(typeof generate).toBe("function");
  if (typeof generate !== "function")
    throw new Error("Missing wrapped-key operation");
  const result = await Reflect.apply(generate, adapter, [command]);
  expect(result).toEqual({
    schemaVersion: 1,
    operation: "GENERATE_SUPPORT_INTENT_KEY",
    outcome: "SUCCESS",
    value: {
      encryptedDataKey: `enc:v1:${Buffer.alloc(64, 7).toString("base64url")}`,
      keyVersion: "test-envelope",
      algorithm: "AES_256_GCM",
    },
  });
  expect(commands).toHaveLength(1);
  expect(commands[0]).toBeInstanceOf(GenerateDataKeyWithoutPlaintextCommand);
  expect((commands[0] as GenerateDataKeyWithoutPlaintextCommand).input).toEqual(
    {
      KeyId: arn,
      KeySpec: "AES_256",
      EncryptionContext: {
        Purpose: "SUPPORT_INTENT",
        SchemaVersion: "1",
        SubjectId: command.subjectId,
      },
    },
  );
});

test("invalid intent identity is rejected before KMS", async () => {
  const send = vi.fn();
  const adapter = createKmsKeyManagementAdapterForTesting(config, {
    send,
    randomBytes: () => {
      throw new Error("No nonce allowed");
    },
  });
  expect(
    await adapter.generateSupportIntentKey({
      ...command,
      subjectId: "invalid",
    }),
  ).toMatchObject({ outcome: "FAILURE", error: { code: "INVALID_COMMAND" } });
  expect(send).not.toHaveBeenCalled();
});

test("empty or mismatched wrapped key evidence fails closed", async () => {
  for (const evidence of [
    { KeyId: arn, CiphertextBlob: Buffer.alloc(0) },
    { KeyId: arn },
    {
      KeyId: arn.replace("11111111-1111", "22222222-2222"),
      CiphertextBlob: Buffer.alloc(64, 7),
    },
  ]) {
    const adapter = createKmsKeyManagementAdapterForTesting(config, {
      randomBytes: () => {
        throw new Error("No plaintext field nonce allowed");
      },
      send: async () => evidence,
    });
    expect(await adapter.generateSupportIntentKey(command)).toMatchObject({
      outcome: "FAILURE",
      error: { code: "ENCRYPTION_FAILED" },
    });
  }
});

test("provider exceptions disclose only a stable safe error", async () => {
  const adapter = createKmsKeyManagementAdapterForTesting(config, {
    randomBytes: () => {
      throw new Error("No plaintext field nonce allowed");
    },
    send: async () => {
      throw Object.assign(new Error("PRIVATE-PROVIDER-DETAIL"), {
        name: "AccessDeniedException",
      });
    },
  });
  const result = await adapter.generateSupportIntentKey(command);
  expect(result).toMatchObject({
    outcome: "FAILURE",
    error: { code: "ACCESS_DENIED" },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-PROVIDER-DETAIL");
});
