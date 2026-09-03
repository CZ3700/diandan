import { Buffer } from "node:buffer";

import { describe, expect, test } from "vitest";

import { keyManagementPortResponseSchema } from "@fan-support/key-management-port";
import {
  deterministicPortFixtures,
  runKeyManagementConformance,
} from "@fan-support/testing";

import {
  createKmsKeyManagementAdapterForTesting,
  type KmsKeyManagementAdapterConfig,
  type KmsKeyManagementDependencies,
} from "./adapter.js";

const plaintext = Buffer.from("private fan message", "utf8");
const plaintextBase64 = plaintext.toString("base64url");
const generatedDataKey = Buffer.alloc(32, 7);
const encryptedDataKey = Buffer.alloc(64, 9);
const currentEncryptionKeyArn =
  "arn:aws:kms:us-east-1:111122223333:key/11111111-1111-4111-8111-111111111111";
const historicalEncryptionKeyArn =
  "arn:aws:kms:us-east-1:111122223333:key/22222222-2222-4222-8222-222222222222";
const currentBlindIndexKeyArn =
  "arn:aws:kms:us-east-1:111122223333:key/33333333-3333-4333-8333-333333333333";
const historicalBlindIndexKeyArn =
  "arn:aws:kms:us-east-1:111122223333:key/44444444-4444-4444-8444-444444444444";

type HostileProviderError = Readonly<{
  label: string;
  create: () => Readonly<{
    reason: unknown;
    verifyNoUnsafeRead: () => void;
  }>;
}>;

const hostileProviderErrors: readonly HostileProviderError[] = [
  {
    label: "an own enumerable name getter",
    create: () => {
      let nameReads = 0;
      const reason = {};
      Object.defineProperty(reason, "name", {
        enumerable: true,
        get() {
          nameReads += 1;
          return "NotFoundException";
        },
      });
      return {
        reason,
        verifyNoUnsafeRead: () => expect(nameReads).toBe(0),
      };
    },
  },
  {
    label: "an inherited name",
    create: () => ({
      reason: Object.create({ name: "NotFoundException" }),
      verifyNoUnsafeRead: () => undefined,
    }),
  },
  {
    label: "a revoked proxy",
    create: () => {
      const revocable = Proxy.revocable({ name: "NotFoundException" }, {});
      revocable.revoke();
      return {
        reason: revocable.proxy,
        verifyNoUnsafeRead: () => undefined,
      };
    },
  },
  {
    label: "a throwing getOwnPropertyDescriptor trap",
    create: () => {
      let descriptorReads = 0;
      const reason = new Proxy(
        { name: "NotFoundException" },
        {
          getOwnPropertyDescriptor() {
            descriptorReads += 1;
            throw new Error("RAW_DESCRIPTOR_TRAP_MUST_NOT_ESCAPE");
          },
        },
      );
      return {
        reason,
        verifyNoUnsafeRead: () => expect(descriptorReads).toBe(1),
      };
    },
  },
];

const providerFailureOperations = [
  "ENCRYPT_ENVELOPE",
  "ENCRYPT_ENVELOPE_FIELDS",
  "DECRYPT_ENVELOPE",
  "COMPUTE_BLIND_INDEX",
] as const;

const validConfig = {
  schemaVersion: 1,
  region: "us-east-1",
  activeEncryptionKeyVersion: "envelope-2026-09",
  encryptionKeyIdsByVersion: {
    "envelope-2026-08": historicalEncryptionKeyArn,
    "envelope-2026-09": currentEncryptionKeyArn,
  },
  activeBlindIndexKeyVersion: "blind-index-2026-09",
  blindIndexKeyIdsByVersion: {
    "blind-index-2026-08": historicalBlindIndexKeyArn,
    "blind-index-2026-09": currentBlindIndexKeyArn,
  },
} as const;

function createHarness(
  responses: readonly unknown[],
  config: KmsKeyManagementAdapterConfig = validConfig,
) {
  const commands: unknown[] = [];
  const pendingResponses = [...responses];
  let randomByteCall = 0;
  const dependencies: KmsKeyManagementDependencies = {
    randomBytes: (length) => Buffer.alloc(length, 3 + randomByteCall++),
    send: async (command) => {
      commands.push(command);
      return pendingResponses.shift() ?? {};
    },
  };
  return {
    adapter: createKmsKeyManagementAdapterForTesting(config, dependencies),
    commands,
  };
}

describe("AWS KMS key-management adapter", () => {
  test("passes the shared key-management conformance suite", async () => {
    const { adapter } = createHarness([
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Mac: Uint8Array.from(Buffer.alloc(32, 11)),
        KeyId: currentBlindIndexKeyArn,
      },
      {
        Mac: Uint8Array.from(Buffer.alloc(32, 11)),
        KeyId: currentBlindIndexKeyArn,
      },
      {
        Mac: Uint8Array.from(Buffer.alloc(32, 12)),
        KeyId: currentBlindIndexKeyArn,
      },
    ]);

    const report = await runKeyManagementConformance(
      adapter,
      deterministicPortFixtures.keyManagement,
    );

    expect(report.passed, JSON.stringify(report, null, 2)).toBe(true);
    expect(report.cases).toHaveLength(12);
  });

  test("envelope-encrypts without returning the plaintext data key", async () => {
    const supplierPlaintextDataKey = Uint8Array.from(generatedDataKey);
    const { adapter, commands } = createHarness([
      {
        Plaintext: supplierPlaintextDataKey,
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
    ]);

    const result = await adapter.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: "00000000-0000-4000-8000-000000000001",
      plaintextBase64,
    });

    expect(result).toEqual({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      outcome: "SUCCESS",
      value: {
        ciphertext: expect.stringMatching(/^enc:v1:[A-Za-z0-9_-]+$/u),
        encryptedDataKey: `enc:v1:${encryptedDataKey.toString("base64url")}`,
        keyVersion: "envelope-2026-09",
        algorithm: "AES_256_GCM",
      },
    });
    expect(JSON.stringify(result)).not.toContain(
      generatedDataKey.toString("base64url"),
    );
    expect(JSON.stringify(commands[0])).toContain('"KeySpec":"AES_256"');
    expect(JSON.stringify(commands[0])).toContain('"Purpose":"SUPPORT_INTENT"');
    expect(JSON.stringify(commands[0])).not.toContain("private fan message");
    expect([...supplierPlaintextDataKey]).toEqual(Array<number>(32).fill(0));
  });

  test("accepts exactly 48 KiB of envelope plaintext and rejects one byte more", async () => {
    const exactPlaintext = Buffer.alloc(49_152, 5);
    const supplierPlaintextDataKey = Uint8Array.from(generatedDataKey);
    const { adapter, commands } = createHarness([
      {
        Plaintext: supplierPlaintextDataKey,
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
    ]);

    const exact = await adapter.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "WEBHOOK_PAYLOAD",
      subjectId: "00000000-0000-4000-8000-000000000001",
      plaintextBase64: exactPlaintext.toString("base64url"),
    });
    const tooLarge = await adapter.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "WEBHOOK_PAYLOAD",
      subjectId: "00000000-0000-4000-8000-000000000001",
      plaintextBase64: Buffer.alloc(49_153, 5).toString("base64url"),
    } as never);

    expect(exact).toMatchObject({ outcome: "SUCCESS" });
    if (exact.outcome === "SUCCESS") {
      expect(exact.value.ciphertext.length).toBe(65_581);
    }
    expect(tooLarge).toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", recovery: "NONE" },
    });
    expect(commands).toHaveLength(1);
  });

  test("encrypts support-intent message and nickname with one data key and distinct nonces", async () => {
    const { adapter, commands } = createHarness([
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
    ]);
    const messageBase64 = Buffer.from("private fan message").toString(
      "base64url",
    );
    const nicknameBase64 =
      Buffer.from("synthetic nickname").toString("base64url");

    const encrypted = await adapter.encryptEnvelopeFields({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE_FIELDS",
      subjectId: "00000000-0000-4000-8000-000000000001",
      fields: [
        { purpose: "SUPPORT_INTENT_MESSAGE", plaintextBase64: messageBase64 },
        {
          purpose: "SUPPORT_INTENT_DISPLAY_NAME",
          plaintextBase64: nicknameBase64,
        },
      ],
    });
    expect(encrypted.outcome).toBe("SUCCESS");
    if (encrypted.outcome !== "SUCCESS") {
      throw new Error("fixture field encryption failed");
    }
    expect(commands).toHaveLength(1);
    expect(JSON.stringify(commands[0])).toContain('"Purpose":"SUPPORT_INTENT"');
    expect(encrypted.value.fields).toHaveLength(2);

    const envelopes = encrypted.value.fields.map((field) =>
      Buffer.from(field.ciphertext.slice("enc:v1:".length), "base64url"),
    );
    expect(envelopes[0]?.subarray(0, 12)).not.toEqual(
      envelopes[1]?.subarray(0, 12),
    );

    for (const [field, plaintextBase64] of [
      [encrypted.value.fields[0], messageBase64],
      [encrypted.value.fields[1], nicknameBase64],
    ] as const) {
      if (field === undefined) {
        throw new Error("fixture encrypted field missing");
      }
      await expect(
        adapter.decryptEnvelope({
          schemaVersion: 1,
          operation: "DECRYPT_ENVELOPE",
          purpose: field.purpose,
          subjectId: "00000000-0000-4000-8000-000000000001",
          ciphertext: field.ciphertext,
          encryptedDataKey: encrypted.value.encryptedDataKey,
          keyVersion: encrypted.value.keyVersion,
          algorithm: "AES_256_GCM",
        }),
      ).resolves.toEqual({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        outcome: "SUCCESS",
        value: { plaintextBase64 },
      });
    }
    expect(commands).toHaveLength(3);
  });

  test("fails closed and zeroizes when a batch RNG repeats an AES-GCM nonce", async () => {
    const supplierPlaintextDataKey = Uint8Array.from(generatedDataKey);
    const adapter = createKmsKeyManagementAdapterForTesting(validConfig, {
      randomBytes: (length) => Buffer.alloc(length, 7),
      send: async () => ({
        Plaintext: supplierPlaintextDataKey,
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      }),
    });

    await expect(
      adapter.encryptEnvelopeFields({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE_FIELDS",
        subjectId: "00000000-0000-4000-8000-000000000001",
        fields: [
          {
            purpose: "SUPPORT_INTENT_MESSAGE",
            plaintextBase64,
          },
          {
            purpose: "SUPPORT_INTENT_DISPLAY_NAME",
            plaintextBase64:
              Buffer.from("synthetic nickname").toString("base64url"),
          },
        ],
      }),
    ).resolves.toMatchObject({
      operation: "ENCRYPT_ENVELOPE_FIELDS",
      outcome: "FAILURE",
      error: { code: "ENCRYPTION_FAILED", recovery: "NONE" },
    });
    expect([...supplierPlaintextDataKey]).toEqual(Array<number>(32).fill(0));
  });

  test("requires the exact non-PII encryption context to decrypt", async () => {
    const encryptionHarness = createHarness([
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
    ]);
    const encrypted = await encryptionHarness.adapter.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: "00000000-0000-4000-8000-000000000001",
      plaintextBase64,
    });
    expect(encrypted.outcome).toBe("SUCCESS");
    if (encrypted.outcome !== "SUCCESS") {
      throw new Error("fixture encryption failed");
    }

    const { adapter, commands } = createHarness([
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
    ]);
    const result = await adapter.decryptEnvelope({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: "00000000-0000-4000-8000-000000000001",
      ciphertext: encrypted.value.ciphertext,
      encryptedDataKey: encrypted.value.encryptedDataKey,
      keyVersion: encrypted.value.keyVersion,
      algorithm: "AES_256_GCM",
    });

    expect(result).toEqual({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      outcome: "SUCCESS",
      value: { plaintextBase64 },
    });
    expect(JSON.stringify(commands[0])).toContain(
      '"SubjectId":"00000000-0000-4000-8000-000000000001"',
    );
  });

  test("selects the retained KMS key for historical envelope versions", async () => {
    const encryptionHarness = createHarness([
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        CiphertextBlob: Uint8Array.from(encryptedDataKey),
        KeyId: currentEncryptionKeyArn,
      },
    ]);
    const encrypted = await encryptionHarness.adapter.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: "00000000-0000-4000-8000-000000000001",
      plaintextBase64,
    });
    expect(encrypted.outcome).toBe("SUCCESS");
    if (encrypted.outcome !== "SUCCESS") {
      throw new Error("fixture encryption failed");
    }

    const { adapter, commands } = createHarness([
      {
        Plaintext: Uint8Array.from(generatedDataKey),
        KeyId: historicalEncryptionKeyArn,
      },
    ]);
    await expect(
      adapter.decryptEnvelope({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        ciphertext: encrypted.value.ciphertext,
        encryptedDataKey: encrypted.value.encryptedDataKey,
        keyVersion: "envelope-2026-08",
        algorithm: "AES_256_GCM",
      }),
    ).resolves.toMatchObject({
      operation: "DECRYPT_ENVELOPE",
      outcome: "SUCCESS",
    });
    expect(JSON.stringify(commands[0])).toContain(historicalEncryptionKeyArn);
    expect(JSON.stringify(commands[0])).not.toContain(
      `"KeyId":"${currentEncryptionKeyArn}"`,
    );
  });

  test("rejects unretained envelope versions before calling KMS", async () => {
    const { adapter, commands } = createHarness([]);

    await expect(
      adapter.decryptEnvelope({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        ciphertext: `enc:v1:${Buffer.alloc(29, 1).toString("base64url")}`,
        encryptedDataKey: `enc:v1:${encryptedDataKey.toString("base64url")}`,
        keyVersion: "envelope-retired",
        algorithm: "AES_256_GCM",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "KEY_VERSION_NOT_FOUND",
        recovery: "NONE",
      },
    });
    expect(commands).toHaveLength(0);
  });

  test("computes blind indexes through an HMAC KMS key", async () => {
    const digest = Buffer.alloc(32, 11);
    const supplierMac = Uint8Array.from(digest);
    const { adapter, commands } = createHarness([
      { Mac: supplierMac, KeyId: currentBlindIndexKeyArn },
    ]);

    await expect(
      adapter.computeBlindIndex({
        schemaVersion: 1,
        operation: "COMPUTE_BLIND_INDEX",
        purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
        valueBase64: Buffer.from("synthetic-contact-token").toString(
          "base64url",
        ),
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "COMPUTE_BLIND_INDEX",
      outcome: "SUCCESS",
      value: {
        digestBase64: digest.toString("base64url"),
        keyVersion: "blind-index-2026-09",
        algorithm: "HMAC_SHA_256",
      },
    });
    expect(JSON.stringify(commands[0])).toContain(
      '"MacAlgorithm":"HMAC_SHA_256"',
    );
    expect(JSON.stringify(commands[0])).not.toContain(
      "synthetic-contact-token",
    );
    expect([...supplierMac]).toEqual(Array<number>(32).fill(0));
  });

  test("selects retained blind-index keys for dual-read migrations", async () => {
    const digest = Buffer.alloc(32, 12);
    const { adapter, commands } = createHarness([
      { Mac: Uint8Array.from(digest), KeyId: historicalBlindIndexKeyArn },
    ]);

    await expect(
      adapter.computeBlindIndex({
        schemaVersion: 1,
        operation: "COMPUTE_BLIND_INDEX",
        purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
        valueBase64: Buffer.from("synthetic-contact-token").toString(
          "base64url",
        ),
        keyVersion: "blind-index-2026-08",
      }),
    ).resolves.toMatchObject({
      operation: "COMPUTE_BLIND_INDEX",
      outcome: "SUCCESS",
      value: {
        digestBase64: digest.toString("base64url"),
        keyVersion: "blind-index-2026-08",
      },
    });
    expect(JSON.stringify(commands[0])).toContain(historicalBlindIndexKeyArn);
    expect(JSON.stringify(commands[0])).not.toContain(currentBlindIndexKeyArn);
  });

  test("rejects unretained blind-index versions before calling KMS", async () => {
    const { adapter, commands } = createHarness([]);

    await expect(
      adapter.computeBlindIndex({
        schemaVersion: 1,
        operation: "COMPUTE_BLIND_INDEX",
        purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
        valueBase64: Buffer.from("synthetic-contact-token").toString(
          "base64url",
        ),
        keyVersion: "blind-index-retired",
      }),
    ).resolves.toMatchObject({
      operation: "COMPUTE_BLIND_INDEX",
      outcome: "FAILURE",
      error: { code: "KEY_VERSION_NOT_FOUND", recovery: "NONE" },
    });
    expect(commands).toHaveLength(0);
  });

  test("fails closed when KMS omits required key material", async () => {
    const { adapter } = createHarness([{ KeyId: currentEncryptionKeyArn }]);
    const result = await adapter.encryptEnvelope({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "SUPPORT_INTENT_MESSAGE",
      subjectId: "00000000-0000-4000-8000-000000000001",
      plaintextBase64,
    });
    expect(result).toEqual({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "ENCRYPTION_FAILED",
        recovery: "NONE",
      },
    });
  });

  test("rejects plaintext above the port limit before calling KMS", async () => {
    const { adapter, commands } = createHarness([]);

    await expect(
      adapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        plaintextBase64: Buffer.alloc(49_153, 1).toString("base64url"),
      } as never),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "INVALID_COMMAND",
        recovery: "NONE",
      },
    });
    expect(commands).toHaveLength(0);
  });

  test("rejects blind-index inputs above the KMS message limit before calling KMS", async () => {
    const { adapter, commands } = createHarness([]);

    await expect(
      adapter.computeBlindIndex({
        schemaVersion: 1,
        operation: "COMPUTE_BLIND_INDEX",
        purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
        valueBase64: Buffer.alloc(4_096, 1).toString("base64url"),
      }),
    ).resolves.toMatchObject({
      operation: "COMPUTE_BLIND_INDEX",
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", recovery: "NONE" },
    });
    expect(commands).toHaveLength(0);
  });

  test("zeroizes supplier key material even when KMS returns a mismatched key id", async () => {
    const encryptionDataKey = Uint8Array.from(generatedDataKey);
    const decryptDataKey = Uint8Array.from(generatedDataKey);
    const encryptAdapter = createKmsKeyManagementAdapterForTesting(
      validConfig,
      {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => ({
          Plaintext: encryptionDataKey,
          CiphertextBlob: Uint8Array.from(encryptedDataKey),
          KeyId: historicalEncryptionKeyArn,
        }),
      },
    );
    await expect(
      encryptAdapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        plaintextBase64,
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "ENCRYPTION_FAILED" },
    });
    expect([...encryptionDataKey]).toEqual(Array<number>(32).fill(0));

    const decryptAdapter = createKmsKeyManagementAdapterForTesting(
      validConfig,
      {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => ({
          Plaintext: decryptDataKey,
          KeyId: historicalEncryptionKeyArn,
        }),
      },
    );
    await expect(
      decryptAdapter.decryptEnvelope({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        ciphertext: `enc:v1:${Buffer.alloc(29, 1).toString("base64url")}`,
        encryptedDataKey: `enc:v1:${encryptedDataKey.toString("base64url")}`,
        keyVersion: "envelope-2026-09",
        algorithm: "AES_256_GCM",
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "DECRYPTION_FAILED" },
    });
    expect([...decryptDataKey]).toEqual(Array<number>(32).fill(0));
  });

  test.each(["KeyUnavailableException", "DependencyTimeoutException"])(
    "maps retryable KMS %s failures to temporary unavailability",
    async (name) => {
      const adapter = createKmsKeyManagementAdapterForTesting(validConfig, {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => {
          const error = new Error("supplier detail");
          error.name = name;
          throw error;
        },
      });

      await expect(
        adapter.encryptEnvelope({
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          purpose: "SUPPORT_INTENT_MESSAGE",
          subjectId: "00000000-0000-4000-8000-000000000001",
          plaintextBase64,
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: {
          code: "TEMPORARY_UNAVAILABLE",
          recovery: "RETRY_SAME_COMMAND",
        },
      });
    },
  );

  test.each(["InvalidCiphertextException", "IncorrectKeyException"])(
    "maps deterministic decrypt failure %s without recommending a retry",
    async (name) => {
      const adapter = createKmsKeyManagementAdapterForTesting(validConfig, {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => {
          const error = new Error("supplier detail");
          error.name = name;
          throw error;
        },
      });

      await expect(
        adapter.decryptEnvelope({
          schemaVersion: 1,
          operation: "DECRYPT_ENVELOPE",
          purpose: "SUPPORT_INTENT_MESSAGE",
          subjectId: "00000000-0000-4000-8000-000000000001",
          ciphertext: `enc:v1:${Buffer.alloc(29, 1).toString("base64url")}`,
          encryptedDataKey: `enc:v1:${encryptedDataKey.toString("base64url")}`,
          keyVersion: "envelope-2026-09",
          algorithm: "AES_256_GCM",
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: "DECRYPTION_FAILED", recovery: "NONE" },
      });
    },
  );

  test.each(["InvalidKeyUsageException", "KMSInvalidStateException"])(
    "maps deterministic KMS key configuration failure %s without recommending a retry",
    async (name) => {
      const adapter = createKmsKeyManagementAdapterForTesting(validConfig, {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => {
          const error = new Error("supplier detail");
          error.name = name;
          throw error;
        },
      });

      await expect(
        adapter.encryptEnvelope({
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          purpose: "SUPPORT_INTENT_MESSAGE",
          subjectId: "00000000-0000-4000-8000-000000000001",
          plaintextBase64,
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
      });
    },
  );

  test.each([
    ["CredentialsProviderError", "CONFIGURATION_ERROR"],
    ["ExpiredTokenException", "ACCESS_DENIED"],
    ["UnrecognizedClientException", "ACCESS_DENIED"],
    ["InvalidSignatureException", "ACCESS_DENIED"],
  ] as const)(
    "normalizes deterministic KMS identity failure %s without retrying",
    async (supplierErrorName, expectedCode) => {
      const adapter = createKmsKeyManagementAdapterForTesting(validConfig, {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => {
          const error = new Error("supplier detail");
          error.name = supplierErrorName;
          throw error;
        },
      });

      await expect(
        adapter.encryptEnvelope({
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE",
          purpose: "SUPPORT_INTENT_MESSAGE",
          subjectId: "00000000-0000-4000-8000-000000000001",
          plaintextBase64,
        }),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: expectedCode, recovery: "NONE" },
      });
    },
  );

  test("keeps unclassified KMS transport failures retryable", async () => {
    const adapter = createKmsKeyManagementAdapterForTesting(validConfig, {
      randomBytes: (length) => Buffer.alloc(length, 3),
      send: async () => {
        throw new Error("unclassified supplier failure");
      },
    });

    await expect(
      adapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        plaintextBase64,
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: {
        code: "UNEXPECTED_ADAPTER_FAILURE",
        recovery: "RETRY_SAME_COMMAND",
      },
    });
  });

  test.each(
    providerFailureOperations.flatMap((operation) =>
      hostileProviderErrors.map(
        ({ label, create }) => [operation, label, create] as const,
      ),
    ),
  )(
    "returns a stable %s failure when KMS rejects with %s",
    async (operation, _errorLabel, createError) => {
      const { reason, verifyNoUnsafeRead } = createError();
      const adapter = createKmsKeyManagementAdapterForTesting(validConfig, {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => Promise.reject(reason),
      });
      const result = await (operation === "ENCRYPT_ENVELOPE"
        ? adapter.encryptEnvelope({
            schemaVersion: 1,
            operation,
            purpose: "SUPPORT_INTENT_MESSAGE",
            subjectId: "00000000-0000-4000-8000-000000000001",
            plaintextBase64,
          })
        : operation === "ENCRYPT_ENVELOPE_FIELDS"
          ? adapter.encryptEnvelopeFields({
              schemaVersion: 1,
              operation,
              subjectId: "00000000-0000-4000-8000-000000000001",
              fields: [
                {
                  purpose: "SUPPORT_INTENT_MESSAGE",
                  plaintextBase64,
                },
                {
                  purpose: "SUPPORT_INTENT_DISPLAY_NAME",
                  plaintextBase64:
                    Buffer.from("synthetic nickname").toString("base64url"),
                },
              ],
            })
          : operation === "DECRYPT_ENVELOPE"
            ? adapter.decryptEnvelope({
                schemaVersion: 1,
                operation,
                purpose: "SUPPORT_INTENT_MESSAGE",
                subjectId: "00000000-0000-4000-8000-000000000001",
                ciphertext: `enc:v1:${Buffer.alloc(29, 1).toString("base64url")}`,
                encryptedDataKey: `enc:v1:${encryptedDataKey.toString("base64url")}`,
                keyVersion: "envelope-2026-09",
                algorithm: "AES_256_GCM",
              })
            : adapter.computeBlindIndex({
                schemaVersion: 1,
                operation,
                purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
                valueBase64: Buffer.from("synthetic-contact-token").toString(
                  "base64url",
                ),
              }));

      expect(result).toEqual({
        schemaVersion: 1,
        operation,
        outcome: "FAILURE",
        error: {
          schemaVersion: 1,
          code: "UNEXPECTED_ADAPTER_FAILURE",
          recovery: "RETRY_SAME_COMMAND",
          retryAfterMs: 1_000,
        },
      });
      expect(keyManagementPortResponseSchema.safeParse(result).success).toBe(
        true,
      );
      verifyNoUnsafeRead();
    },
  );

  test("rejects accessor-backed configuration without reading or calling KMS", async () => {
    let configurationReads = 0;
    const commands: unknown[] = [];
    const accessorConfig = {
      schemaVersion: 1,
      region: "us-east-1",
      activeEncryptionKeyVersion: "envelope-2026-09",
      activeBlindIndexKeyVersion: "blind-index-2026-09",
      blindIndexKeyIdsByVersion: {
        "blind-index-2026-09": currentBlindIndexKeyArn,
      },
    } as Record<string, unknown>;
    Object.defineProperty(accessorConfig, "encryptionKeyIdsByVersion", {
      enumerable: true,
      get() {
        configurationReads += 1;
        return configurationReads === 1
          ? { "envelope-2026-09": currentEncryptionKeyArn }
          : {
              "envelope-2026-09":
                "arn:aws:kms:us-east-1:999900001111:key/55555555-5555-4555-8555-555555555555",
            };
      },
    });
    const adapter = createKmsKeyManagementAdapterForTesting(
      accessorConfig as never,
      {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async (command) => {
          commands.push(command);
          return {
            Plaintext: Uint8Array.from(generatedDataKey),
            CiphertextBlob: Uint8Array.from(encryptedDataKey),
            KeyId:
              "arn:aws:kms:us-east-1:999900001111:key/55555555-5555-4555-8555-555555555555",
          };
        },
      },
    );

    await expect(
      adapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        plaintextBase64,
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(configurationReads).toBe(0);
    expect(commands).toHaveLength(0);
  });

  test.each([
    [
      "an unknown root key",
      { ...validConfig, unexpectedOption: "must-fail-closed" },
    ],
    [
      "a custom root prototype",
      Object.assign(Object.create({ inheritedOption: true }), validConfig),
    ],
    [
      "an accessor-backed version map",
      {
        ...validConfig,
        encryptionKeyIdsByVersion: Object.defineProperty(
          {},
          "envelope-2026-09",
          {
            enumerable: true,
            get: () => currentEncryptionKeyArn,
          },
        ),
      },
    ],
  ])("rejects configuration with %s", async (_caseName, config) => {
    const commands: unknown[] = [];
    const adapter = createKmsKeyManagementAdapterForTesting(config as never, {
      randomBytes: (length) => Buffer.alloc(length, 3),
      send: async (command) => {
        commands.push(command);
        return {};
      },
    });

    await expect(
      adapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        plaintextBase64,
      }),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "CONFIGURATION_ERROR", recovery: "NONE" },
    });
    expect(commands).toHaveLength(0);
  });

  test("uses an immutable configuration snapshot after construction", async () => {
    const mutableEncryptionKeys = {
      "envelope-2026-09": currentEncryptionKeyArn,
    };
    const mutableConfig = {
      ...validConfig,
      encryptionKeyIdsByVersion: mutableEncryptionKeys,
    };
    const { adapter, commands } = createHarness(
      [
        {
          Plaintext: Uint8Array.from(generatedDataKey),
          CiphertextBlob: Uint8Array.from(encryptedDataKey),
          KeyId: currentEncryptionKeyArn,
        },
      ],
      mutableConfig,
    );
    mutableEncryptionKeys["envelope-2026-09"] =
      "arn:aws:kms:us-east-1:999900001111:key/55555555-5555-4555-8555-555555555555";

    await expect(
      adapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        plaintextBase64,
      }),
    ).resolves.toMatchObject({
      outcome: "SUCCESS",
      value: { keyVersion: "envelope-2026-09" },
    });
    expect(JSON.stringify(commands[0])).toContain(currentEncryptionKeyArn);
    expect(JSON.stringify(commands[0])).not.toContain("999900001111");
  });

  test("rejects non-canonical key configuration before calling KMS", async () => {
    const commands: unknown[] = [];
    const adapter = createKmsKeyManagementAdapterForTesting(
      {
        schemaVersion: 1,
        region: "us-east-1",
        activeEncryptionKeyVersion: "envelope-2026-09",
        encryptionKeyIdsByVersion: {
          "envelope-2026-09": "alias/fan-support-envelope",
        },
        activeBlindIndexKeyVersion: "blind-index-2026-09",
        blindIndexKeyIdsByVersion: {
          "blind-index-2026-09": currentBlindIndexKeyArn,
        },
      },
      {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async (command) => {
          commands.push(command);
          return {};
        },
      },
    );

    await expect(
      adapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "SUPPORT_INTENT_MESSAGE",
        subjectId: "00000000-0000-4000-8000-000000000001",
        plaintextBase64,
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      },
    });
    expect(commands).toHaveLength(0);
  });

  test("normalizes access denial without leaking supplier details", async () => {
    const canary = "RAW_KMS_ERROR_MUST_NOT_ESCAPE";
    const failingAdapter = createKmsKeyManagementAdapterForTesting(
      {
        schemaVersion: 1,
        region: "us-east-1",
        activeEncryptionKeyVersion: "envelope-2026-09",
        encryptionKeyIdsByVersion: {
          "envelope-2026-09": currentEncryptionKeyArn,
        },
        activeBlindIndexKeyVersion: "blind-index-2026-09",
        blindIndexKeyIdsByVersion: {
          "blind-index-2026-09": currentBlindIndexKeyArn,
        },
      },
      {
        randomBytes: (length) => Buffer.alloc(length, 3),
        send: async () => {
          const error = new Error(canary);
          error.name = "AccessDeniedException";
          throw error;
        },
      },
    );

    const result = await failingAdapter.computeBlindIndex({
      schemaVersion: 1,
      operation: "COMPUTE_BLIND_INDEX",
      purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
      valueBase64: Buffer.from("synthetic-contact-token").toString("base64url"),
    });
    expect(result).toEqual({
      schemaVersion: 1,
      operation: "COMPUTE_BLIND_INDEX",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "ACCESS_DENIED",
        recovery: "NONE",
      },
    });
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});
