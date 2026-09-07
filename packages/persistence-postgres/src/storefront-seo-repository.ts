import {
  DEFAULT_LOCALE,
  storefrontSeoLocatorSchema,
  storefrontHomepageContextResponseSchema,
} from "@fan-support/contracts";
import { projectStorefrontHomepage } from "@fan-support/content";
import { createStorefrontHomepageRepository } from "./storefront-homepage-repository.js";
import type { StorefrontSeoRepository } from "@fan-support/persistence-port";
import { loadPublishedContentContext } from "./published-content-repository.js";
import { createResourceRun } from "./resource-management-data.js";
import { readStorefrontSeoSnapshot } from "./storefront-seo-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export function createStorefrontSeoRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): StorefrontSeoRepository {
  const run = createResourceRun(client, scope);
  return {
    loadEntity(locator) {
      const parsed = storefrontSeoLocatorSchema.safeParse(locator);
      if (!parsed.success)
        return Promise.resolve({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "INVALID_QUERY",
        });
      if (parsed.data.kind === "HOMEPAGE")
        return run(async () => {
          const loaded = storefrontHomepageContextResponseSchema.parse(
            await createStorefrontHomepageRepository(
              client,
              scope,
              publicMediaBaseUrl,
            ).load({ schemaVersion: 1, locale: DEFAULT_LOCALE }),
          );
          if (loaded.outcome === "FAILURE") return loaded;
          const visible = projectStorefrontHomepage(loaded);
          if (visible.outcome !== "SUCCESS") return visible;
          return {
            schemaVersion: 1,
            outcome: "SUCCESS",
            context: loaded.homepage,
          };
        });
      return run(() =>
        loadPublishedContentContext(
          client,
          scope,
          { schemaVersion: 1, locator: parsed.data, locale: DEFAULT_LOCALE },
          publicMediaBaseUrl,
        ),
      );
    },
    readIndex: (cursor) =>
      run(() => readStorefrontSeoSnapshot(client, "INDEX", cursor)),
    readCatalog: (cursor) =>
      run(() => readStorefrontSeoSnapshot(client, "CATALOG", cursor)),
  };
}
