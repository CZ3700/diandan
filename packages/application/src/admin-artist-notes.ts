import { TextDecoder } from "node:util";
import {
  adminArtistNoteEnvelopeSchema,
  adminArtistNoteFailureSchema,
  adminArtistNotePlaintextSchema,
  adminArtistNoteRequestSchema,
  adminArtistNoteResponseSchema,
  adminArtistNoteSnapshotSchema,
  adminOrdersAccessSchema,
  adminOrdersPrivateConfirmationSchema,
  keyManagementPortResponseSchema,
  type AdminArtistNoteContent,
  type AdminArtistNoteEnvelope,
  type AdminArtistNoteFailure,
  type AdminArtistNoteRequest,
  type AdminArtistNoteResponse,
  type AdminArtistNoteSnapshot,
  type AdminArtistNoteStoreRequest,
  type AdminOrdersAccess,
} from "@fan-support/contracts";
import type {
  AdminArtistNoteTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";

/**
 * ADR-022 / L3-13: private artist notes. The store keeps ciphertext; this layer encrypts a save only after
 * the reader is known to qualify, and decrypts a read only after its audit has committed.
 */
export type AdminArtistNoteDependencies = Readonly<{
  transactions: AdminArtistNoteTransactionManager;
  keys: KeyManagementPort;
  tokenPepper: string;
}>;
export type AdminArtistNoteUseCases = Readonly<{
  execute(input: unknown): Promise<AdminArtistNoteResponse>;
}>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue;
const failure = (
  code: AdminArtistNoteFailure["code"],
): AdminArtistNoteFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });

function access(
  request: AdminArtistNoteRequest,
  tokenPepper: string,
): AdminOrdersAccess {
  return adminOrdersAccessSchema.parse({
    schemaVersion: 1,
    requestId: request.requestId,
    correlationId: request.requestId,
    sessionTokenDigest: digestAdminContentToken({
      tokenPepper,
      purpose: "admin-session",
      token: request.sessionToken,
    }),
    csrfTokenDigest: digestAdminContentToken({
      tokenPepper,
      purpose: "admin-csrf",
      token: request.csrfToken,
    }),
  });
}

/** One envelope for the four fields, bound to the new version's id. */
async function encrypt(
  keys: KeyManagementPort,
  noteId: string,
  content: AdminArtistNoteContent,
): Promise<AdminArtistNoteEnvelope> {
  const bytes = Buffer.from(
    JSON.stringify(
      adminArtistNotePlaintextSchema.parse({ schemaVersion: 1, ...content }),
    ),
    "utf8",
  );
  try {
    const response = keyManagementPortResponseSchema.parse(
      await keys.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "ARTIST_PRIVATE_NOTE",
        subjectId: noteId,
        plaintextBase64: bytes.toString("base64url"),
      }),
    );
    if (
      response.outcome !== "SUCCESS" ||
      response.operation !== "ENCRYPT_ENVELOPE"
    )
      throw new Error("Private content unavailable");
    return adminArtistNoteEnvelopeSchema.parse(response.value);
  } finally {
    bytes.fill(0);
  }
}

async function decrypt(
  keys: KeyManagementPort,
  snapshot: AdminArtistNoteSnapshot,
): Promise<AdminArtistNoteContent> {
  const response = keyManagementPortResponseSchema.parse(
    await keys.decryptEnvelope({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      purpose: "ARTIST_PRIVATE_NOTE",
      subjectId: snapshot.note.noteId,
      ...snapshot.envelope,
    }),
  );
  if (
    response.outcome !== "SUCCESS" ||
    response.operation !== "DECRYPT_ENVELOPE"
  )
    throw new Error("Private content unavailable");
  const bytes = Buffer.from(response.value.plaintextBase64, "base64url");
  try {
    const plaintext = adminArtistNotePlaintextSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return {
      realName: plaintext.realName,
      contact: plaintext.contact,
      identity: plaintext.identity,
      other: plaintext.other,
    };
  } finally {
    bytes.fill(0);
  }
}

async function read(
  dependencies: AdminArtistNoteDependencies,
  input: AdminArtistNoteStoreRequest,
): Promise<AdminArtistNoteResponse> {
  const command = input.command;
  if (command.action !== "READ") return failure("INVALID_COMMAND");
  const raw = await dependencies.transactions.runInAdminArtistNoteTransaction(
    async ({ adminArtistNotes }) =>
      json(await adminArtistNotes.prepareRead(input)),
  );
  const denied = adminArtistNoteFailureSchema.safeParse(raw);
  if (denied.success) return denied.data;
  const snapshot = adminArtistNoteSnapshotSchema.parse(raw);
  if (
    snapshot.artistId !== command.artistId ||
    snapshot.note.noteId !== command.noteId
  )
    return failure("TEMPORARY_UNAVAILABLE");
  const content = await decrypt(dependencies.keys, snapshot);
  const confirmed =
    await dependencies.transactions.runInAdminArtistNoteTransaction(
      async ({ adminArtistNotes }) =>
        json(
          await adminArtistNotes.confirmRead({
            schemaVersion: 1,
            access: input.access,
            accessId: snapshot.accessId,
          }),
        ),
    );
  const revoked = adminArtistNoteFailureSchema.safeParse(confirmed);
  if (revoked.success) return revoked.data;
  if (
    adminOrdersPrivateConfirmationSchema.parse(confirmed).accessId !==
    snapshot.accessId
  )
    return failure("TEMPORARY_UNAVAILABLE");
  return adminArtistNoteResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "NOTE",
    artistId: snapshot.artistId,
    note: snapshot.note,
    accessId: snapshot.accessId,
    expiresAt: snapshot.expiresAt,
    content,
  });
}

async function save(
  dependencies: AdminArtistNoteDependencies,
  request: AdminArtistNoteRequest,
  stored: AdminOrdersAccess,
): Promise<AdminArtistNoteResponse> {
  const command = request.command;
  if (command.action !== "SAVE") return failure("INVALID_COMMAND");
  const run = (storeRequest: AdminArtistNoteStoreRequest) =>
    dependencies.transactions.runInAdminArtistNoteTransaction(
      async ({ adminArtistNotes }) =>
        json(await adminArtistNotes.execute(storeRequest)),
    );
  // Nothing is encrypted for a reader who could not save it; the store checks everything again.
  const context = adminArtistNoteResponseSchema.parse(
    await run({
      schemaVersion: 1,
      access: stored,
      command: {
        schemaVersion: 1,
        action: "CONTEXT",
        artistId: command.artistId,
      },
    }),
  );
  if (context.outcome === "FAILURE") return context;
  if (context.kind !== "CONTEXT") return failure("TEMPORARY_UNAVAILABLE");
  if (context.gate !== "READY") return failure("SECOND_FACTOR_REQUIRED");
  const { content, ...rest } = command;
  const response = adminArtistNoteResponseSchema.parse(
    await run({
      schemaVersion: 1,
      access: stored,
      command: {
        ...rest,
        envelope: await encrypt(dependencies.keys, command.noteId, content),
      },
    }),
  );
  return response.outcome === "FAILURE" || response.kind === "SAVED"
    ? response
    : failure("TEMPORARY_UNAVAILABLE");
}

export function createAdminArtistNoteUseCases(
  dependencies: AdminArtistNoteDependencies,
): AdminArtistNoteUseCases {
  if (
    typeof dependencies?.transactions?.runInAdminArtistNoteTransaction !==
      "function" ||
    typeof dependencies.keys?.encryptEnvelope !== "function" ||
    typeof dependencies.keys?.decryptEnvelope !== "function"
  )
    throw new TypeError("Invalid admin artist note configuration");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown) {
      const parsed = adminArtistNoteRequestSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      try {
        const stored = access(parsed.data, dependencies.tokenPepper);
        const command = parsed.data.command;
        if (command.action === "SAVE")
          return await save(dependencies, parsed.data, stored);
        const storeRequest: AdminArtistNoteStoreRequest = {
          schemaVersion: 1,
          access: stored,
          command,
        };
        if (command.action === "READ")
          return await read(dependencies, storeRequest);
        const response = adminArtistNoteResponseSchema.parse(
          await dependencies.transactions.runInAdminArtistNoteTransaction(
            async ({ adminArtistNotes }) =>
              json(await adminArtistNotes.execute(storeRequest)),
          ),
        );
        return response.outcome === "FAILURE" || response.kind === "CONTEXT"
          ? response
          : failure("TEMPORARY_UNAVAILABLE");
      } catch {
        return failure("TEMPORARY_UNAVAILABLE");
      }
    },
  });
}
