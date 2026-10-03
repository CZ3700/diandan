import type {
  AdminOrdersConfirmPrivate,
  AdminOrdersFailure,
  AdminOrdersPrivateConfirmation,
  AdminOrdersPrivateSnapshot,
  AdminOrdersProofCompletion,
  AdminOrdersProofRenditionLocation,
  AdminOrdersProofReservation,
  AdminOrdersProofUploadState,
  AdminOrdersResponse,
  AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export interface AdminOrdersRepository {
  execute(request: AdminOrdersStoreRequest): Promise<AdminOrdersResponse>;
  /** The audit and private-access receipt must commit before callers decrypt. */
  preparePrivate(
    request: AdminOrdersStoreRequest,
  ): Promise<AdminOrdersPrivateSnapshot | AdminOrdersFailure>;
  /** Rechecks current authority, privacy, content version and snapshot membership. */
  confirmPrivate(
    command: AdminOrdersConfirmPrivate,
  ): Promise<AdminOrdersPrivateConfirmation | AdminOrdersFailure>;
  /** Commits an audited, receipted source reservation; callers sign the upload grant afterwards. */
  reserveProofUpload(
    request: AdminOrdersStoreRequest,
  ): Promise<AdminOrdersProofReservation | AdminOrdersFailure>;
  /** Reads the caller's own reservation before storage I/O outside the transaction. */
  readProofUpload(
    request: AdminOrdersStoreRequest,
  ): Promise<AdminOrdersProofUploadState | AdminOrdersFailure>;
  /** Re-authorizes and records verified renditions exactly once. */
  completeProofUpload(
    command: AdminOrdersProofCompletion,
  ): Promise<AdminOrdersResponse>;
  /** Locates one active proof rendition for a short-lived private grant. */
  readProofRendition(
    request: AdminOrdersStoreRequest,
  ): Promise<AdminOrdersProofRenditionLocation | AdminOrdersFailure>;
}
export interface AdminOrderResendRepository {
  request(request: AdminOrdersStoreRequest): Promise<AdminOrdersResponse>;
}
export type AdminOrdersRepositories = Readonly<{
  adminOrders: AdminOrdersRepository;
  adminOrderResends: AdminOrderResendRepository;
}>;
export interface AdminOrdersTransactionManager {
  runInAdminOrdersTransaction<Result extends JsonValue>(
    work: (repositories: AdminOrdersRepositories) => Promise<Result>,
  ): Promise<Result>;
}
