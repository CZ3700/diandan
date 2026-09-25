import type {
  AdminAuthorizationResponse,
  PublicationAuthorizationCommand,
  PublicationPreflightCommand,
  PublicationRuntimeContextResponse,
  PublicationRuntimeWriteCommand,
  PublicationRuntimeResponse,
  PublicationRuntimeReceiptReadCommand,
  PublicationStatusCommand,
  PublicationStatusResponse,
  PublicationRuntimeRetryWriteCommand,
  PublicationPurgeClaimCommand,
  PublicationPurgeClaimResponse,
  PublicationPurgeRecordCommand,
  PublicationPurgeRecordResponse,
} from "@fan-support/contracts";
import type { IdempotencyRepository, JsonValue } from "./index.js";

export interface PublicationAuthorizationRepository {
  authorize(
    command: PublicationAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export interface PublicationRuntimeRepository {
  load(
    command: PublicationPreflightCommand,
  ): Promise<PublicationRuntimeContextResponse>;
  write(
    command: PublicationRuntimeWriteCommand,
  ): Promise<PublicationRuntimeResponse>;
  readReceipt(
    command: PublicationRuntimeReceiptReadCommand,
  ): Promise<PublicationRuntimeResponse>;
  status(command: PublicationStatusCommand): Promise<PublicationStatusResponse>;
  retry(
    command: PublicationRuntimeRetryWriteCommand,
  ): Promise<PublicationRuntimeResponse>;
}
export type PublicationRuntimeRepositories = Readonly<{
  authorization: PublicationAuthorizationRepository;
  publicationRuntime: PublicationRuntimeRepository;
  idempotency: IdempotencyRepository;
}>;
export interface PublicationRuntimeTransactionManager {
  runInPublicationRuntimeTransaction<Result extends JsonValue>(
    work: (repositories: PublicationRuntimeRepositories) => Promise<Result>,
  ): Promise<Result>;
}
/** Claims/records are short database transactions; provider I/O never holds their locks. */
export interface PublicationPurgeRepository {
  claim(
    command: PublicationPurgeClaimCommand,
  ): Promise<PublicationPurgeClaimResponse>;
  record(
    command: PublicationPurgeRecordCommand,
  ): Promise<PublicationPurgeRecordResponse>;
}
export type PublicationPurgeRepositories = Readonly<{
  publicationPurge: PublicationPurgeRepository;
}>;
export interface PublicationPurgeTransactionManager {
  runInPublicationPurgeTransaction<Result extends JsonValue>(
    work: (repositories: PublicationPurgeRepositories) => Promise<Result>,
  ): Promise<Result>;
}
