import { publicMediaUrlSchema } from "@fan-support/contracts";
import {
  createAdminCatalogUseCases,
  createTranslationWorkspaceUseCases,
  createTranslationTransferUseCases,
  createAdminPreviewMediaUseCases,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { MediaStoragePort } from "@fan-support/media-port";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type {
  AdminCatalogRouteDependencies,
  TranslationWorkspaceRouteDependencies,
  TranslationTransferRouteDependencies,
  AdminPreviewMediaRouteDependencies,
} from "./admin-workspace-route.js";
type WorkspacePersistence = Pick<
  PostgresPersistence,
  | "close"
  | "adminCatalogTransactionManager"
  | "translationWorkspaceTransactionManager"
  | "translationTransferTransactionManager"
  | "adminPreviewMediaTransactionManager"
>;
export type TestAdminWorkspaceCompositionOptions = Readonly<{
  environment: "TEST";
  publicMediaBaseUrl: string;
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  storage: Pick<MediaStoragePort, "createDownloadGrant">;
}>;
export type TestAdminWorkspaceComposition = Readonly<{
  adminCatalogRoute: AdminCatalogRouteDependencies;
  translationWorkspaceRoute: TranslationWorkspaceRouteDependencies;
  translationTransferRoute: TranslationTransferRouteDependencies;
  adminPreviewMediaRoute: AdminPreviewMediaRouteDependencies;
  adminWorkspaceRuntime: ApiLifecycleResource;
}>;
/** Explicit TEST installation. Storage is borrowed; only this PostgreSQL pool is owned. */
export function createTestAdminWorkspaceComposition(
  options: TestAdminWorkspaceCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      config: PostgresConnectionConfig,
      options: PostgresPersistenceOptions,
    ) => WorkspacePersistence;
  }> = {},
): TestAdminWorkspaceComposition {
  if (
    options.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper) ||
    typeof options.storage?.createDownloadGrant !== "function" ||
    !publicMediaUrlSchema.safeParse(options.publicMediaBaseUrl).success
  )
    throw new TypeError("Invalid TEST workspace configuration");
  try {
    const origin = new URL(options.allowedOrigin);
    if (
      origin.origin !== options.allowedOrigin ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw new Error();
  } catch {
    throw new TypeError("Invalid TEST workspace origin");
  }
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  let closePromise: Promise<void> | undefined;
  const stop = () =>
    (closePromise ??= Promise.resolve().then(() => persistence.close()));
  try {
    return Object.freeze({
      adminCatalogRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createAdminCatalogUseCases({
          transactions: persistence.adminCatalogTransactionManager,
          tokenPepper: options.tokenPepper,
        }),
      },
      translationWorkspaceRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createTranslationWorkspaceUseCases({
          transactions: persistence.translationWorkspaceTransactionManager,
          tokenPepper: options.tokenPepper,
        }),
      },
      translationTransferRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createTranslationTransferUseCases({
          transactions: persistence.translationTransferTransactionManager,
          tokenPepper: options.tokenPepper,
        }),
      },
      adminPreviewMediaRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createAdminPreviewMediaUseCases({
          transactions: persistence.adminPreviewMediaTransactionManager,
          tokenPepper: options.tokenPepper,
          storage: options.storage,
        }),
      },
      adminWorkspaceRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("TEST workspace construction failed");
  }
}
