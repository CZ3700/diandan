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
type MessageReview = {
  readonly schemaVersion: 1;
  readonly namespace: "admin";
  readonly locale: SupportedLocale;
  readonly sourceHash: string;
  readonly translationHash: string;
  readonly translator: string;
  readonly reviewer: string | null;
  readonly status: "DRAFT" | "APPROVED";
  readonly approvedCommit: string | null;
  readonly templateVersion: string;
};
function reviewForLocale(locale: SupportedLocale): MessageReview {
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
export const adminMessageReviews = Object.freeze(
  Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, reviewForLocale(locale)]),
  ),
) as Readonly<Record<SupportedLocale, MessageReview>>;
