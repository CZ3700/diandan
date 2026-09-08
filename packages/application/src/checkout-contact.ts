import { Buffer } from "node:buffer";
import { keyManagementPortResponseSchema } from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";

/** Complete contact encryption outside the checkout transaction; never decrypt the cart intent. */
export async function encryptCheckoutContact(
  keys: KeyManagementPort,
  email: string,
  subjectId: string,
) {
  try {
    const encrypted = keyManagementPortResponseSchema.parse(
      await keys.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "CUSTOMER_CONTACT_EMAIL",
        subjectId,
        plaintextBase64: Buffer.from(email, "utf8").toString("base64url"),
      }),
    );
    if (
      encrypted.outcome !== "SUCCESS" ||
      encrypted.operation !== "ENCRYPT_ENVELOPE"
    )
      throw new Error("Unavailable envelope");
    const lookup = keyManagementPortResponseSchema.parse(
      await keys.computeBlindIndex({
        schemaVersion: 1,
        operation: "COMPUTE_BLIND_INDEX",
        purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
        valueBase64: Buffer.from(
          email.normalize("NFC").toLowerCase(),
          "utf8",
        ).toString("base64url"),
      }),
    );
    if (
      lookup.outcome !== "SUCCESS" ||
      lookup.operation !== "COMPUTE_BLIND_INDEX"
    )
      throw new Error("Unavailable lookup");
    return {
      emailCiphertext: encrypted.value.ciphertext,
      encryptedDataKey: encrypted.value.encryptedDataKey,
      encryptionKeyVersion: encrypted.value.keyVersion,
      emailLookupHmac: Buffer.from(
        lookup.value.digestBase64,
        "base64url",
      ).toString("hex"),
      lookupKeyVersion: lookup.value.keyVersion,
    };
  } catch {
    throw new Error("Checkout contact encryption unavailable");
  }
}
