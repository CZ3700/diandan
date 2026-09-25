import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import {
  cartEditorContentSchema,
  keyManagementPortResponseSchema,
  type CartEditPrivateSnapshot,
  type CartEditorContent,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import { rejectCartEdit } from "./cart-edit-transaction.js";

/** Called only after the authorized private-access audit has committed. */
export async function decryptCartEditor(
  keys: KeyManagementPort,
  data: CartEditPrivateSnapshot,
): Promise<CartEditorContent> {
  const { privateContent, snapshot } = data;
  async function field(
    ciphertext: CartEditPrivateSnapshot["privateContent"]["fanMessageCiphertext"],
    purpose: "SUPPORT_INTENT_MESSAGE" | "SUPPORT_INTENT_DISPLAY_NAME",
  ) {
    if (ciphertext === null) return undefined;
    const result = keyManagementPortResponseSchema.parse(
      await keys.decryptEnvelope({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        purpose,
        subjectId: snapshot.supportIntentId,
        ciphertext,
        encryptedDataKey: privateContent.encryptedDataKey,
        keyVersion: privateContent.encryptionKeyVersion,
        algorithm: "AES_256_GCM",
      }),
    );
    if (result.outcome !== "SUCCESS" || result.operation !== "DECRYPT_ENVELOPE")
      return rejectCartEdit("TEMPORARY_UNAVAILABLE");
    const bytes = Buffer.from(result.value.plaintextBase64, "base64url");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      bytes.fill(0);
    }
  }
  const fanMessage = await field(
    privateContent.fanMessageCiphertext,
    "SUPPORT_INTENT_MESSAGE",
  );
  const displayName =
    snapshot.item.displayMode === "nickname"
      ? await field(
          privateContent.displayNameCiphertext,
          "SUPPORT_INTENT_DISPLAY_NAME",
        )
      : undefined;
  return cartEditorContentSchema.parse({
    displayMode: snapshot.item.displayMode,
    fanMessageLocale: snapshot.fanMessageLocale,
    ...(fanMessage === undefined ? {} : { fanMessage }),
    ...(displayName === undefined ? {} : { displayName }),
  });
}
