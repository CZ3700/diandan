import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes as nodeRandomBytes,
} from "node:crypto";

import {
  DecryptCommand,
  GenerateDataKeyCommand,
  GenerateMacCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import {
  keyManagementPortCommandSchema,
  keyManagementPortResponseSchema,
  MAX_ENVELOPE_PLAINTEXT_BYTES,
  type ComputeBlindIndexResponse,
  type DecryptEnvelopeResponse,
  type EncryptEnvelopeFieldsResponse,
  type EncryptEnvelopeResponse,
  type KeyManagementPort,
  type KeyManagementPortError,
} from "@fan-support/key-management-port";

type Operation =
  | "ENCRYPT_ENVELOPE"
  | "ENCRYPT_ENVELOPE_FIELDS"
  | "DECRYPT_ENVELOPE"
  | "COMPUTE_BLIND_INDEX";
type JsonRecord = Readonly<Record<string, unknown>>;
type ResponseByOperation = Readonly<{
  ENCRYPT_ENVELOPE: EncryptEnvelopeResponse;
  ENCRYPT_ENVELOPE_FIELDS: EncryptEnvelopeFieldsResponse;
  DECRYPT_ENVELOPE: DecryptEnvelopeResponse;
  COMPUTE_BLIND_INDEX: ComputeBlindIndexResponse;
}>;
type FailureFor<SelectedOperation extends Operation> = Extract<
  ResponseByOperation[SelectedOperation],
  { outcome: "FAILURE" }
>;
type SuccessFor<SelectedOperation extends Operation> = Extract<
  ResponseByOperation[SelectedOperation],
  { outcome: "SUCCESS" }
>;

export type KmsKeyManagementAdapterConfig = Readonly<{
  schemaVersion: 1;
  region: string;
  activeEncryptionKeyVersion: string;
  encryptionKeyIdsByVersion: Readonly<Record<string, string>>;
  activeBlindIndexKeyVersion: string;
  blindIndexKeyIdsByVersion: Readonly<Record<string, string>>;
}>;

export type KmsKeyManagementDependencies = Readonly<{
  randomBytes: (length: number) => Uint8Array;
  send: (command: unknown) => Promise<unknown>;
}>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  code: KeyManagementPortError["code"],
): FailureFor<SelectedOperation> {
  const recovery = [
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
    "UNEXPECTED_ADAPTER_FAILURE",
  ].includes(code)
    ? "RETRY_SAME_COMMAND"
    : "NONE";
  return keyManagementPortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery,
      ...(recovery === "RETRY_SAME_COMMAND" ? { retryAfterMs: 1_000 } : {}),
    },
  }) as FailureFor<SelectedOperation>;
}

function success<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  value: JsonRecord,
): SuccessFor<SelectedOperation> {
  return keyManagementPortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "SUCCESS",
    value,
  }) as SuccessFor<SelectedOperation>;
}

function errorName(error: unknown): string {
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return "";
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "name");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : "";
  } catch {
    return "";
  }
}

function normalizedFailure<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  error: unknown,
): FailureFor<SelectedOperation> {
  return normalizedFailureForName(operation, errorName(error));
}

function normalizedFailureForName<SelectedOperation extends Operation>(
  operation: SelectedOperation,
  name: string,
): FailureFor<SelectedOperation> {
  if (["InvalidCiphertextException", "IncorrectKeyException"].includes(name)) {
    return failure(
      operation,
      operation === "DECRYPT_ENVELOPE"
        ? "DECRYPTION_FAILED"
        : "CONFIGURATION_ERROR",
    );
  }
  if (["InvalidKeyUsageException", "KMSInvalidStateException"].includes(name)) {
    return failure(operation, "CONFIGURATION_ERROR");
  }
  if (name === "CredentialsProviderError") {
    return failure(operation, "CONFIGURATION_ERROR");
  }
  if (
    [
      "AccessDeniedException",
      "DisabledException",
      "ExpiredTokenException",
      "InvalidGrantTokenException",
      "InvalidSignatureException",
      "UnrecognizedClientException",
    ].includes(name)
  ) {
    return failure(operation, "ACCESS_DENIED");
  }
  if (
    ["Throttling", "ThrottlingException", "LimitExceededException"].includes(
      name,
    )
  ) {
    return failure(operation, "RATE_LIMITED");
  }
  if (
    [
      "DependencyTimeoutException",
      "KeyUnavailableException",
      "KMSInternalException",
      "ServiceUnavailable",
      "TimeoutError",
    ].includes(name)
  ) {
    return failure(operation, "TEMPORARY_UNAVAILABLE");
  }
  if (name === "NotFoundException") {
    return failure(
      operation,
      operation === "DECRYPT_ENVELOPE"
        ? "KEY_VERSION_NOT_FOUND"
        : "CONFIGURATION_ERROR",
    );
  }
  return failure(operation, "UNEXPECTED_ADAPTER_FAILURE");
}

function encryptionContext(purpose: string, subjectId: string) {
  return {
    Purpose: purpose,
    SchemaVersion: "1",
    SubjectId: subjectId,
  } as const;
}

function envelopeKeyPurpose(purpose: string): string {
  return purpose === "SUPPORT_INTENT_MESSAGE" ||
    purpose === "SUPPORT_INTENT_DISPLAY_NAME"
    ? "SUPPORT_INTENT"
    : purpose;
}

function authenticatedContext(purpose: string, subjectId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      Purpose: purpose,
      SchemaVersion: "1",
      SubjectId: subjectId,
    }),
    "utf8",
  );
}

function decodeVersionedBytes(value: string): Buffer | undefined {
  if (!value.startsWith("enc:v1:")) {
    return undefined;
  }
  try {
    const bytes = Buffer.from(value.slice("enc:v1:".length), "base64url");
    return bytes.byteLength > 0 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function encodeVersionedBytes(value: Uint8Array): string {
  return `enc:v1:${Buffer.from(value).toString("base64url")}`;
}

function readBytes(value: unknown): Buffer | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    return undefined;
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

const keyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const regionPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const configKeys = [
  "schemaVersion",
  "region",
  "activeEncryptionKeyVersion",
  "encryptionKeyIdsByVersion",
  "activeBlindIndexKeyVersion",
  "blindIndexKeyIdsByVersion",
] as const;

function readPlainDataProperties(
  value: unknown,
  expectedKeys?: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      return undefined;
    }
    const stringKeys = ownKeys as string[];
    if (
      expectedKeys !== undefined &&
      (stringKeys.length !== expectedKeys.length ||
        expectedKeys.some((key) => !stringKeys.includes(key)))
    ) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const properties: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of stringKeys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return undefined;
      }
      properties[key] = descriptor.value;
    }
    return properties;
  } catch {
    return undefined;
  }
}

function isImmutableKmsKeyArn(value: unknown, region: string): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match =
    /^arn:aws(?:-[a-z0-9-]+)?:kms:([a-z0-9-]+):[0-9]{12}:key\/[A-Za-z0-9-]{1,128}$/u.exec(
      value,
    );
  return match?.[1] === region;
}

function normalizeVersionedKeyMap(
  value: unknown,
  activeVersion: unknown,
  region: string,
): Readonly<Record<string, string>> | undefined {
  const properties = readPlainDataProperties(value);
  if (properties === undefined || typeof activeVersion !== "string") {
    return undefined;
  }
  const keys = Object.entries(properties);
  if (
    keys.length < 1 ||
    keys.length > 32 ||
    !keyVersionPattern.test(activeVersion) ||
    !keys.every(
      ([version, keyId]) =>
        keyVersionPattern.test(version) && isImmutableKmsKeyArn(keyId, region),
    ) ||
    !Object.hasOwn(properties, activeVersion)
  ) {
    return undefined;
  }
  return Object.freeze(Object.fromEntries(keys)) as Readonly<
    Record<string, string>
  >;
}

function normalizeConfig(
  value: unknown,
): KmsKeyManagementAdapterConfig | undefined {
  const properties = readPlainDataProperties(value, configKeys);
  if (properties === undefined) {
    return undefined;
  }
  const schemaVersion = properties["schemaVersion"];
  const region = properties["region"];
  const activeEncryptionKeyVersion = properties["activeEncryptionKeyVersion"];
  const activeBlindIndexKeyVersion = properties["activeBlindIndexKeyVersion"];
  if (
    schemaVersion !== 1 ||
    typeof region !== "string" ||
    !regionPattern.test(region) ||
    typeof activeEncryptionKeyVersion !== "string" ||
    typeof activeBlindIndexKeyVersion !== "string"
  ) {
    return undefined;
  }
  const encryptionKeyIdsByVersion = normalizeVersionedKeyMap(
    properties["encryptionKeyIdsByVersion"],
    activeEncryptionKeyVersion,
    region,
  );
  const blindIndexKeyIdsByVersion = normalizeVersionedKeyMap(
    properties["blindIndexKeyIdsByVersion"],
    activeBlindIndexKeyVersion,
    region,
  );
  if (
    encryptionKeyIdsByVersion === undefined ||
    blindIndexKeyIdsByVersion === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion,
    region,
    activeEncryptionKeyVersion,
    encryptionKeyIdsByVersion,
    activeBlindIndexKeyVersion,
    blindIndexKeyIdsByVersion,
  });
}

function keyIdForVersion(
  keysByVersion: Readonly<Record<string, string>>,
  version: string,
): string | undefined {
  return Object.hasOwn(keysByVersion, version)
    ? keysByVersion[version]
    : undefined;
}

function createConfiguredAdapter(
  config: KmsKeyManagementAdapterConfig | undefined,
  dependencies: KmsKeyManagementDependencies,
) {
  const randomBytes = dependencies.randomBytes;
  const send = dependencies.send;
  const encryptFieldSet = async <
    SelectedOperation extends "ENCRYPT_ENVELOPE" | "ENCRYPT_ENVELOPE_FIELDS",
  >(
    operation: SelectedOperation,
    subjectId: string,
    fields: readonly Readonly<{
      purpose: string;
      plaintextBase64: string;
    }>[],
    resultValue: (
      encryptedFields: readonly Readonly<{
        purpose: string;
        ciphertext: string;
      }>[],
      encryptedDataKey: string,
      keyVersion: string,
    ) => JsonRecord,
  ): Promise<ResponseByOperation[SelectedOperation]> => {
    if (config === undefined) {
      return failure(operation, "CONFIGURATION_ERROR");
    }
    const plaintextFields = fields.map((field) => ({
      purpose: field.purpose,
      plaintext: Buffer.from(field.plaintextBase64, "base64url"),
    }));
    if (
      plaintextFields.some(
        (field) => field.plaintext.byteLength > MAX_ENVELOPE_PLAINTEXT_BYTES,
      )
    ) {
      for (const field of plaintextFields) {
        field.plaintext.fill(0);
      }
      return failure(operation, "PLAINTEXT_TOO_LARGE");
    }
    const keyPurposes = new Set(
      plaintextFields.map((field) => envelopeKeyPurpose(field.purpose)),
    );
    if (keyPurposes.size !== 1) {
      for (const field of plaintextFields) {
        field.plaintext.fill(0);
      }
      return failure(operation, "INVALID_COMMAND");
    }

    let dataKey: Buffer | undefined;
    try {
      const encryptionKeyId = keyIdForVersion(
        config.encryptionKeyIdsByVersion,
        config.activeEncryptionKeyVersion,
      );
      if (encryptionKeyId === undefined) {
        return failure(operation, "CONFIGURATION_ERROR");
      }
      let raw: unknown;
      try {
        raw = await send(
          new GenerateDataKeyCommand({
            EncryptionContext: encryptionContext(
              [...keyPurposes][0] ?? "INVALID",
              subjectId,
            ),
            KeyId: encryptionKeyId,
            KeySpec: "AES_256",
          }),
        );
      } catch (error: unknown) {
        return normalizedFailure(operation, error);
      }
      dataKey = isRecord(raw) ? readBytes(raw["Plaintext"]) : undefined;
      const encryptedKey = isRecord(raw)
        ? readBytes(raw["CiphertextBlob"])
        : undefined;
      if (
        !isRecord(raw) ||
        raw["KeyId"] !== encryptionKeyId ||
        dataKey?.byteLength !== 32 ||
        encryptedKey === undefined
      ) {
        return failure(operation, "ENCRYPTION_FAILED");
      }

      const usedInitializationVectors = new Set<string>();
      const encryptedFields: Array<{
        purpose: string;
        ciphertext: string;
      }> = [];
      for (const field of plaintextFields) {
        const initializationVector = Buffer.from(randomBytes(12));
        const initializationVectorId = initializationVector.toString("hex");
        if (
          initializationVector.byteLength !== 12 ||
          usedInitializationVectors.has(initializationVectorId)
        ) {
          return failure(operation, "ENCRYPTION_FAILED");
        }
        usedInitializationVectors.add(initializationVectorId);
        const cipher = createCipheriv(
          "aes-256-gcm",
          dataKey,
          initializationVector,
        );
        cipher.setAAD(authenticatedContext(field.purpose, subjectId));
        const encryptedPayload = Buffer.concat([
          cipher.update(field.plaintext),
          cipher.final(),
        ]);
        encryptedFields.push({
          purpose: field.purpose,
          ciphertext: encodeVersionedBytes(
            Buffer.concat([
              initializationVector,
              cipher.getAuthTag(),
              encryptedPayload,
            ]),
          ),
        });
      }
      return success(
        operation,
        resultValue(
          encryptedFields,
          encodeVersionedBytes(encryptedKey),
          config.activeEncryptionKeyVersion,
        ),
      );
    } catch {
      return failure(operation, "ENCRYPTION_FAILED");
    } finally {
      for (const field of plaintextFields) {
        field.plaintext.fill(0);
      }
      dataKey?.fill(0);
    }
  };

  return {
    async encryptEnvelope(input: unknown) {
      const parsed = keyManagementPortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "ENCRYPT_ENVELOPE") {
        return failure("ENCRYPT_ENVELOPE", "INVALID_COMMAND");
      }
      return encryptFieldSet(
        "ENCRYPT_ENVELOPE",
        parsed.data.subjectId,
        [parsed.data],
        (encryptedFields, encryptedDataKey, keyVersion) => ({
          ciphertext: encryptedFields[0]?.ciphertext ?? "",
          encryptedDataKey,
          keyVersion,
          algorithm: "AES_256_GCM",
        }),
      );
    },

    async encryptEnvelopeFields(input: unknown) {
      const parsed = keyManagementPortCommandSchema.safeParse(input);
      if (
        !parsed.success ||
        parsed.data.operation !== "ENCRYPT_ENVELOPE_FIELDS"
      ) {
        return failure("ENCRYPT_ENVELOPE_FIELDS", "INVALID_COMMAND");
      }
      return encryptFieldSet(
        "ENCRYPT_ENVELOPE_FIELDS",
        parsed.data.subjectId,
        parsed.data.fields,
        (fields, encryptedDataKey, keyVersion) => ({
          fields,
          encryptedDataKey,
          keyVersion,
          algorithm: "AES_256_GCM",
        }),
      );
    },

    async decryptEnvelope(input: unknown) {
      const parsed = keyManagementPortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "DECRYPT_ENVELOPE") {
        return failure("DECRYPT_ENVELOPE", "INVALID_COMMAND");
      }
      if (config === undefined) {
        return failure("DECRYPT_ENVELOPE", "CONFIGURATION_ERROR");
      }
      const decryptionKeyId = Object.hasOwn(
        config.encryptionKeyIdsByVersion,
        parsed.data.keyVersion,
      )
        ? keyIdForVersion(
            config.encryptionKeyIdsByVersion,
            parsed.data.keyVersion,
          )
        : undefined;
      if (decryptionKeyId === undefined) {
        return failure("DECRYPT_ENVELOPE", "KEY_VERSION_NOT_FOUND");
      }
      const encryptedKey = decodeVersionedBytes(parsed.data.encryptedDataKey);
      const envelope = decodeVersionedBytes(parsed.data.ciphertext);
      if (
        encryptedKey === undefined ||
        envelope === undefined ||
        envelope.byteLength <= 28
      ) {
        return failure("DECRYPT_ENVELOPE", "DECRYPTION_FAILED");
      }
      let dataKey: Buffer | undefined;
      let decrypted: Buffer | undefined;
      try {
        let raw: unknown;
        try {
          raw = await send(
            new DecryptCommand({
              CiphertextBlob: encryptedKey,
              EncryptionContext: encryptionContext(
                envelopeKeyPurpose(parsed.data.purpose),
                parsed.data.subjectId,
              ),
              KeyId: decryptionKeyId,
            }),
          );
        } catch (error: unknown) {
          return normalizedFailure("DECRYPT_ENVELOPE", error);
        }
        dataKey = isRecord(raw) ? readBytes(raw["Plaintext"]) : undefined;
        if (
          !isRecord(raw) ||
          raw["KeyId"] !== decryptionKeyId ||
          dataKey?.byteLength !== 32
        ) {
          return failure("DECRYPT_ENVELOPE", "DECRYPTION_FAILED");
        }
        const initializationVector = envelope.subarray(0, 12);
        const authenticationTag = envelope.subarray(12, 28);
        const ciphertext = envelope.subarray(28);
        const decipher = createDecipheriv(
          "aes-256-gcm",
          dataKey,
          initializationVector,
        );
        decipher.setAAD(
          authenticatedContext(parsed.data.purpose, parsed.data.subjectId),
        );
        decipher.setAuthTag(authenticationTag);
        decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        return success("DECRYPT_ENVELOPE", {
          plaintextBase64: decrypted.toString("base64url"),
        });
      } catch {
        return failure("DECRYPT_ENVELOPE", "DECRYPTION_FAILED");
      } finally {
        encryptedKey.fill(0);
        envelope.fill(0);
        dataKey?.fill(0);
        decrypted?.fill(0);
      }
    },

    async computeBlindIndex(input: unknown) {
      const parsed = keyManagementPortCommandSchema.safeParse(input);
      if (!parsed.success || parsed.data.operation !== "COMPUTE_BLIND_INDEX") {
        return failure("COMPUTE_BLIND_INDEX", "INVALID_COMMAND");
      }
      if (config === undefined) {
        return failure("COMPUTE_BLIND_INDEX", "CONFIGURATION_ERROR");
      }
      const value = Buffer.from(parsed.data.valueBase64, "base64url");
      const domain = Buffer.from(
        `fan-support:v1:${parsed.data.purpose}\0`,
        "utf8",
      );
      const message = Buffer.concat([domain, value]);
      if (message.byteLength > 4_096) {
        value.fill(0);
        message.fill(0);
        return failure("COMPUTE_BLIND_INDEX", "INVALID_COMMAND");
      }
      let mac: Buffer | undefined;
      try {
        const keyVersion =
          parsed.data.keyVersion ?? config.activeBlindIndexKeyVersion;
        const blindIndexKeyId = keyIdForVersion(
          config.blindIndexKeyIdsByVersion,
          keyVersion,
        );
        if (blindIndexKeyId === undefined) {
          return failure("COMPUTE_BLIND_INDEX", "KEY_VERSION_NOT_FOUND");
        }
        let raw: unknown;
        try {
          raw = await send(
            new GenerateMacCommand({
              KeyId: blindIndexKeyId,
              MacAlgorithm: "HMAC_SHA_256",
              Message: message,
            }),
          );
        } catch (error: unknown) {
          const name = errorName(error);
          if (name === "NotFoundException") {
            return failure(
              "COMPUTE_BLIND_INDEX",
              parsed.data.keyVersion === undefined
                ? "CONFIGURATION_ERROR"
                : "KEY_VERSION_NOT_FOUND",
            );
          }
          return normalizedFailureForName("COMPUTE_BLIND_INDEX", name);
        }
        mac = isRecord(raw) ? readBytes(raw["Mac"]) : undefined;
        if (
          !isRecord(raw) ||
          raw["KeyId"] !== blindIndexKeyId ||
          mac?.byteLength !== 32
        ) {
          return failure("COMPUTE_BLIND_INDEX", "MAC_FAILED");
        }
        return success("COMPUTE_BLIND_INDEX", {
          digestBase64: mac.toString("base64url"),
          keyVersion,
          algorithm: "HMAC_SHA_256",
        });
      } catch {
        return failure("COMPUTE_BLIND_INDEX", "MAC_FAILED");
      } finally {
        value.fill(0);
        message.fill(0);
        mac?.fill(0);
      }
    },
  };
}

export function createKmsKeyManagementAdapterForTesting(
  config: KmsKeyManagementAdapterConfig,
  dependencies: KmsKeyManagementDependencies,
) {
  return createConfiguredAdapter(normalizeConfig(config), dependencies);
}

export function createKmsKeyManagementAdapter(
  config: KmsKeyManagementAdapterConfig,
): KeyManagementPort {
  const normalizedConfig = normalizeConfig(config);
  const client =
    normalizedConfig === undefined
      ? undefined
      : new KMSClient({ region: normalizedConfig.region });
  return createConfiguredAdapter(normalizedConfig, {
    randomBytes: nodeRandomBytes,
    send: (command) => {
      if (client === undefined) {
        throw new Error("KMS adapter is not configured");
      }
      return client.send(command as never);
    },
  });
}
