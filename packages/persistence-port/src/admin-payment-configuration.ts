import type {
  AdminPaymentConfigurationStoreRequest,
  AdminPaymentConfigurationResponse,
  PaymentConfigurationPublishedProjection,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
/** One transaction owns current authorization, immutable drafts, approval, publication and receipts. */
export interface AdminPaymentConfigurationRepository {
  execute(
    request: AdminPaymentConfigurationStoreRequest,
  ): Promise<AdminPaymentConfigurationResponse>;
  readPublished(): Promise<PaymentConfigurationPublishedProjection | null>;
}
export interface AdminPaymentConfigurationTransactionManager {
  runInAdminPaymentConfigurationTransaction<Result extends JsonValue>(
    work: (repository: AdminPaymentConfigurationRepository) => Promise<Result>,
  ): Promise<Result>;
}
