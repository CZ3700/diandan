import type {
  AdminLedgerFailure,
  AdminLedgerResponse,
  AdminLedgerStoreRequest,
  AdminOrdersConfirmPrivate,
  AdminOrdersPrivateConfirmation,
  AdminOrdersPrivateSnapshot,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

/** ADR-022 / L3-12: read-only artist ledger; the only writes are audit receipts. */
export interface AdminLedgerRepository {
  /** CONTEXT, OVERVIEW, ARTIST and EXPORT; an export commits its audit and receipt with the data read. */
  execute(request: AdminLedgerStoreRequest): Promise<AdminLedgerResponse>;
  /** The audit and private-access receipt must commit before callers decrypt. */
  prepareMessage(
    request: AdminLedgerStoreRequest,
  ): Promise<AdminOrdersPrivateSnapshot | AdminLedgerFailure>;
  /** Rechecks the session, the receipt, the content version and the reader's authority. */
  confirmMessage(
    command: AdminOrdersConfirmPrivate,
  ): Promise<AdminOrdersPrivateConfirmation | AdminLedgerFailure>;
}
export type AdminLedgerRepositories = Readonly<{
  adminLedger: AdminLedgerRepository;
}>;
export interface AdminLedgerTransactionManager {
  runInAdminLedgerTransaction<Result extends JsonValue>(
    work: (repositories: AdminLedgerRepositories) => Promise<Result>,
  ): Promise<Result>;
}
