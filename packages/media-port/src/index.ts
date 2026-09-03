import type {
  CreateMediaDownloadGrantCommand,
  CreateMediaDownloadGrantResponse,
  CreateMediaUploadGrantCommand,
  CreateMediaUploadGrantResponse,
  DeleteMediaObjectCommand,
  DeleteMediaObjectResponse,
  InspectMediaObjectCommand,
  InspectMediaObjectResponse,
  ResolvePublicMediaUrlCommand,
  ResolvePublicMediaUrlResponse,
} from "@fan-support/contracts";

export {
  mediaPortCommandSchema,
  mediaPortErrorCodeSchema,
  mediaPortErrorSchema,
  mediaPortOperationSchema,
  mediaPortResponseSchema,
  mediaMimeTypeSchema,
  mediaObjectRevisionTokenSchema,
  mediaStorageClassSchema,
} from "@fan-support/contracts";
export type {
  CreateMediaDownloadGrantCommand,
  CreateMediaDownloadGrantResponse,
  CreateMediaUploadGrantCommand,
  CreateMediaUploadGrantResponse,
  DeleteMediaObjectCommand,
  DeleteMediaObjectResponse,
  InspectMediaObjectCommand,
  InspectMediaObjectResponse,
  MediaPortCommand,
  MediaPortError,
  MediaPortFailure,
  MediaPortResponse,
  ResolvePublicMediaUrlCommand,
  ResolvePublicMediaUrlResponse,
} from "@fan-support/contracts";

export interface MediaStoragePort {
  createUploadGrant(
    command: CreateMediaUploadGrantCommand,
  ): Promise<CreateMediaUploadGrantResponse>;
  inspectObject(
    command: InspectMediaObjectCommand,
  ): Promise<InspectMediaObjectResponse>;
  createDownloadGrant(
    command: CreateMediaDownloadGrantCommand,
  ): Promise<CreateMediaDownloadGrantResponse>;
  deleteObject(
    command: DeleteMediaObjectCommand,
  ): Promise<DeleteMediaObjectResponse>;
  resolvePublicUrl(
    command: ResolvePublicMediaUrlCommand,
  ): Promise<ResolvePublicMediaUrlResponse>;
}

export const workspacePackageName = "@fan-support/media-port" as const;
