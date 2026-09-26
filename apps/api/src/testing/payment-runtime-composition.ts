import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";

import {
  composePaymentRuntime,
  type PaymentRuntimeComposeOptions,
  type PaymentRuntimeComposition,
} from "../payment-runtime-composition.js";

type Factories = {
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => ReturnType<PaymentRuntimeComposeOptions["openPersistence"]>;
};

export function createTestPaymentRuntimeComposition(
  options: Omit<PaymentRuntimeComposeOptions, "openPersistence"> & {
    environment: "TEST";
    database: PostgresConnectionConfig;
  },
  factories: Factories = {},
): PaymentRuntimeComposition {
  if (
    options.environment !== "TEST" ||
    [
      ...options.providers,
      ...(options.providerDirectory?.getRegistrations() ?? []),
    ].some((entry) => entry.configuration.environment !== "TEST")
  )
    throw new TypeError("Invalid TEST payment environment");
  const directory = options.providerDirectory;
  return composePaymentRuntime({
    ...options,
    ...(directory === undefined
      ? {}
      : {
          providerDirectory: {
            getRegistrations() {
              const entries = directory.getRegistrations();
              if (
                entries.some(
                  (entry) => entry.configuration.environment !== "TEST",
                )
              )
                throw new TypeError("Invalid TEST payment environment");
              return entries;
            },
          },
        }),
    openPersistence: () =>
      (factories.createPersistence ?? createPostgresPersistence)(
        options.database,
        { catalogPublicMediaBaseUrl: options.publicMediaBaseUrl },
      ),
  });
}
