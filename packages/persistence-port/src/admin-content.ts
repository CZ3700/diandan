import type {
  AdminAuthorizationCommand,
  AdminAuthorizationResponse,
  ContentReviewReadCommand,
  ContentReviewContextResponse,
  AppendContentReviewCommand,
  AdminMutationResponse,
  IssueContentPreviewCommand,
  ContentPreviewGrantResponse,
  ReadContentPreviewCommand,
  ContentPreviewResponse,
  RevokeContentPreviewCommand,
} from "@fan-support/contracts";
import type { JsonValue, IdempotencyRepository } from "./index.js";
import type { ContentDraftRepository } from "./content-drafts.js";
export interface AdminAuthorizationRepository {
  authorize(
    command: AdminAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export interface ContentReviewRepository {
  loadTarget(
    command: ContentReviewReadCommand,
  ): Promise<ContentReviewContextResponse>;
  append(command: AppendContentReviewCommand): Promise<AdminMutationResponse>;
}
export interface ContentPreviewRepository {
  issue(
    command: IssueContentPreviewCommand,
  ): Promise<ContentPreviewGrantResponse>;
  read(command: ReadContentPreviewCommand): Promise<ContentPreviewResponse>;
  revoke(command: RevokeContentPreviewCommand): Promise<AdminMutationResponse>;
}
export type AdminContentRepositories = Readonly<{
  authorization: AdminAuthorizationRepository;
  contentDrafts: ContentDraftRepository;
  contentReviews: ContentReviewRepository;
  contentPreviews: ContentPreviewRepository;
  idempotency: IdempotencyRepository;
}>;
export interface AdminContentTransactionManager {
  runInAdminContentTransaction<Result extends JsonValue>(
    work: (repositories: AdminContentRepositories) => Promise<Result>,
  ): Promise<Result>;
}
