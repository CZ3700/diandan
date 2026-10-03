import type {
  WishGalleryFailureCode,
  WishGalleryReadCommand,
  WishGalleryPage,
  WishGalleryWithdrawCommand,
  WishGalleryWithdrawn,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export class WishGalleryRepositoryError extends Error {
  constructor(readonly code: WishGalleryFailureCode) {
    super("Wish gallery unavailable");
    this.name = "WishGalleryRepositoryError";
  }
}
export interface WishGalleryRepository {
  /** Read current visibility and financial eligibility from PostgreSQL; callers must not cache. */
  read(command: WishGalleryReadCommand): Promise<WishGalleryPage>;
  /** Session-authorized, irreversible publicity withdrawal; never releases a supported wish. */
  withdraw(command: WishGalleryWithdrawCommand): Promise<WishGalleryWithdrawn>;
}
export interface WishGalleryTransactionManager {
  runInWishGalleryTransaction<Result extends JsonValue>(
    work: (repository: WishGalleryRepository) => Promise<Result>,
  ): Promise<Result>;
}
