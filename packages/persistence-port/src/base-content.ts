import type {
  AdminMutationResponse,
  BaseContentReviewReadCommand,
  BaseContentReviewResponse,
  AppendBaseContentReviewCommand,
  IssueBaseContentPreviewCommand,
  BaseContentPreviewGrantResponse,
  ReadBaseContentPreviewCommand,
  BaseContentPreviewResponse,
  RevokeBaseContentPreviewCommand,
} from "@fan-support/contracts";
import type { JsonValue, IdempotencyRepository } from "./index.js";
import type { AdminAuthorizationRepository } from "./admin-content.js";

export interface BaseContentReviewRepository {
  read(
    command: BaseContentReviewReadCommand,
  ): Promise<BaseContentReviewResponse>;
  append(
    command: AppendBaseContentReviewCommand,
  ): Promise<AdminMutationResponse>;
}
export interface BaseContentPreviewRepository {
  issue(
    command: IssueBaseContentPreviewCommand,
  ): Promise<BaseContentPreviewGrantResponse>;
  read(
    command: ReadBaseContentPreviewCommand,
  ): Promise<BaseContentPreviewResponse>;
  revoke(
    command: RevokeBaseContentPreviewCommand,
  ): Promise<AdminMutationResponse>;
}
export type BaseContentRepositories = Readonly<{
  authorization: AdminAuthorizationRepository;
  baseContentReviews: BaseContentReviewRepository;
  baseContentPreviews: BaseContentPreviewRepository;
  idempotency: IdempotencyRepository;
}>;
export interface BaseContentTransactionManager {
  runInBaseContentTransaction<Result extends JsonValue>(
    work: (repositories: BaseContentRepositories) => Promise<Result>,
  ): Promise<Result>;
}
