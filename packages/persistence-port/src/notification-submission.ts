import type {
  NotificationSubmissionClaimCommand,
  NotificationSubmissionClaimResult,
  NotificationSubmissionFinishCommand,
  NotificationSubmissionFinishResult,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

/** Permanent admission journal for mail providers without a deduplication guarantee. */
export interface NotificationSubmissionRepository {
  claim(
    command: NotificationSubmissionClaimCommand,
  ): Promise<NotificationSubmissionClaimResult>;
  finish(
    command: NotificationSubmissionFinishCommand,
  ): Promise<NotificationSubmissionFinishResult>;
}

export interface NotificationSubmissionTransactionManager {
  /** The returned SEND is usable only after this promise resolves and its transaction committed.
   * The callback must contain persistence work only, never the provider network operation.
   */
  runInNotificationSubmissionTransaction<Result extends JsonValue>(
    work: (repository: NotificationSubmissionRepository) => Promise<Result>,
  ): Promise<Result>;
}
