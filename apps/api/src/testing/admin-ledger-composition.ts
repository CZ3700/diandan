import { createAdminLedgerUseCases } from "@fan-support/application";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { AdminLedgerRouteDependencies } from "../admin-ledger-route.js";
import type { ApiLifecycleResource } from "../bootstrap.js";

type Persistence = Pick<
  PostgresPersistence,
  "adminLedgerTransactionManager" | "close"
>;
export type LocalAdminLedgerCompositionOptions = Readonly<{
  environment: "LOCAL_OIDC";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  keys: KeyManagementPort;
  /** Ledger calendar days; the user chose Beijing time (ADR-022). */
  timeZone?: string | undefined;
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
/** ADR-022 / L3-12 for local and remote TEST instances: shares the session pepper, owns one PostgreSQL pool. */
export function createLocalAdminLedgerComposition(
  options: LocalAdminLedgerCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      database: PostgresConnectionConfig,
      options: PostgresPersistenceOptions,
    ) => Persistence;
  }> = {},
): Readonly<{
  adminLedgerRoute: AdminLedgerRouteDependencies;
  adminLedgerRuntime: ApiLifecycleResource;
}> {
  if (
    options.environment !== "LOCAL_OIDC" ||
    !httpsOrigin(options.allowedOrigin) ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper) ||
    typeof options.keys?.decryptEnvelope !== "function"
  )
    throw new TypeError("Invalid local admin ledger configuration");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {});
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    return Object.freeze({
      adminLedgerRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createAdminLedgerUseCases({
          transactions: persistence.adminLedgerTransactionManager,
          keys: options.keys,
          tokenPepper: options.tokenPepper,
          timeZone: options.timeZone ?? "Asia/Shanghai",
        }),
      },
      adminLedgerRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Local admin ledger construction failed");
  }
}
