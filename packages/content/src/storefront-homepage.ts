import {
  storefrontHomepageContextResponseSchema,
  storefrontHomepageResponseSchema,
  type StorefrontHomepageResponse,
} from "@fan-support/contracts";
import { projectPublishedContent } from "./published-content.js";

const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
} as const;

/** Resolves published homepage references without weakening any object's current publication proof. */
export function projectStorefrontHomepage(
  input: unknown,
): StorefrontHomepageResponse {
  try {
    const parsed = storefrontHomepageContextResponseSchema.parse(input);
    if (parsed.outcome === "FAILURE") return parsed;
    const homepage = projectPublishedContent(parsed.homepage);
    if (homepage.outcome !== "SUCCESS" || homepage.content.kind !== "HOMEPAGE")
      return unavailable;
    const slots = parsed.slots.map((slot) => {
      if (slot.status === "UNAVAILABLE") return slot;
      const { context, ...reference } = slot;
      const content = projectPublishedContent(context);
      if (content.outcome === "FAILURE") {
        if (slot.kind === "HERO_IDOL")
          throw new Error("Required hero is unavailable");
        return { ...reference, status: "UNAVAILABLE" as const };
      }
      return { ...reference, content };
    });
    return storefrontHomepageResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "STOREFRONT_HOMEPAGE",
      homepage,
      slots,
    });
  } catch {
    return unavailable;
  }
}
