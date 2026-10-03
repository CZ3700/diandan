import type {
  AdminPrincipal,
  AdminAuthorizationResponse,
  StorefrontBrandAuthorizationCommand,
  StorefrontBrandCommand,
  StorefrontBrandResponse,
  PublicStorefrontBrandResponse,
  StorefrontLogoProcessingSuccess,
} from "@fan-support/contracts";
import type { JsonValue, ResourceManagementRepository } from "./index.js";
export type StorefrontBrandMutationInput = Readonly<{
  command: StorefrontBrandCommand;
  principal: AdminPrincipal;
  requestId: string;
  requestHash: string;
}>;
export interface StorefrontBrandRepository {
  execute(
    input: StorefrontBrandMutationInput,
  ): Promise<StorefrontBrandResponse>;
  readPublished(): Promise<PublicStorefrontBrandResponse>;
  readPrepared(
    input: StorefrontBrandMutationInput,
  ): Promise<StorefrontBrandResponse | null>;
  saveLogo(
    input: StorefrontBrandMutationInput & {
      processed: StorefrontLogoProcessingSuccess;
    },
  ): Promise<StorefrontBrandResponse>;
}
export interface StorefrontBrandAuthorizationRepository {
  authorize(
    input: StorefrontBrandAuthorizationCommand,
  ): Promise<AdminAuthorizationResponse>;
}
export type StorefrontBrandRepositories = Readonly<{
  authorization: StorefrontBrandAuthorizationRepository;
  storefrontBrand: StorefrontBrandRepository;
  resources: Pick<ResourceManagementRepository, "readUpload">;
}>;
export interface StorefrontBrandTransactionManager {
  runInStorefrontBrandTransaction<Result extends JsonValue>(
    work: (repositories: StorefrontBrandRepositories) => Promise<Result>,
  ): Promise<Result>;
}
