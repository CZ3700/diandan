export const workspacePackageName = "@fan-support/key-management-kms" as const;

export {
  createKmsKeyManagementAdapter,
  type KmsKeyManagementAdapterConfig,
} from "./adapter.js";
