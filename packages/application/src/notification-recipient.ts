import { Buffer } from "node:buffer";
import {
  keyManagementPortResponseSchema,
  notificationEmailDispatchSchema,
  type NotificationRecipientResult,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";

/** Call only after the repository's authorization/audit transaction has committed. */
export async function decryptNotificationRecipient(
  keys: KeyManagementPort,
  contact: NotificationRecipientResult,
): Promise<string> {
  try {
    const result = keyManagementPortResponseSchema.safeParse(
      await keys.decryptEnvelope({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        purpose: "CUSTOMER_CONTACT_EMAIL",
        subjectId: contact.customerContactId,
        ciphertext: contact.ciphertext,
        encryptedDataKey: contact.encryptedDataKey,
        keyVersion: contact.keyVersion,
        algorithm: contact.algorithm,
      }),
    );
    if (
      !result.success ||
      result.data.outcome !== "SUCCESS" ||
      result.data.operation !== "DECRYPT_ENVELOPE"
    )
      throw new Error("Invalid decryption");
    const bytes = Buffer.from(result.data.value.plaintextBase64, "base64url");
    try {
      return notificationEmailDispatchSchema.shape.recipient.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } finally {
      bytes.fill(0);
    }
  } catch {
    throw new Error("Notification recipient unavailable");
  }
}
