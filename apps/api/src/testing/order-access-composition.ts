import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";

import {
  createOrderAccessComposition,
  type OrderAccessComposition,
  type OrderAccessCompositionOptions,
} from "../order-access-composition.js";

type Factories = Readonly<{
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => ReturnType<OrderAccessCompositionOptions["openPersistence"]>;
}>;

export function createTestOrderAccessComposition(
  options: Omit<OrderAccessCompositionOptions, "openPersistence"> & {
    environment: "TEST";
    database: PostgresConnectionConfig;
  },
  factories: Factories = {},
): OrderAccessComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST order access environment");
  return createOrderAccessComposition({
    ...options,
    openPersistence: () =>
      (factories.createPersistence ?? createPostgresPersistence)(
        options.database,
        { catalogPublicMediaBaseUrl: options.publicMediaBaseUrl },
      ),
  });
}
