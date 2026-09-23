import { isAbsolute } from "node:path";

const postgresSelectors = [
  "POSTGRES_TEST_BIN",
  "FAN_SUPPORT_LOCAL_POSTGRES_BIN",
  "ADMIN_FINANCE_TEST_POSTGRES_BIN",
  "ADMIN_PAYMENT_CONFIG_TEST_POSTGRES_BIN",
  "ADMIN_EXCEPTIONS_TEST_POSTGRES_BIN",
  "PSP_ONBOARDING_TEST_POSTGRES_BIN",
];

/** Owned tooling uses one explicit PostgreSQL runtime and no ambient Git or business target. */
export function regressionSuiteEnvironment(suite, environment) {
  const directories = postgresSelectors
    .map((key) => environment[key])
    .filter((value) => value !== undefined);
  if (directories.some((value) => !isAbsolute(value)))
    throw new Error("Regression PostgreSQL tool directory must be absolute");
  if (new Set(directories).size > 1)
    throw new Error("Conflicting regression PostgreSQL tool directories");
  const binDirectory = directories[0];
  const result = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        !key.startsWith("FAN_SUPPORT_") &&
        !key.startsWith("GIT_") &&
        !postgresSelectors.includes(key),
    ),
  );
  if (binDirectory !== undefined) {
    result.POSTGRES_TEST_BIN = binDirectory;
    if (suite === "journey")
      result.FAN_SUPPORT_LOCAL_POSTGRES_BIN = binDirectory;
  }
  return result;
}
