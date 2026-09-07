import {
  supportedLocaleSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import type en from "./en.js";
import { storefrontCopyReviews } from "./review-manifest.js";

export type StorefrontCopy = Readonly<Record<keyof typeof en, string>>;

async function catalogForLocale(
  locale: SupportedLocale,
): Promise<StorefrontCopy> {
  switch (locale) {
    case "en":
      return (await import("./en.js")).default;
    case "zh-CN":
      return (await import("./zh-CN.js")).default;
    case "th":
      return (await import("./th.js")).default;
    case "vi":
      return (await import("./vi.js")).default;
    case "ja":
      return (await import("./ja.js")).default;
    case "es":
      return (await import("./es.js")).default;
    case "pt":
      return (await import("./pt.js")).default;
  }
}

async function catalogHash(copy: StorefrontCopy): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(copy)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function assertApprovedReview(
  locale: SupportedLocale,
  sourceHash: string,
  translationHash: string,
): void {
  const review = storefrontCopyReviews[locale];
  if (
    review?.schemaVersion !== 1 ||
    review.namespace !== "storefront" ||
    review.locale !== locale ||
    review.status !== "APPROVED" ||
    !review.reviewer?.trim() ||
    !review.approvedCommit ||
    !/^[a-f0-9]{40}$/u.test(review.approvedCommit) ||
    review.sourceHash !== sourceHash ||
    review.translationHash !== translationHash
  )
    throw new Error("STOREFRONT_MESSAGES_UNAPPROVED");
}

/** Local work may display drafts; production callers require exact human-review evidence. */
export async function loadStorefrontCopy(
  locale: SupportedLocale,
  { requireApproved = false }: Readonly<{ requireApproved?: boolean }> = {},
): Promise<StorefrontCopy> {
  const canonical = supportedLocaleSchema.parse(locale);
  const copy = await catalogForLocale(canonical);
  if (requireApproved) {
    const source = canonical === "en" ? copy : await catalogForLocale("en");
    const sourceHash = await catalogHash(source);
    assertApprovedReview("en", sourceHash, sourceHash);
    if (canonical !== "en") {
      assertApprovedReview(canonical, sourceHash, await catalogHash(copy));
    }
  }
  return copy;
}
