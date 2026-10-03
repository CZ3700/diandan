import { createResourceManagementUseCases } from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type {
  MediaStoragePort,
  MediaSourceInspectionPort,
} from "@fan-support/media-port";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type { ResourceManagementRouteDependencies } from "../resource-management-route.js";
type ResourcePersistence = Pick<
  PostgresPersistence,
  "resourceManagementTransactionManager" | "close"
>;
export type TestResourceManagementCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  storage: MediaStoragePort;
  inspector: MediaSourceInspectionPort;
}>;
/** Explicit local integration. Borrows media ports and owns only its PostgreSQL manager. */
export function createTestResourceManagementComposition(
  options: TestResourceManagementCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      config: PostgresConnectionConfig,
    ) => ResourcePersistence;
  }> = {},
): Readonly<{
  resourceManagementRoute: ResourceManagementRouteDependencies;
  resourceManagementRuntime: ApiLifecycleResource;
}> {
  if (
    options?.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper) ||
    typeof options.storage?.createUploadGrant !== "function" ||
    typeof options.inspector?.inspect !== "function"
  )
    throw new TypeError("test resource management configuration is invalid");
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("test resource management origin is invalid");
  }
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new TypeError("test resource management origin is invalid");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  let useCases;
  try {
    useCases = createResourceManagementUseCases({
      transactions: persistence.resourceManagementTransactionManager,
      tokenPepper: options.tokenPepper,
      storage: options.storage,
      inspector: options.inspector,
    });
  } catch {
    void Promise.resolve()
      .then(() => persistence.close())
      .catch(() => undefined);
    throw new TypeError("test resource management construction failed");
  }
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    resourceManagementRoute: { useCases, allowedOrigin: options.allowedOrigin },
    resourceManagementRuntime: {
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    },
  });
}
