import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import { withNativeFinancePostgres } from "./admin-finance-native-postgres.mjs";

/** Honor one explicit TEST runtime selection across finance storage, HTTP and browser checks. */
export async function withFinanceTestDatabase(
  work,
  {
    environment = process.env,
    native = withNativeFinancePostgres,
    docker = withEphemeralPostgres,
  } = {},
) {
  const binDirectory = environment.ADMIN_FINANCE_TEST_POSTGRES_BIN;
  if (
    binDirectory !== undefined &&
    environment.POSTGRES_TEST_BIN !== undefined &&
    binDirectory !== environment.POSTGRES_TEST_BIN
  )
    throw new Error("Conflicting finance PostgreSQL tool directories");
  if (binDirectory !== undefined)
    return native(
      (database, metadata) =>
        work(database, {
          kind: "NATIVE_ISOLATED_TEST",
          serverVersion: metadata.serverVersion,
          configuredBy: "ADMIN_FINANCE_TEST_POSTGRES_BIN",
        }),
      { binDirectory },
    );
  return docker(work, { environment });
}
