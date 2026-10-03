import { expect, test, vi } from "vitest";
import type { AdminArtistNoteRepositories } from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import { createAdminArtistNoteUseCases } from "./index.js";

const artistId = "00000000-0000-4000-8000-000000000001";
const noteId = "00000000-0000-4000-8000-000000000002";
const accessId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
const sessionToken = "a".repeat(42) + "A",
  csrfToken = "b".repeat(42) + "A",
  tokenPepper = "a".repeat(64);
const request = (command: Record<string, unknown>) => ({
  schemaVersion: 1,
  requestId,
  sessionToken,
  csrfToken,
  command: { schemaVersion: 1, artistId, ...command },
});
const content = {
  realName: "Kim Minji",
  contact: "+66 81 234 5678",
  identity: "Passport M12345678",
  other: "Prefers LINE",
};
const version = {
  noteId,
  version: 2,
  savedAt: "2026-10-01T02:00:00.000Z",
  savedBy: "Studio owner",
};
const envelope = {
  ciphertext: `enc:v1:${"C".repeat(43)}`,
  encryptedDataKey: `enc:v1:${"K".repeat(43)}`,
  keyVersion: "test-1",
  algorithm: "AES_256_GCM",
};
const context = (gate: string) => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  artistId,
  gate,
  versions: gate === "READY" ? [{ ...version, version: 1 }] : [],
});
const snapshot = {
  schemaVersion: 1,
  kind: "NOTE_SNAPSHOT",
  accessId,
  artistId,
  expiresAt: "2026-10-01T02:05:00.000Z",
  note: version,
  envelope,
};

function setup(gate = "READY") {
  let inside = false;
  let sealed: string | null = null;
  const execute = vi.fn(async (input: { command: { action: string } }) =>
    input.command.action === "CONTEXT"
      ? context(gate)
      : {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "SAVED",
          artistId,
          note: version,
        },
  );
  const prepareRead = vi.fn(async (): Promise<unknown> => snapshot);
  const confirmRead = vi.fn(async (): Promise<unknown> => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PRIVATE_CONFIRMED",
    accessId,
  }));
  const repositories = {
    adminArtistNotes: { execute, prepareRead, confirmRead },
  } as unknown as AdminArtistNoteRepositories;
  const run = vi.fn(
    async (
      work: (repositories: AdminArtistNoteRepositories) => Promise<unknown>,
    ) => {
      expect(inside).toBe(false);
      inside = true;
      try {
        return await work(repositories);
      } finally {
        inside = false;
      }
    },
  );
  const encryptEnvelope = vi.fn(
    async (command: { plaintextBase64: string }): Promise<unknown> => {
      expect(inside, "encryption happens between transactions").toBe(false);
      sealed = command.plaintextBase64;
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        operation: "ENCRYPT_ENVELOPE",
        value: envelope,
      };
    },
  );
  let plaintext = Buffer.from(
    JSON.stringify({ schemaVersion: 1, ...content }),
  ).toString("base64url");
  const decryptEnvelope = vi.fn(async (): Promise<unknown> => {
    expect(inside, "decryption happens between transactions").toBe(false);
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "DECRYPT_ENVELOPE",
      value: { plaintextBase64: plaintext },
    };
  });
  const useCases = createAdminArtistNoteUseCases({
    tokenPepper,
    transactions: { runInAdminArtistNoteTransaction: run } as never,
    keys: { encryptEnvelope, decryptEnvelope } as unknown as KeyManagementPort,
  });
  return {
    useCases,
    execute,
    prepareRead,
    confirmRead,
    encryptEnvelope,
    decryptEnvelope,
    sealed: () => sealed,
    setPlaintext(value: unknown) {
      plaintext = Buffer.from(JSON.stringify(value)).toString("base64url");
    },
  };
}

test("a save checks the reader first, then encrypts the four fields bound to the new version", async () => {
  const s = setup();
  const response = await s.useCases.execute(
    request({ action: "SAVE", noteId, expectedVersion: 1, content }),
  );
  expect(response).toMatchObject({ outcome: "SUCCESS", kind: "SAVED" });
  expect(s.execute.mock.calls[0]?.[0]).toMatchObject({
    command: { action: "CONTEXT", artistId },
  });
  expect(s.encryptEnvelope).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "ARTIST_PRIVATE_NOTE",
      subjectId: noteId,
    }),
  );
  expect(
    JSON.parse(Buffer.from(s.sealed()!, "base64url").toString("utf8")),
  ).toEqual({ schemaVersion: 1, ...content });
  const stored = s.execute.mock.calls[1]?.[0];
  expect(stored).toMatchObject({
    command: { action: "SAVE", noteId, expectedVersion: 1, envelope },
  });
  expect(JSON.stringify(stored)).not.toContain("Minji");
  expect(JSON.stringify(stored)).not.toContain(sessionToken);
});

test.each(["TOTP_NOT_ENABLED", "SIGN_IN_WITHOUT_CODE"])(
  "a save on a %s sign-in is refused before anything is encrypted",
  async (gate) => {
    const s = setup(gate);
    expect(
      await s.useCases.execute(
        request({ action: "SAVE", noteId, expectedVersion: 0, content }),
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "SECOND_FACTOR_REQUIRED",
    });
    expect(s.encryptEnvelope).not.toHaveBeenCalled();
    expect(s.execute).toHaveBeenCalledTimes(1);
  },
);

test("a reader without idols.private gets the store's refusal and nothing is encrypted", async () => {
  const s = setup();
  s.execute.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "FORBIDDEN",
  } as never);
  expect(
    await s.useCases.execute(
      request({ action: "SAVE", noteId, expectedVersion: 0, content }),
    ),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(s.encryptEnvelope).not.toHaveBeenCalled();
});

test("a read is audited first, decrypted outside the transaction and confirmed before it is returned", async () => {
  const s = setup();
  const response = await s.useCases.execute(
    request({ action: "READ", noteId }),
  );
  expect(response).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "NOTE",
    artistId,
    note: version,
    accessId,
    expiresAt: snapshot.expiresAt,
    content,
  });
  expect(s.decryptEnvelope).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "ARTIST_PRIVATE_NOTE",
      subjectId: noteId,
    }),
  );
  expect(s.prepareRead.mock.invocationCallOrder[0]).toBeLessThan(
    s.decryptEnvelope.mock.invocationCallOrder[0]!,
  );
  expect(s.decryptEnvelope.mock.invocationCallOrder[0]).toBeLessThan(
    s.confirmRead.mock.invocationCallOrder[0]!,
  );
  expect(s.confirmRead).toHaveBeenCalledWith(
    expect.objectContaining({ accessId }),
  );
});

test("a read whose authority lapses before confirmation returns no plaintext", async () => {
  const s = setup();
  s.confirmRead.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "SECOND_FACTOR_REQUIRED",
  });
  const response = await s.useCases.execute(
    request({ action: "READ", noteId }),
  );
  expect(response).toMatchObject({ code: "SECOND_FACTOR_REQUIRED" });
  expect(JSON.stringify(response)).not.toContain("Minji");
});

test("a snapshot for another note or artist is never decrypted", async () => {
  const s = setup();
  s.prepareRead.mockResolvedValueOnce({
    ...snapshot,
    note: { ...version, noteId: accessId },
  });
  expect(
    await s.useCases.execute(request({ action: "READ", noteId })),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
  expect(s.decryptEnvelope).not.toHaveBeenCalled();
});

test("decrypted text in an unknown layout is not shown", async () => {
  const s = setup();
  s.setPlaintext({ schemaVersion: 1, ...content, passportScan: "data:..." });
  expect(
    await s.useCases.execute(request({ action: "READ", noteId })),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
  expect(s.confirmRead).not.toHaveBeenCalled();
});

test("malformed requests and store faults are typed failures", async () => {
  const s = setup();
  expect(
    await s.useCases.execute({
      ...request({ action: "CONTEXT" }),
      actorId: artistId,
    }),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  s.execute.mockRejectedValueOnce(new Error("connection reset"));
  expect(
    await s.useCases.execute(request({ action: "CONTEXT" })),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
  s.execute.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "SAVED",
    artistId,
    note: version,
  });
  expect(
    await s.useCases.execute(request({ action: "CONTEXT" })),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
});

test("configuration without a transaction manager or keys is refused", () => {
  expect(() =>
    createAdminArtistNoteUseCases({
      tokenPepper,
      transactions: {} as never,
      keys: {} as never,
    }),
  ).toThrow(TypeError);
});
