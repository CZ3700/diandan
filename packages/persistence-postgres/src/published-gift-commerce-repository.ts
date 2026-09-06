import {
  publishedGiftCommerceReadCommandSchema,
  publishedGiftCommerceContextResponseSchema,
} from "@fan-support/contracts";
import type { PublishedGiftCommerceRepository } from "@fan-support/persistence-port";
import { loadPublishedContentContext } from "./published-content-repository.js";
import { readGiftPublicationProfile } from "./gift-commerce-gift-profile.js";
import { createResourceRun } from "./resource-management-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
export function createPublishedGiftCommerceRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): PublishedGiftCommerceRepository {
  const run = createResourceRun(client, scope);
  return {
    load(input) {
      const parsed = publishedGiftCommerceReadCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "INVALID_QUERY",
        });
      return run(async () => {
        const loaded = await loadPublishedContentContext(
          client,
          scope,
          parsed.data,
          publicMediaBaseUrl,
        );
        if (loaded.outcome === "FAILURE") return loaded;
        const { publication } = loaded.context;
        if (publication.target.owner.kind !== "GIFT")
          return {
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "CONTENT_UNAVAILABLE",
          } as const;
        const profile = await readGiftPublicationProfile(client, {
          publicationId: publication.publicationId,
          giftId: publication.target.owner.giftId,
          giftRevisionId: publication.target.revisionId,
          manifestHash: publication.manifestHash,
        });
        return publishedGiftCommerceContextResponseSchema.parse({
          ...loaded,
          profileVersion: profile === null ? 1 : 2,
          profile,
        });
      });
    },
  };
}
