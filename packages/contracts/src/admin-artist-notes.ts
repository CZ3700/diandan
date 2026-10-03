import { z } from "zod";
import { adminOpaqueTokenSchema } from "./admin-content.js";
import { contentTimestampSchema } from "./content-lifecycle.js";

/**
 * ADR-022 / L3-13: private notes about an artist. Only accounts with idols.private may read or save them, and
 * only on a sign-in that used a TOTP code or a recovery code while the account still has TOTP. Every save is a
 * new encrypted version; every read is audited before decryption.
 */
export const ADMIN_ARTIST_NOTE_LIMITS = Object.freeze({
  realName: 200,
  contact: 2000,
  identity: 2000,
  other: 4000,
});
export const ADMIN_ARTIST_NOTE_MAX_VERSIONS = 200;

const uuid = z.uuid();
const version = z.literal(1);
const noteVersion = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

/** Codepoints as PostgreSQL counts them; line breaks and tabs are kept, other control characters are refused. */
const noteText = (limit: number) =>
  z
    .string()
    .max(limit * 2)
    .refine((value) => {
      const characters = Array.from(value);
      return (
        characters.length <= limit &&
        characters.every((character) => {
          const point = character.codePointAt(0)!;
          return (
            (point >= 0x20 || point === 0x09 || point === 0x0a) &&
            point !== 0x7f &&
            (point < 0xd800 || point > 0xdfff)
          );
        })
      );
    });

export const adminArtistNoteFailureSchema = z.strictObject({
  schemaVersion: version,
  outcome: z.literal("FAILURE"),
  code: z.enum([
    "INVALID_COMMAND",
    "UNAUTHENTICATED",
    "CSRF_INVALID",
    "FORBIDDEN",
    "NOT_FOUND",
    "STALE_VERSION",
    "SECOND_FACTOR_REQUIRED",
    "PRIVATE_ACCESS_EXPIRED",
    "TEMPORARY_UNAVAILABLE",
  ]),
});

/** The four fields of one version; an empty string means the field is blank. */
export const adminArtistNoteContentSchema = z.strictObject({
  realName: noteText(ADMIN_ARTIST_NOTE_LIMITS.realName),
  contact: noteText(ADMIN_ARTIST_NOTE_LIMITS.contact),
  identity: noteText(ADMIN_ARTIST_NOTE_LIMITS.identity),
  other: noteText(ADMIN_ARTIST_NOTE_LIMITS.other),
});
/** What is encrypted: the content with its own layout version. */
export const adminArtistNotePlaintextSchema = adminArtistNoteContentSchema
  .extend({ schemaVersion: version })
  .strict();

/**
 * READY: this sign-in may read and save. TOTP_NOT_ENABLED: the account has no TOTP (or signed in without a
 * built-in account). SIGN_IN_WITHOUT_CODE: TOTP is on, but this sign-in did not use a code; sign in again.
 */
export const adminArtistNoteGateSchema = z.enum([
  "READY",
  "TOTP_NOT_ENABLED",
  "SIGN_IN_WITHOUT_CODE",
]);

export const adminArtistNoteVersionSchema = z.strictObject({
  noteId: uuid,
  version: noteVersion,
  savedAt: contentTimestampSchema,
  savedBy: z.string().min(1).max(200),
});

export const adminArtistNoteCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: version,
    action: z.literal("CONTEXT"),
    artistId: uuid,
  }),
  /** Reveals one version; the read is audited first and its access expires within five minutes. */
  z.strictObject({
    schemaVersion: version,
    action: z.literal("READ"),
    artistId: uuid,
    noteId: uuid,
  }),
  /** `noteId` names the new version; resending the same id is answered with the version it already saved. */
  z.strictObject({
    schemaVersion: version,
    action: z.literal("SAVE"),
    artistId: uuid,
    noteId: uuid,
    /** The version the editor started from; 0 when the artist had no notes yet. */
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    content: adminArtistNoteContentSchema,
  }),
]);
export const adminArtistNoteRequestSchema = z.strictObject({
  schemaVersion: version,
  requestId: uuid,
  sessionToken: adminOpaqueTokenSchema,
  csrfToken: adminOpaqueTokenSchema,
  command: adminArtistNoteCommandSchema,
});

const success = { schemaVersion: version, outcome: z.literal("SUCCESS") };
export const adminArtistNoteResponseSchema = z.union([
  adminArtistNoteFailureSchema,
  z.strictObject({
    ...success,
    kind: z.literal("CONTEXT"),
    artistId: uuid,
    gate: adminArtistNoteGateSchema,
    /** Newest first; empty unless the gate is READY. */
    versions: z
      .array(adminArtistNoteVersionSchema)
      .max(ADMIN_ARTIST_NOTE_MAX_VERSIONS),
  }),
  z.strictObject({
    ...success,
    kind: z.literal("NOTE"),
    artistId: uuid,
    note: adminArtistNoteVersionSchema,
    accessId: uuid,
    expiresAt: contentTimestampSchema,
    content: adminArtistNoteContentSchema,
  }),
  z.strictObject({
    ...success,
    kind: z.literal("SAVED"),
    artistId: uuid,
    note: adminArtistNoteVersionSchema,
  }),
]);

export type AdminArtistNoteFailure = z.infer<
  typeof adminArtistNoteFailureSchema
>;
export type AdminArtistNoteContent = z.infer<
  typeof adminArtistNoteContentSchema
>;
export type AdminArtistNoteGate = z.infer<typeof adminArtistNoteGateSchema>;
export type AdminArtistNoteVersion = z.infer<
  typeof adminArtistNoteVersionSchema
>;
export type AdminArtistNoteCommand = z.infer<
  typeof adminArtistNoteCommandSchema
>;
export type AdminArtistNoteRequest = z.infer<
  typeof adminArtistNoteRequestSchema
>;
export type AdminArtistNoteResponse = z.infer<
  typeof adminArtistNoteResponseSchema
>;
