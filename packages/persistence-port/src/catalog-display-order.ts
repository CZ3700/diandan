import type {
  AdminPrincipal,
  CatalogDisplayOrderCommand,
  CatalogDisplayOrderResponse,
} from "@fan-support/contracts";
import type { HomeLayoutAuthorizationRepository } from "./home-layout.js";
import type { JsonValue } from "./index.js";

/** L2-10: operator-chosen storefront order; layout metadata authorized like the homepage layout. */
export interface CatalogDisplayOrderRepository {
  execute(
    input: Readonly<{
      command: CatalogDisplayOrderCommand;
      principal: AdminPrincipal;
      requestId: string;
      requestHash: string;
    }>,
  ): Promise<CatalogDisplayOrderResponse>;
}
export type CatalogDisplayOrderRepositories = Readonly<{
  authorization: HomeLayoutAuthorizationRepository;
  displayOrder: CatalogDisplayOrderRepository;
}>;
export interface CatalogDisplayOrderTransactionManager {
  runInCatalogDisplayOrderTransaction<Result extends JsonValue>(
    work: (repositories: CatalogDisplayOrderRepositories) => Promise<Result>,
  ): Promise<Result>;
}
