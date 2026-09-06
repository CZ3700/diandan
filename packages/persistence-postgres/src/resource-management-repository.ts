import type { ResourceManagementRepository } from "@fan-support/persistence-port";
import { createResourceRun } from "./resource-management-data.js";
import { createResourcePolicyMethods } from "./resource-policy-repository.js";
import { createResourceUploadMethods } from "./resource-upload-repository.js";
import { createResourceMediaMethods } from "./resource-media-repository.js";
import { createResourceProcessingMethods } from "./resource-processing-repository.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export function createResourceManagementRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): ResourceManagementRepository {
  const run = createResourceRun(client, scope);
  return {
    ...createResourcePolicyMethods(client, run),
    ...createResourceUploadMethods(client, run),
    ...createResourceMediaMethods(client, run),
    ...createResourceProcessingMethods(client, scope, run),
  };
}
