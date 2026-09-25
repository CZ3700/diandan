import type {
  SupportedLocale,
  PaymentConfigurationIssue,
} from "@fan-support/contracts";
import { paymentCopy } from "./copy";
export const languageName = (
  locale: SupportedLocale,
  uiLocale: SupportedLocale,
) =>
  new Intl.DisplayNames([uiLocale], { type: "language" }).of(locale) ?? locale;
export function issueLabel(
  code: PaymentConfigurationIssue["code"],
  locale: SupportedLocale,
) {
  const c = paymentCopy(locale);
  switch (code) {
    case "EMPTY_ROUTES":
      return c.emptyRoutes;
    case "ACCOUNT_UNAVAILABLE":
      return c.accountUnavailable;
    case "ADAPTER_UNAVAILABLE":
      return c.adapterUnavailable;
    case "UNSUPPORTED_METHOD":
      return c.unsupportedMethod;
    case "INVALID_ROUTE":
      return c.invalidRoute;
    case "TRANSLATION_MISSING":
      return c.translationMissing;
    case "TRANSLATION_UNAPPROVED":
      return c.translationUnapproved;
    case "TRANSLATION_STALE":
      return c.translationStale;
    case "HEALTH_POLICY_INVALID":
      return c.healthInvalid;
    case "NOT_PREVIOUSLY_PUBLISHED":
      return c.notPublished;
  }
}
