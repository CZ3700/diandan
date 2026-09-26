import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";

import {
  createCartRuntimeComposition,
  type CartRuntimeComposition,
  type CartRuntimeCompositionOptions,
} from "../cart-composition.js";

type Factories = Readonly<{
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => ReturnType<CartRuntimeCompositionOptions["openPersistence"]>;
}>;
/** Explicit TEST composition keeps test cryptography out of production defaults. */
export function createTestCartRuntimeComposition(
  options: Omit<CartRuntimeCompositionOptions, "openPersistence"> &
    Readonly<{ environment: "TEST"; database: PostgresConnectionConfig }>,
  factories: Factories = {},
): CartRuntimeComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST cart environment");
  return createCartRuntimeComposition({
    ...options,
    openPersistence: () =>
      (factories.createPersistence ?? createPostgresPersistence)(
        options.database,
        { catalogPublicMediaBaseUrl: options.publicMediaBaseUrl },
      ),
  });
}
