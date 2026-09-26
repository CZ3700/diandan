import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";

import {
  createCheckoutPreflightComposition,
  type CheckoutPreflightComposition,
  type CheckoutPreflightCompositionOptions,
} from "../checkout-composition.js";

type Factories = Readonly<{
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => ReturnType<CheckoutPreflightCompositionOptions["openPersistence"]>;
}>;

export function createTestCheckoutPreflightComposition(
  options: Omit<CheckoutPreflightCompositionOptions, "openPersistence"> &
    Readonly<{ environment: "TEST"; database: PostgresConnectionConfig }>,
  factories: Factories = {},
): CheckoutPreflightComposition {
  if (options.environment !== "TEST")
    throw new TypeError("Invalid TEST checkout environment");
  return createCheckoutPreflightComposition({
    ...options,
    openPersistence: () =>
      (factories.createPersistence ?? createPostgresPersistence)(
        options.database,
        { catalogPublicMediaBaseUrl: options.publicMediaBaseUrl },
      ),
  });
}
