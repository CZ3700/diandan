import { publicMediaUrlSchema } from "@fan-support/contracts";
import { createGiftCommerceUseCases } from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type { GiftCommerceRouteDependencies } from "./gift-commerce-route.js";
import type { ApiLifecycleResource } from "./bootstrap.js";

type CommercePersistence = Pick<
  PostgresPersistence,
  "close" | "giftCommerceTransactionManager"
>;
export type TestGiftCommerceCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
}>;
export function createTestGiftCommerceComposition(
  options: TestGiftCommerceCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      database: PostgresConnectionConfig,
      options: PostgresPersistenceOptions,
    ) => CommercePersistence;
  }> = {},
): Readonly<{
  giftCommerceRoute: GiftCommerceRouteDependencies;
  giftCommerceRuntime: ApiLifecycleResource;
}> {
  if (
    options.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper) ||
    !publicMediaUrlSchema.safeParse(options.publicMediaBaseUrl).success
  )
    throw new TypeError("Invalid TEST gift commerce configuration");
  try {
    const origin = new URL(options.allowedOrigin);
    if (
      origin.origin !== options.allowedOrigin ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw new Error();
  } catch {
    throw new TypeError("Invalid TEST gift commerce origin");
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
      giftCommerceRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createGiftCommerceUseCases({
          tokenPepper: options.tokenPepper,
          transactions: persistence.giftCommerceTransactionManager,
        }),
      },
      giftCommerceRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("TEST gift commerce construction failed");
  }
}
