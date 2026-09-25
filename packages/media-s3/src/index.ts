export const workspacePackageName = "@fan-support/media-s3" as const;

export {
  createS3MediaStorageAdapter,
  type S3MediaStorageAdapterConfig,
} from "./adapter.js";
