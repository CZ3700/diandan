import type {
  AdminMutationResponse,
  TranslationExportCreateCommand,
  TranslationExportReadCommand,
  TranslationImportRecordCommand,
  TranslationExportReceiptResponse,
} from "@fan-support/contracts";
import type { JsonValue, IdempotencyRepository } from "./index.js";
import type { AdminAuthorizationRepository } from "./admin-content.js";
import type { ContentAuthoringRepository } from "./content-authoring.js";
export interface TranslationTransferRepository {
  createExport(
    command: TranslationExportCreateCommand,
  ): Promise<TranslationExportReceiptResponse>;
  readExport(
    command: TranslationExportReadCommand,
  ): Promise<TranslationExportReceiptResponse>;
  recordImport(
    command: TranslationImportRecordCommand,
  ): Promise<AdminMutationResponse>;
}
export type TranslationTransferRepositories = Readonly<{
  authorization: AdminAuthorizationRepository;
  contentAuthoring: ContentAuthoringRepository;
  translationTransfers: TranslationTransferRepository;
  idempotency: IdempotencyRepository;
}>;
export interface TranslationTransferTransactionManager {
  runInTranslationTransferTransaction<Result extends JsonValue>(
    work: (repositories: TranslationTransferRepositories) => Promise<Result>,
  ): Promise<Result>;
}
