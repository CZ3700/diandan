import {
  adminArtistNoteResponseSchema,
  type AdminArtistNoteContent,
  type AdminArtistNoteResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";

// ADR-022 / L3-13: private artist notes. Authority, the second-factor gate and audits are decided by the API.
export type ArtistNotesContext = Extract<
  AdminArtistNoteResponse,
  { kind: "CONTEXT" }
>;
export type ArtistNote = Extract<AdminArtistNoteResponse, { kind: "NOTE" }>;
export type ArtistNoteSaved = Extract<
  AdminArtistNoteResponse,
  { kind: "SAVED" }
>;

const invalid = () => new AdminClientError("INVALID_RESPONSE");

export function createArtistNotesApi(client: AdminClient) {
  const call = async (
    operation: "context" | "read" | "save",
    command: Record<string, unknown>,
  ) =>
    client.call(
      `artist-notes-${operation}`,
      { schemaVersion: 1, ...command },
      adminArtistNoteResponseSchema,
    );
  return Object.freeze({
    async context(artistId: string): Promise<ArtistNotesContext> {
      const result = await call("context", { artistId });
      if (result.kind !== "CONTEXT" || result.artistId !== artistId)
        throw invalid();
      return result;
    },
    /** Writes an audit on the server before anything is decrypted; call only when the reader opens it. */
    async read(artistId: string, noteId: string): Promise<ArtistNote> {
      const result = await call("read", { artistId, noteId });
      if (
        result.kind !== "NOTE" ||
        result.artistId !== artistId ||
        result.note.noteId !== noteId
      )
        throw invalid();
      return result;
    },
    /** `noteId` names the new version; keep it for retries of the same attempt. */
    async save(
      artistId: string,
      attempt: Readonly<{
        noteId: string;
        expectedVersion: number;
        content: AdminArtistNoteContent;
      }>,
    ): Promise<ArtistNoteSaved> {
      const result = await call("save", { artistId, ...attempt });
      if (
        result.kind !== "SAVED" ||
        result.artistId !== artistId ||
        result.note.noteId !== attempt.noteId
      )
        throw invalid();
      return result;
    },
  });
}
export type ArtistNotesApi = ReturnType<typeof createArtistNotesApi>;
