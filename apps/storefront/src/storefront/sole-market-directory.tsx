import "server-only";
import type { ReactNode } from "react";
import type {
  GiftDirectoryResponse,
  GiftDiscoveryQuery,
  StorefrontContextResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import { withSoleScope } from "./commerce-scope";
import { giftDirectoryRead } from "./gift-page-reads";
import { prepareGiftQuery } from "./gift-query";
import { queryString } from "./navigation";
import { readSoleCommerceScope } from "./sole-scope-read";

export type PricedGiftDirectory = Readonly<{
  initial: Extract<GiftDirectoryResponse, { outcome: "SUCCESS" }>;
  query: GiftDiscoveryQuery;
  /** Navigation context without the implicit scope; links built from it stay canonical. */
  contextQuery: string;
}>;
/** Each page supplies its own presentation, so the home never loads the full filter UI. */
export type PricedGiftDirectoryRenderer = (
  priced: PricedGiftDirectory,
) => ReactNode;

/**
 * ADR-017 addendum, phase two: an unscoped directory is priced in place once the context confirms
 * a single published market and currency. Several markets, an unavailable context or a failed
 * priced read keep the content directory this replaces. The scope never enters links.
 */
export async function SoleMarketGiftDirectory({
  locale,
  values,
  fallback,
  context,
  render,
}: Readonly<{
  locale: SupportedLocale;
  values: Readonly<Record<string, string | string[] | undefined>>;
  fallback: ReactNode;
  context?:
    StorefrontContextResponse | Promise<StorefrontContextResponse> | undefined;
  render: PricedGiftDirectoryRenderer;
}>): Promise<ReactNode> {
  const scope = await readSoleCommerceScope(context);
  if (!scope) return fallback;
  const prepared = prepareGiftQuery(locale, withSoleScope(values, scope));
  if (!prepared.valid) return fallback;
  const initial = await Promise.resolve()
    .then(() => giftDirectoryRead(prepared.apiQuery))
    .catch(() => undefined);
  if (initial?.outcome !== "SUCCESS") return fallback;
  return render({
    initial,
    query: prepared.query,
    contextQuery: queryString(values),
  });
}
