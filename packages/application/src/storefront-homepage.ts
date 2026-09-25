import {
  storefrontHomepageReadCommandSchema,
  storefrontHomepageContextResponseSchema,
  storefrontHomepageResponseSchema,
  type StorefrontHomepageResponse,
} from "@fan-support/contracts";
import { projectStorefrontHomepage } from "@fan-support/content";
import type {
  JsonValue,
  StorefrontHomepageTransactionManager,
} from "@fan-support/persistence-port";

const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
} as const;
export function createStorefrontHomepageUseCases({
  transactions,
}: Readonly<{ transactions: StorefrontHomepageTransactionManager }>) {
  return Object.freeze({
    async execute(input: unknown): Promise<StorefrontHomepageResponse> {
      const command = storefrontHomepageReadCommandSchema.safeParse(input);
      if (!command.success)
        return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" };
      try {
        return storefrontHomepageResponseSchema.parse(
          await transactions.runInStorefrontHomepageTransaction(
            async ({ storefrontHomepage }) => {
              const loaded = storefrontHomepageContextResponseSchema.parse(
                await storefrontHomepage.load(command.data),
              );
              if (loaded.outcome === "FAILURE") return loaded;
              if (
                loaded.homepage.locale !== command.data.locale ||
                loaded.slots.some(
                  (row) =>
                    row.status === "AVAILABLE" &&
                    row.context.locale !== command.data.locale,
                )
              )
                return unavailable;
              const result = projectStorefrontHomepage(loaded);
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
