import {
  publishedContentReadCommandSchema,
  publishedContentContextResponseSchema,
  publishedContentResponseSchema,
  type PublishedContentLocator,
  type PublishedContentContext,
  type PublishedContentResponse,
} from "@fan-support/contracts";
import { projectPublishedContent } from "@fan-support/content";
import type {
  JsonValue,
  PublishedContentTransactionManager,
} from "@fan-support/persistence-port";
export type PublishedContentDependencies = Readonly<{
  transactions: PublishedContentTransactionManager;
}>;
export type PublishedContentUseCases = Readonly<{
  execute(input: unknown): Promise<PublishedContentResponse>;
}>;
function matches(
  locator: PublishedContentLocator,
  context: PublishedContentContext,
): boolean {
  if (context.schemaVersion === 3) {
    const document = context.current.document;
    if (document.kind !== locator.kind) return false;
    if (locator.kind === "IDOL" || locator.kind === "GIFT")
      return context.current.handle === locator.handle;
    if (locator.kind === "MEDIA_METADATA")
      return (
        document.ownerId.toLowerCase() === locator.mediaAssetId.toLowerCase()
      );
    return locator.kind === "HOMEPAGE";
  }
  const candidate = context.canonical.candidate;
  switch (locator.kind) {
    case "IDOL":
    case "GIFT":
      return (
        candidate.objectKind === locator.kind &&
        candidate.base.handle === locator.handle
      );
    case "POLICY":
      return (
        candidate.objectKind === "POLICY" &&
        candidate.revision.policyKey === locator.policyKey
      );
    case "HOMEPAGE":
      return candidate.objectKind === "HOMEPAGE";
    case "MEDIA_METADATA":
      return (
        candidate.objectKind === "MEDIA_METADATA" &&
        candidate.asset.id.toLowerCase() === locator.mediaAssetId.toLowerCase()
      );
  }
}
export function createPublishedContentUseCases(
  dependencies: PublishedContentDependencies,
): PublishedContentUseCases {
  return Object.freeze({
    async execute(input: unknown): Promise<PublishedContentResponse> {
      const parsed = publishedContentReadCommandSchema.safeParse(input);
      if (!parsed.success)
        return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" };
      try {
        const response =
          await dependencies.transactions.runInPublishedContentTransaction(
            async (repositories) => {
              const loaded = publishedContentContextResponseSchema.parse(
                await repositories.publishedContent.load(parsed.data),
              );
              if (loaded.outcome !== "SUCCESS")
                return JSON.parse(JSON.stringify(loaded)) as JsonValue;
              if (
                loaded.context.locale !== parsed.data.locale ||
                !matches(parsed.data.locator, loaded.context)
              )
                return {
                  schemaVersion: 1,
                  outcome: "FAILURE",
                  code: "CONTENT_UNAVAILABLE",
                };
              return JSON.parse(
                JSON.stringify(projectPublishedContent(loaded.context)),
              ) as JsonValue;
            },
          );
        return publishedContentResponseSchema.parse(response);
      } catch {
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CONTENT_UNAVAILABLE",
        };
      }
    },
  });
}
