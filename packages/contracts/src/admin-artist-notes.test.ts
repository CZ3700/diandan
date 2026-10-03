import { expect, test } from "vitest";
import {
  ADMIN_ARTIST_NOTE_LIMITS,
  adminArtistNoteContentSchema,
  adminArtistNoteRequestSchema,
  adminArtistNoteResponseSchema,
} from "./admin-artist-notes.js";
import {
  adminArtistNoteSnapshotSchema,
  adminArtistNoteStoreRequestSchema,
} from "./admin-artist-notes-persistence.js";
import {
  adminArtistNoteDecryptCommandSchema,
  adminArtistNoteEncryptCommandSchema,
} from "./admin-artist-note-key.js";
import { envelopeEncryptionPurposeSchema } from "./key-management-port-contracts.js";

const artistId = "00000000-0000-4000-8000-000000000001";
const noteId = "00000000-0000-4000-8000-000000000002";
const token = `${"A".repeat(42)}A`;
const blank = { realName: "", contact: "", identity: "", other: "" };
const request = (command: Record<string, unknown>) => ({
  schemaVersion: 1,
  requestId: "00000000-0000-4000-8000-000000000003",
  sessionToken: token,
  csrfToken: token,
  command: { schemaVersion: 1, ...command },
});

test("the four fields allow blanks, line breaks and every script, and refuse other control characters", () => {
  expect(adminArtistNoteContentSchema.safeParse(blank).success).toBe(true);
  expect(
    adminArtistNoteContentSchema.safeParse({
      realName: "김민지 / 金敏智",
      contact: "+66 81 234 5678\nLINE: minji\tIG: @minji",
      identity: "Passport · M12345678",
      other: "ข้อมูลติดต่อผ่านผู้จัดการ 🌸",
    }).success,
  ).toBe(true);
  for (const bad of ["\u0000", "\r", "\u001b[31m", "\u007f", "\ud800"])
    expect(
      adminArtistNoteContentSchema.safeParse({ ...blank, other: `a${bad}b` })
        .success,
    ).toBe(false);
  expect(
    adminArtistNoteContentSchema.safeParse({ ...blank, contact: undefined })
      .success,
  ).toBe(false);
  expect(
    adminArtistNoteContentSchema.safeParse({ ...blank, photo: "x" }).success,
  ).toBe(false);
});

test("limits count codepoints, so emoji and CJK get the full allowance", () => {
  for (const [field, limit] of Object.entries(ADMIN_ARTIST_NOTE_LIMITS)) {
    const full = "🌸".repeat(limit);
    expect(
      adminArtistNoteContentSchema.safeParse({ ...blank, [field]: full })
        .success,
    ).toBe(true);
    expect(
      adminArtistNoteContentSchema.safeParse({ ...blank, [field]: `${full}a` })
        .success,
    ).toBe(false);
  }
});

test("requests name the artist and never carry authority or plaintext beyond a save", () => {
  expect(
    adminArtistNoteRequestSchema.safeParse(
      request({ action: "CONTEXT", artistId }),
    ).success,
  ).toBe(true);
  expect(
    adminArtistNoteRequestSchema.safeParse(
      request({ action: "READ", artistId, noteId }),
    ).success,
  ).toBe(true);
  expect(
    adminArtistNoteRequestSchema.safeParse(
      request({
        action: "SAVE",
        artistId,
        noteId,
        expectedVersion: 0,
        content: blank,
      }),
    ).success,
  ).toBe(true);
  for (const extra of [
    { actorId: artistId },
    { permissions: ["idols.private"] },
    { secondFactor: "TOTP" },
  ])
    expect(
      adminArtistNoteRequestSchema.safeParse(
        request({ action: "CONTEXT", artistId, ...extra }),
      ).success,
    ).toBe(false);
  expect(
    adminArtistNoteRequestSchema.safeParse(
      request({ action: "READ", artistId, noteId, content: blank }),
    ).success,
  ).toBe(false);
  expect(
    adminArtistNoteRequestSchema.safeParse(
      request({
        action: "SAVE",
        artistId,
        noteId,
        expectedVersion: -1,
        content: blank,
      }),
    ).success,
  ).toBe(false);
});

test("the context lists versions without content, and only a read carries plaintext", () => {
  const version = {
    noteId,
    version: 3,
    savedAt: "2026-10-01T02:00:00.000Z",
    savedBy: "Studio owner",
  };
  const context = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "CONTEXT",
    artistId,
    gate: "READY",
    versions: [version],
  };
  expect(adminArtistNoteResponseSchema.safeParse(context).success).toBe(true);
  expect(
    adminArtistNoteResponseSchema.safeParse({
      ...context,
      versions: [{ ...version, content: blank }],
    }).success,
  ).toBe(false);
  expect(
    adminArtistNoteResponseSchema.safeParse({ ...context, gate: "MAYBE" })
      .success,
  ).toBe(false);
  expect(
    adminArtistNoteResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "SAVED",
      artistId,
      note: version,
      content: blank,
    }).success,
  ).toBe(false);
  expect(
    adminArtistNoteResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "SECOND_FACTOR_REQUIRED",
    }).success,
  ).toBe(true);
});

test("the store receives an envelope instead of the content, and the snapshot carries only ciphertext", () => {
  const envelope = {
    ciphertext: `enc:v1:${"A".repeat(43)}`,
    encryptedDataKey: `enc:v1:${"B".repeat(43)}`,
    keyVersion: "local-1",
    algorithm: "AES_256_GCM",
  };
  const access = {
    schemaVersion: 1,
    requestId: "00000000-0000-4000-8000-000000000003",
    correlationId: "00000000-0000-4000-8000-000000000003",
    sessionTokenDigest: "a".repeat(64),
    csrfTokenDigest: "b".repeat(64),
  };
  const save = {
    schemaVersion: 1,
    action: "SAVE",
    artistId,
    noteId,
    expectedVersion: 2,
  };
  expect(
    adminArtistNoteStoreRequestSchema.safeParse({
      schemaVersion: 1,
      access,
      command: { ...save, envelope },
    }).success,
  ).toBe(true);
  expect(
    adminArtistNoteStoreRequestSchema.safeParse({
      schemaVersion: 1,
      access,
      command: { ...save, envelope, content: blank },
    }).success,
  ).toBe(false);
  expect(
    adminArtistNoteSnapshotSchema.safeParse({
      schemaVersion: 1,
      kind: "NOTE_SNAPSHOT",
      accessId: noteId,
      artistId,
      expiresAt: "2026-10-01T02:05:00.000Z",
      note: {
        noteId,
        version: 1,
        savedAt: "2026-10-01T02:00:00.000Z",
        savedBy: "Studio owner",
      },
      envelope,
      content: blank,
    }).success,
  ).toBe(false);
});

test("the note purpose is its own extension and leaves the frozen v1 purposes alone", () => {
  expect(envelopeEncryptionPurposeSchema.options).not.toContain(
    "ARTIST_PRIVATE_NOTE",
  );
  expect(
    adminArtistNoteEncryptCommandSchema.safeParse({
      schemaVersion: 1,
      operation: "ENCRYPT_ENVELOPE",
      purpose: "ARTIST_PRIVATE_NOTE",
      subjectId: noteId,
      plaintextBase64: "e30",
    }).success,
  ).toBe(true);
  expect(
    adminArtistNoteDecryptCommandSchema.safeParse({
      schemaVersion: 1,
      operation: "DECRYPT_ENVELOPE",
      purpose: "ADMIN_ORDER_NOTE",
      subjectId: noteId,
      ciphertext: `enc:v1:${"A".repeat(43)}`,
      encryptedDataKey: `enc:v1:${"B".repeat(43)}`,
      keyVersion: "local-1",
      algorithm: "AES_256_GCM",
    }).success,
  ).toBe(false);
});
