/// <reference types="node" />
import { Buffer } from "node:buffer";
import {
  generateSupportIntentKeyResponseSchema,
  keyManagementPortResponseSchema,
  type CartRuntimeAddCommand,
  type CartRuntimePrivateContent,
} from "@fan-support/contracts";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import { CartRuntimeRepositoryError } from "@fan-support/persistence-port";

/** Encryption is completed before opening the atomic cart write transaction. */
export async function encryptCartRuntimeIntent(
  keys: KeyManagementPort & SupportIntentKeyPort,
  command: CartRuntimeAddCommand,
  subjectId: string,
): Promise<CartRuntimePrivateContent> {
  const fields: {
    purpose: "SUPPORT_INTENT_MESSAGE" | "SUPPORT_INTENT_DISPLAY_NAME";
    plaintextBase64: string;
  }[] = [];
  if (command.fanMessage !== undefined)
    fields.push({
      purpose: "SUPPORT_INTENT_MESSAGE",
      plaintextBase64: Buffer.from(command.fanMessage, "utf8").toString(
        "base64url",
      ),
    });
  if (command.displayMode === "nickname")
    fields.push({
      purpose: "SUPPORT_INTENT_DISPLAY_NAME",
      plaintextBase64: Buffer.from(command.displayName, "utf8").toString(
        "base64url",
      ),
    });
  const reject = (): never => {
    throw new CartRuntimeRepositoryError("TEMPORARY_UNAVAILABLE");
  };
  if (fields.length === 0) {
    const result = generateSupportIntentKeyResponseSchema.parse(
      await keys.generateSupportIntentKey({
        schemaVersion: 1,
        operation: "GENERATE_SUPPORT_INTENT_KEY",
        subjectId,
      }),
    );
    if (result.outcome !== "SUCCESS") return reject();
    return {
      fanMessageCiphertext: null,
      displayNameCiphertext: null,
      encryptedDataKey: result.value.encryptedDataKey,
      encryptionKeyVersion: result.value.keyVersion,
    };
  }
  if (fields.length === 1) {
    const field = fields[0]!;
    const result = keyManagementPortResponseSchema.parse(
      await keys.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        subjectId,
        ...field,
      }),
    );
    if (result.outcome !== "SUCCESS" || result.operation !== "ENCRYPT_ENVELOPE")
      return reject();
    return {
      fanMessageCiphertext:
        field.purpose === "SUPPORT_INTENT_MESSAGE"
          ? result.value.ciphertext
          : null,
      displayNameCiphertext:
        field.purpose === "SUPPORT_INTENT_DISPLAY_NAME"
          ? result.value.ciphertext
          : null,
      encryptedDataKey: result.value.encryptedDataKey,
      encryptionKeyVersion: result.value.keyVersion,
    };
  }
  const result = keyManagementPortResponseSchema.parse(
    await keys.encryptEnvelopeFields({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE_FIELDS",
      subjectId,
      fields,
    }),
  );
  if (
    result.outcome !== "SUCCESS" ||
    result.operation !== "ENCRYPT_ENVELOPE_FIELDS"
  )
    return reject();
  const message = result.value.fields.find(
    (field) => field.purpose === "SUPPORT_INTENT_MESSAGE",
  );
  const name = result.value.fields.find(
    (field) => field.purpose === "SUPPORT_INTENT_DISPLAY_NAME",
  );
  if (!message || !name) return reject();
  return {
    fanMessageCiphertext: message.ciphertext,
    displayNameCiphertext: name.ciphertext,
    encryptedDataKey: result.value.encryptedDataKey,
    encryptionKeyVersion: result.value.keyVersion,
  };
}
