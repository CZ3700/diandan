import { createAdminArtistNoteUseCases } from "@fan-support/application";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { AdminArtistNotesRouteDependencies } from "../admin-artist-notes-route.js";
import type { ApiLifecycleResource } from "../bootstrap.js";

type Persistence = Pick<
  PostgresPersistence,
  "adminArtistNoteTransactionManager" | "close"
>;
export type LocalAdminArtistNotesCompositionOptions = Readonly<{
  environment: "LOCAL_OIDC";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  keys: KeyManagementPort;
}>;
function httpsOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}
/** ADR-022 / L3-13 for local and remote TEST instances: shares the session pepper, owns one PostgreSQL pool. */
export function createLocalAdminArtistNotesComposition(
  options: LocalAdminArtistNotesCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      database: PostgresConnectionConfig,
      options: PostgresPersistenceOptions,
    ) => Persistence;
  }> = {},
): Readonly<{
  adminArtistNotesRoute: AdminArtistNotesRouteDependencies;
  adminArtistNotesRuntime: ApiLifecycleResource;
}> {
  if (
    options.environment !== "LOCAL_OIDC" ||
    !httpsOrigin(options.allowedOrigin) ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper) ||
    typeof options.keys?.encryptEnvelope !== "function" ||
    typeof options.keys?.decryptEnvelope !== "function"
  )
    throw new TypeError("Invalid local admin artist notes configuration");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {});
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    return Object.freeze({
      adminArtistNotesRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createAdminArtistNoteUseCases({
          transactions: persistence.adminArtistNoteTransactionManager,
          keys: options.keys,
          tokenPepper: options.tokenPepper,
        }),
      },
      adminArtistNotesRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Local admin artist notes construction failed");
  }
}
