import type {
  AdminResourceAuthorizationCommand,
  AdminAuthorizationResponse,
  AdminMutationResponse,
  ResourcePolicyReadCommand,
  ResourcePolicyRegisterCommand,
  ResourcePolicyResponse,
  MediaUploadReserveCommand,
  MediaUploadReadCommand,
  MediaUploadRegisterCommand,
  MediaUploadTicketResponse,
  ResourceMediaReadCommand,
  ResourceMediaResponse,
  MediaRightsSetCommand,
  ResourceMediaEnqueueCommand,
  ResourceMediaJobReadCommand,
  ResourceMediaRetryCommand,
  ResourceMediaJobResponse,
} from "@fan-support/contracts";
import type { JsonValue, IdempotencyRepository } from "./index.js";
export interface ResourceAuthorizationRepository {
  authorize(
    command: AdminResourceAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export interface ResourceManagementRepository {
  readPolicy(
    command: ResourcePolicyReadCommand,
  ): Promise<ResourcePolicyResponse>;
  registerPolicy(
    command: ResourcePolicyRegisterCommand,
  ): Promise<AdminMutationResponse>;
  reserveUpload(
    command: MediaUploadReserveCommand,
  ): Promise<MediaUploadTicketResponse>;
  readUpload(
    command: MediaUploadReadCommand,
  ): Promise<MediaUploadTicketResponse>;
  registerUpload(
    command: MediaUploadRegisterCommand,
  ): Promise<AdminMutationResponse>;
  readMedia(command: ResourceMediaReadCommand): Promise<ResourceMediaResponse>;
  setRights(command: MediaRightsSetCommand): Promise<AdminMutationResponse>;
  enqueueMedia(
    command: ResourceMediaEnqueueCommand,
  ): Promise<AdminMutationResponse>;
  readMediaJob(
    command: ResourceMediaJobReadCommand,
  ): Promise<ResourceMediaJobResponse>;
  retryMediaJob(
    command: ResourceMediaRetryCommand,
  ): Promise<AdminMutationResponse>;
}
export type ResourceManagementRepositories = Readonly<{
  authorization: ResourceAuthorizationRepository;
  resources: ResourceManagementRepository;
  idempotency: IdempotencyRepository;
}>;
export interface ResourceManagementTransactionManager {
  runInResourceManagementTransaction<Result extends JsonValue>(
    work: (repositories: ResourceManagementRepositories) => Promise<Result>,
  ): Promise<Result>;
}
