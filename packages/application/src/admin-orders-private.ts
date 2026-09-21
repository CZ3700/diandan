import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  adminOrdersNoteEnvelopeSchema,
  adminOrdersPrivateResponseSchema,
  cartEditorContentSchema,
  keyManagementPortResponseSchema,
  type AdminOrdersPrivateSnapshot,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";

function decode(value: string) {
  const bytes = Buffer.from(value, "base64url");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** Called only after the private access audit commits, always outside SQL. */
export async function decryptAdminOrdersPrivate(
  keys: KeyManagementPort,
  snapshot: AdminOrdersPrivateSnapshot,
) {
  if (snapshot.kind === "MESSAGE") {
    const message = snapshot;
    async function field(
      ciphertext: typeof message.fanMessageCiphertext,
      purpose: "SUPPORT_INTENT_MESSAGE" | "SUPPORT_INTENT_DISPLAY_NAME",
    ) {
      if (ciphertext === null) return undefined;
      const response = keyManagementPortResponseSchema.parse(
        await keys.decryptEnvelope({
          schemaVersion: 1,
          operation: "DECRYPT_ENVELOPE",
          purpose,
          subjectId: message.supportIntentId,
          ciphertext,
          encryptedDataKey: message.encryptedDataKey,
          keyVersion: message.keyVersion,
          algorithm: "AES_256_GCM",
        }),
      );
      if (
        response.outcome !== "SUCCESS" ||
        response.operation !== "DECRYPT_ENVELOPE"
      )
        throw new Error("Private content unavailable");
      return decode(response.value.plaintextBase64);
    }
    const fanMessage = await field(
      snapshot.fanMessageCiphertext,
      "SUPPORT_INTENT_MESSAGE",
    );
    const displayName =
      snapshot.displayMode === "nickname"
        ? await field(
            snapshot.displayNameCiphertext,
            "SUPPORT_INTENT_DISPLAY_NAME",
          )
        : undefined;
    const content = cartEditorContentSchema.parse({
      displayMode: snapshot.displayMode,
      fanMessageLocale: snapshot.fanMessageLocale,
      ...(fanMessage === undefined ? {} : { fanMessage }),
      ...(displayName === undefined ? {} : { displayName }),
    });
    return adminOrdersPrivateResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MESSAGE",
      orderId: snapshot.orderId,
      itemId: snapshot.itemId,
      intentVersion: snapshot.intentVersion,
      accessId: snapshot.accessId,
      expiresAt: snapshot.expiresAt,
      reviewLocale: snapshot.reviewLocale,
      content,
    });
  }
  const notes = [];
  for (const note of snapshot.notes) {
    if (note.noteId !== note.envelope.noteId)
      throw new Error("Private content unavailable");
    const { noteId, ...envelope } = note.envelope;
    const response = keyManagementPortResponseSchema.parse(
      await keys.decryptEnvelope({
        schemaVersion: 1,
        operation: "DECRYPT_ENVELOPE",
        purpose: "ADMIN_ORDER_NOTE",
        subjectId: noteId,
        ...envelope,
      }),
    );
    if (
      response.outcome !== "SUCCESS" ||
      response.operation !== "DECRYPT_ENVELOPE"
    )
      throw new Error("Private content unavailable");
    notes.push({
      noteId,
      actorId: note.actorId,
      createdAt: note.createdAt,
      text: decode(response.value.plaintextBase64),
    });
  }
  return adminOrdersPrivateResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "NOTES",
    orderId: snapshot.orderId,
    notes,
  });
}

export async function encryptAdminOrderNote(
  keys: KeyManagementPort,
  note: string,
) {
  const noteId = randomUUID(),
    bytes = Buffer.from(note, "utf8");
  try {
    const response = keyManagementPortResponseSchema.parse(
      await keys.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "ADMIN_ORDER_NOTE",
        subjectId: noteId,
        plaintextBase64: bytes.toString("base64url"),
      }),
    );
    if (
      response.outcome !== "SUCCESS" ||
      response.operation !== "ENCRYPT_ENVELOPE"
    )
      throw new Error("Private content unavailable");
    return adminOrdersNoteEnvelopeSchema.parse({ noteId, ...response.value });
  } finally {
    bytes.fill(0);
  }
}
