import { createContentAuthoringUseCases } from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type { ContentAuthoringRouteDependencies } from "../admin-content-authoring-route.js";

type AuthoringPersistence = Pick<
  PostgresPersistence,
  "contentAuthoringTransactionManager" | "close"
>;
export type TestContentAuthoringCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
}>;
/** Explicit local integration surface; no production identity or session issuance. */
export function createTestContentAuthoringComposition(
  options: TestContentAuthoringCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      config: PostgresConnectionConfig,
    ) => AuthoringPersistence;
  }> = {},
): Readonly<{
  contentAuthoringRoute: ContentAuthoringRouteDependencies;
  contentAuthoringRuntime: ApiLifecycleResource;
}> {
  if (
    options?.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper)
  )
    throw new TypeError("test content authoring configuration is invalid");
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new TypeError("test content authoring origin is invalid");
  }
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new TypeError("test content authoring origin is invalid");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database);
  const useCases = createContentAuthoringUseCases({
    transactions: persistence.contentAuthoringTransactionManager,
    tokenPepper: options.tokenPepper,
  });
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    contentAuthoringRoute: { useCases, allowedOrigin: options.allowedOrigin },
    contentAuthoringRuntime: {
      start: async () => undefined,
      stop: () => {
        closePromise ??= Promise.resolve().then(() => persistence.close());
        return closePromise;
      },
    },
  });
}
