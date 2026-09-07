import type {
  StorefrontContextResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { giftSelectionHref } from "./gift-selection";
import { storefrontHref } from "./navigation";
import type { StorefrontCopy } from "./copy";

type Context = Extract<StorefrontContextResponse, { outcome: "SUCCESS" }>;
export function PolicyLinks({
  context,
  locale,
  copy,
  contextQuery,
  labelledBy,
}: Readonly<{
  context: StorefrontContextResponse;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  labelledBy?: string;
}>) {
  if (context.outcome !== "SUCCESS" || context.policies.length === 0)
    return null;
  const labels = {
    TERMS: copy.policyTerms,
    PRIVACY: copy.policyPrivacy,
    REFUND: copy.policyRefund,
    DELIVERY: copy.policyDelivery,
  };
  return (
    <nav
      className="gift-policy-links"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : copy.giftPolicies}
    >
      {context.policies.map((policy) => (
        <a
          key={policy.policyKey}
          href={storefrontHref(
            locale,
            `/policies/${policy.policyKey}`,
            contextQuery,
          )}
        >
          {labels[policy.kind]}
        </a>
      ))}
    </nav>
  );
}
export function isMarketAvailable(
  context: StorefrontContextResponse,
  market: string,
  currency: string,
): boolean {
  return (
    context.outcome === "SUCCESS" &&
    context.markets.some(
      (item) =>
        item.market === market &&
        item.currencies.some((code) => code === currency),
    )
  );
}

export function MarketChoices({
  context,
  locale,
  copy,
  contextQuery,
  path = "/gifts",
  headingLevel = 2,
}: Readonly<{
  context: StorefrontContextResponse;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  path?: string;
  headingLevel?: 1 | 2;
}>) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const selected = new URLSearchParams(contextQuery);
  return (
    <section className="gift-market-choices" data-market-choices>
      <Heading>{copy.marketChoose}</Heading>
      <p>{copy.marketChooseBody}</p>
      {context.outcome !== "SUCCESS" ? (
        <p role="status">{copy.contentErrorBody}</p>
      ) : context.markets.length === 0 ? (
        <p role="status">{copy.marketUnavailable}</p>
      ) : (
        <div className="gift-market-list">
          {context.markets.flatMap((market) =>
            market.currencies.map((currency) => (
              <a
                key={`${market.market}:${currency}`}
                data-market={market.market}
                data-currency={currency}
                aria-current={
                  selected.get("market") === market.market &&
                  selected.get("currency") === currency
                    ? "true"
                    : undefined
                }
                href={giftSelectionHref(locale, path, contextQuery, {
                  market: market.market,
                  currency,
                })}
              >
                <span>{market.market}</span>
                <span>
                  {new Intl.DisplayNames([locale], { type: "currency" }).of(
                    currency,
                  )}{" "}
                  <bdi>{currency}</bdi>
                </span>
              </a>
            )),
          )}
        </div>
      )}
    </section>
  );
}
export type StorefrontContext = Context;
