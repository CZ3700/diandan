import {
  publishedGiftCommerceReadCommandSchema,
  publishedGiftCommerceResponseSchema,
  publishedGiftCommerceContextResponseSchema,
  type PublishedGiftCommerceResponse,
} from "@fan-support/contracts";
import { projectPublishedGiftCommerce } from "@fan-support/content";
import type {
  JsonValue,
  PublishedGiftCommerceTransactionManager,
} from "@fan-support/persistence-port";
const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
} as const;
export function createPublishedGiftCommerceUseCases({
  transactions,
}: {
  transactions: PublishedGiftCommerceTransactionManager;
}) {
  return Object.freeze({
    async execute(input: unknown): Promise<PublishedGiftCommerceResponse> {
      const command = publishedGiftCommerceReadCommandSchema.safeParse(input);
      if (!command.success)
        return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" };
      try {
        return publishedGiftCommerceResponseSchema.parse(
          await transactions.runInPublishedGiftCommerceTransaction(
            async ({ publishedGiftCommerce }) => {
              const loaded = publishedGiftCommerceContextResponseSchema.parse(
                await publishedGiftCommerce.load(command.data),
              );
              if (loaded.outcome === "FAILURE") return loaded;
              const result = projectPublishedGiftCommerce(loaded);
              if (result.outcome === "FAILURE") return result;
              const locale = result.content.view.localeContext;
              if (
                result.content.kind !== "GIFT" ||
                result.content.view.handle !== command.data.locator.handle ||
                loaded.context.locale !== command.data.locale ||
                locale.requestedLocale !== command.data.locale ||
                (locale.schemaVersion === 2
                  ? locale.resolvedLocale !== locale.sourceLocale ||
                    locale.fallbackUsed !==
                      (command.data.locale !== locale.sourceLocale)
                  : locale.resolvedLocale !== command.data.locale ||
                    locale.fallbackUsed)
              )
                return unavailable;
              return JSON.parse(JSON.stringify(result)) as JsonValue;
            },
          ),
        );
      } catch {
        return unavailable;
      }
    },
  });
}
