import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import { IntlMessageFormat } from "intl-messageformat";
import en from "./en.js";
import zh from "./zh-CN.js";
import th from "./th.js";
import vi from "./vi.js";
import ja from "./ja.js";
import es from "./es.js";
import pt from "./pt.js";
import { adminMessageReviews } from "./review-manifest.js";
export { adminMessageReviews } from "./review-manifest.js";

export type AdminMessageKey = keyof typeof en;
function catalogForLocale(
  locale: SupportedLocale,
): Readonly<Record<AdminMessageKey, string>> {
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
export const adminMessages = Object.freeze(
  Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, catalogForLocale(locale)]),
  ),
) as Readonly<
  Record<SupportedLocale, Readonly<Record<AdminMessageKey, string>>>
>;
const compiled = new Map<string, IntlMessageFormat>();
export function adminMessage(
  locale: SupportedLocale,
  key: AdminMessageKey,
  values: Record<string, string | number> = {},
): string {
  const cacheKey = `${locale}:${key}`;
  let message = compiled.get(cacheKey);
  if (!message) {
    message = new IntlMessageFormat(adminMessages[locale][key], locale);
    compiled.set(cacheKey, message);
  }
  return String(message.format(values));
}
/** Local TEST workspaces may display draft copy; a release must supply real human review evidence. */
export function assertAdminMessagesPublishable(locale: SupportedLocale): void {
  const review: {
    status: string;
    reviewer: string | null;
    approvedCommit: string | null;
  } = adminMessageReviews[locale];
  if (
    review.status !== "APPROVED" ||
    !review.reviewer ||
    !review.approvedCommit
  )
    throw new Error("ADMIN_MESSAGES_UNAPPROVED");
}
