import {
  SUPPORTED_LOCALES,
  paymentConfigurationValidationInputSchema,
  type PaymentConfigurationValidationInput,
  type PaymentConfigurationValidationResult,
  type PaymentConfigurationIssue,
} from "@fan-support/contracts";
export { diffPaymentConfiguration } from "./payment-configuration-diff.js";
const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
function translationIssues(
  input: PaymentConfigurationValidationInput,
  channel: PaymentConfigurationValidationInput["configuration"]["channels"][number],
): PaymentConfigurationIssue[] {
  const reviews = input.reviews.filter((r) =>
    sameId(r.providerAccountId, channel.providerAccountId),
  );
  const source = reviews.find((r) => r.locale === "en")?.sourceHash;
  return SUPPORTED_LOCALES.flatMap((locale) => {
    const copy = channel.translations.find((t) => t.locale === locale);
    const review = reviews.find((r) => r.locale === locale);
    let code: PaymentConfigurationIssue["code"] | null = null;
    if (!copy) code = "TRANSLATION_MISSING";
    else if (
      !source ||
      copy.translatedFromSourceHash !== source ||
      review?.status === "STALE"
    )
      code = "TRANSLATION_STALE";
    else if (
      !review ||
      review.status !== "APPROVED" ||
      review.reviewerId === null ||
      sameId(review.editorId, review.reviewerId)
    )
      code = "TRANSLATION_UNAPPROVED";
    return code
      ? [
          {
            code,
            providerAccountId: channel.providerAccountId,
            ruleKey: null,
            locale,
          },
        ]
      : [];
  });
}
/** Pure readiness rules. Persisted review/source facts and deployed eligibility are supplied by the authorized transaction. */
export function validatePaymentConfiguration(
  raw: unknown,
): PaymentConfigurationValidationResult {
  const parsed = paymentConfigurationValidationInputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      schemaVersion: 1,
      valid: false,
      issues: [
        {
          code: "INVALID_ROUTE",
          providerAccountId: null,
          ruleKey: null,
          locale: null,
        },
      ],
    };
  const input = parsed.data;
  const config = input.configuration;
  const issues: PaymentConfigurationIssue[] = [];
  const add = (
    code: PaymentConfigurationIssue["code"],
    providerAccountId: PaymentConfigurationIssue["providerAccountId"] = null,
    ruleKey: string | null = null,
  ) => issues.push({ code, providerAccountId, ruleKey, locale: null });
  if (input.mode === "ROLLBACK" && !input.previouslyPublished)
    add("NOT_PREVIOUSLY_PUBLISHED");
  if (
    !config.routes.some(
      (r) =>
        r.enabled &&
        config.channels.some(
          (c) => sameId(c.providerAccountId, r.providerAccountId) && c.enabled,
        ),
    )
  )
    add("EMPTY_ROUTES");
  for (const channel of config.channels) {
    const account = input.accounts.find((a) =>
      sameId(a.providerAccountId, channel.providerAccountId),
    );
    if (!account || !account.deployed)
      add("ADAPTER_UNAVAILABLE", channel.providerAccountId);
    if (channel.enabled) {
      if (
        !account ||
        !["ACTIVE", "INTERNAL"].includes(account.accountStatus) ||
        (account.accountStatus === "INTERNAL" &&
          account.environment === "LIVE") ||
        account.merchantStatus !== "ACTIVE" ||
        account.healthStatus !== "HEALTHY"
      )
        add("ACCOUNT_UNAVAILABLE", channel.providerAccountId);
      issues.push(...translationIssues(input, channel));
    }
  }
  for (const route of config.routes) {
    const channel = config.channels.find((c) =>
      sameId(c.providerAccountId, route.providerAccountId),
    );
    const account = input.accounts.find((a) =>
      sameId(a.providerAccountId, route.providerAccountId),
    );
    if (
      !channel ||
      (route.enabled && !channel.enabled) ||
      route.countries.length === 0 ||
      route.markets.length === 0 ||
      route.currencies.length === 0 ||
      route.minimumAmountMinor > route.maximumAmountMinor
    )
      add("INVALID_ROUTE", route.providerAccountId, route.ruleKey);
    if (!account?.paymentMethods.includes(route.paymentMethod))
      add("UNSUPPORTED_METHOD", route.providerAccountId, route.ruleKey);
  }
  return { schemaVersion: 1, valid: issues.length === 0, issues };
}
