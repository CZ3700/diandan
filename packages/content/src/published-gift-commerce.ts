import {
  publishedGiftCommerceContextResponseSchema,
  publishedGiftCommerceResponseSchema,
  type PublishedGiftCommerceResponse,
} from "@fan-support/contracts";
import { projectPublishedContent } from "./published-content.js";
/** Public gift classification adds no business policy or internal profile authorship. */
export function projectPublishedGiftCommerce(
  input: unknown,
): PublishedGiftCommerceResponse {
  const parsed = publishedGiftCommerceContextResponseSchema.safeParse(input);
  if (!parsed.success)
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    };
  const loaded = parsed.data;
  if (loaded.outcome === "FAILURE") return loaded;
  const result = projectPublishedContent(loaded.context);
  if (result.outcome === "FAILURE") return result;
  if (result.content.kind !== "GIFT")
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    };
  return publishedGiftCommerceResponseSchema.parse({
    ...result,
    kind: "PUBLISHED_GIFT_COMMERCE",
    classification: loaded.profile
      ? {
          kind: "CLASSIFIED",
          giftKind: loaded.profile.profile.giftKind,
          profileHash: loaded.profile.profile.profileHash,
        }
      : { kind: "LEGACY" },
  });
}
