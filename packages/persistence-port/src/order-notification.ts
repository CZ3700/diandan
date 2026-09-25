import type {
  NotificationSourceCommand,
  NotificationSourceResult,
  NotificationRequestCommand,
  NotificationRequestResult,
  NotificationClaimCommand,
  NotificationClaimResult,
  NotificationLeaseCommand,
  NotificationAttachLinkCommand,
  NotificationAttachLinkResult,
  NotificationRecipientResult,
  NotificationConfirmSendCommand,
  NotificationConfirmSendResult,
  NotificationFinishCommand,
  NotificationFinishResult,
  NotificationListPendingCommand,
  NotificationListPendingResult,
  CommerceExpiryListCommand,
  CommerceExpiryListResult,
  CommerceExpiryCommand,
  CommerceExpiryResult,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export class NotificationRepositoryError extends Error {
  constructor(
    readonly code:
      | "INVALID_COMMAND"
      | "INTEGRITY_VIOLATION"
      | "LEASE_LOST"
      | "CONTACT_UNAVAILABLE"
      | "LINK_UNAVAILABLE"
      | "TEMPORARY_UNAVAILABLE",
  ) {
    super("Notification persistence unavailable");
    this.name = "NotificationRepositoryError";
  }
}
export interface NotificationRepository {
  source(command: NotificationSourceCommand): Promise<NotificationSourceResult>;
  request(
    command: NotificationRequestCommand,
  ): Promise<NotificationRequestResult>;
  claim(command: NotificationClaimCommand): Promise<NotificationClaimResult>;
  attachLink(
    command: NotificationAttachLinkCommand,
  ): Promise<NotificationAttachLinkResult>;
  /** Commits an access audit before the caller may decrypt the returned envelope. */
  recipient(
    command: NotificationLeaseCommand,
  ): Promise<NotificationRecipientResult>;
  /** Rechecks lease, contact retention, link ownership and the immutable content hash just before dispatch. */
  confirmSend(
    command: NotificationConfirmSendCommand,
  ): Promise<NotificationConfirmSendResult>;
  finish(command: NotificationFinishCommand): Promise<NotificationFinishResult>;
  listPending(
    command: NotificationListPendingCommand,
  ): Promise<NotificationListPendingResult>;
}
export interface NotificationTransactionManager {
  runInNotificationTransaction<Result extends JsonValue>(
    work: (repository: NotificationRepository) => Promise<Result>,
  ): Promise<Result>;
}
export interface CommerceExpiryRepository {
  listDue(
    command: CommerceExpiryListCommand,
  ): Promise<CommerceExpiryListResult>;
  expireCart(command: CommerceExpiryCommand): Promise<CommerceExpiryResult>;
}
export interface CommerceExpiryTransactionManager {
  runInCommerceExpiryTransaction<Result extends JsonValue>(
    work: (repository: CommerceExpiryRepository) => Promise<Result>,
  ): Promise<Result>;
}
