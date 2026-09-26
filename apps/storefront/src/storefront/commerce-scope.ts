import type {
  CurrencyCode,
  MarketCode,
  StorefrontContextResponse,
} from "@fan-support/contracts";

export type CommerceScope = Readonly<{
  market: MarketCode;
  currency: CurrencyCode;
}>;
type SearchValues = Readonly<Record<string, string | string[] | undefined>>;

/**
 * V2 plan §4-2 (ADR-017 addendum): with exactly one published market and currency there is
 * nothing for a fan to choose, so that pair is the scope. Any second market or currency, or
 * an unavailable context, restores the explicit choice. Nothing is derived from language.
 */
export function soleCommerceScope(
  context: StorefrontContextResponse,
): CommerceScope | undefined {
  if (context.outcome !== "SUCCESS" || context.markets.length !== 1)
    return undefined;
  const [only] = context.markets;
  return only?.currencies.length === 1 && only.currencies[0] !== undefined
    ? { market: only.market, currency: only.currencies[0] }
    : undefined;
}

/** Scopes a request that named no market; an explicit (even invalid) choice always wins. */
export function withSoleScope(
  values: SearchValues,
  scope: CommerceScope | undefined,
): SearchValues {
  if (
    scope === undefined ||
    values["market"] !== undefined ||
    values["currency"] !== undefined
  )
    return values;
  return { ...values, market: scope.market, currency: scope.currency };
}
