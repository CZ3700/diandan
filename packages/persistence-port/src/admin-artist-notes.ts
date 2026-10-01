import type {
  AdminArtistNoteFailure,
  AdminArtistNoteResponse,
  AdminArtistNoteSnapshot,
  AdminArtistNoteStoreRequest,
  AdminOrdersConfirmPrivate,
  AdminOrdersPrivateConfirmation,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

/** ADR-022 / L3-13: private artist notes. The store holds ciphertext only; decryption happens between steps. */
export interface AdminArtistNoteRepository {
  /** CONTEXT and SAVE; a save commits its audit with the new version. */
  execute(
    request: AdminArtistNoteStoreRequest,
  ): Promise<AdminArtistNoteResponse>;
  /** READ, first step: the audit and access receipt must commit before callers decrypt. */
  prepareRead(
    request: AdminArtistNoteStoreRequest,
  ): Promise<AdminArtistNoteSnapshot | AdminArtistNoteFailure>;
  /** READ, second step: the same session, a live receipt and the same authority as before. */
  confirmRead(
    command: AdminOrdersConfirmPrivate,
  ): Promise<AdminOrdersPrivateConfirmation | AdminArtistNoteFailure>;
}
export type AdminArtistNoteRepositories = Readonly<{
  adminArtistNotes: AdminArtistNoteRepository;
}>;
export interface AdminArtistNoteTransactionManager {
  runInAdminArtistNoteTransaction<Result extends JsonValue>(
    work: (repositories: AdminArtistNoteRepositories) => Promise<Result>,
  ): Promise<Result>;
}
