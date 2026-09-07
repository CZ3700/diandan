import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import en from "./en.review.js";
import zh from "./zh-CN.review.js";
import th from "./th.review.js";
import vi from "./vi.review.js";
import ja from "./ja.review.js";
import es from "./es.review.js";
import pt from "./pt.review.js";

export type StorefrontCopyReview = Readonly<{
  schemaVersion: 1;
  namespace: "storefront";
  locale: SupportedLocale;
  status: "DRAFT" | "APPROVED";
  sourceHash: string;
  translationHash: string;
  reviewer: string | null;
  approvedCommit: string | null;
}>;

function reviewForLocale(locale: SupportedLocale): StorefrontCopyReview {
  switch (locale) {
    case "en":
      return en;
    case "zh-CN":
      return zh;
    case "th":
      return th;
    case "vi":
      return vi;
    case "ja":
      return ja;
    case "es":
      return es;
    case "pt":
      return pt;
  }
}

export const storefrontCopyReviews = Object.freeze(
  Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, reviewForLocale(locale)]),
  ),
) as Readonly<Record<SupportedLocale, StorefrontCopyReview>>;
