import {
  currencySchema,
  marketSchema,
  idolIdSchema,
  giftVariantIdSchema,
  type CurrencyCode,
  type MarketCode,
  type IdolId,
  type GiftVariantId,
} from "@fan-support/contracts";
export {
  giftSelectionHref,
  giftCanonicalPath,
  selectGiftOffer,
} from "./gift-selection-values";

type Values = Readonly<Record<string, string | string[] | undefined>>;
type Selection =
  | Readonly<{
      kind: "VALID";
      market: MarketCode;
      currency: CurrencyCode;
      idolId?: IdolId;
      variantId?: GiftVariantId;
    }>
  | Readonly<{ kind: "CONTEXT_REQUIRED" | "INVALID_QUERY" }>;

export function parseGiftSelection(values: Values): Selection {
  const idol =
    values["idol"] === undefined
      ? undefined
      : idolIdSchema.safeParse(values["idol"]);
  const variant =
    values["variant"] === undefined
      ? undefined
      : giftVariantIdSchema.safeParse(values["variant"]);
  if (idol?.success === false || variant?.success === false)
    return { kind: "INVALID_QUERY" };
  if (values["market"] === undefined && values["currency"] === undefined)
    return { kind: "CONTEXT_REQUIRED" };
  const market = marketSchema.safeParse(values["market"]);
  const currency = currencySchema.safeParse(values["currency"]);
  if (!market.success || !currency.success) return { kind: "INVALID_QUERY" };
  return {
    kind: "VALID",
    market: market.data,
    currency: currency.data,
    ...(idol?.success ? { idolId: idol.data } : {}),
    ...(variant?.success ? { variantId: variant.data } : {}),
  };
}

/** Recover a browse URL without carrying malformed selectors into another request. */
export function giftRecoveryQuery(contextQuery: string): string {
  const query = new URLSearchParams(contextQuery);
  for (const field of [
    "page",
    "pageSize",
    "category",
    "sort",
    "priceMinMinor",
    "priceMaxMinor",
    "availability",
    "variant",
  ])
    query.delete(field);
  for (const [field, schema] of [
    ["market", marketSchema],
    ["currency", currencySchema],
    ["idol", idolIdSchema],
  ] as const) {
    if (
      query.has(field) &&
      (query.getAll(field).length !== 1 ||
        !schema.safeParse(query.get(field)).success)
    )
      query.delete(field);
  }
  return query.toString();
}
