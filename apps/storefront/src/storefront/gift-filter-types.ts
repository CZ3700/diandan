import type {
  GiftDiscoveryQuery,
  SupportedLocale,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import type { GiftScopeInUrl } from "./gift-query";

export type GiftFilterDraft = Readonly<{
  sort: GiftDiscoveryQuery["sort"];
  kind: string;
  category: string;
  availability: GiftDiscoveryQuery["availability"];
  minimum: string;
  maximum: string;
}>;

export type GiftFilterProps = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  query: GiftDiscoveryQuery;
  contextQuery: string;
  basePath: string;
  scope?: GiftScopeInUrl;
}>;

export type GiftFilterClientProps = GiftFilterProps &
  Readonly<{
    initialDraft: GiftFilterDraft;
    resetHref: string;
    recoveryHref: string;
    hint: string;
    sortOptions: ReadonlyArray<
      Readonly<{
        value: GiftDiscoveryQuery["sort"];
        label: string;
        href: string;
      }>
    >;
    appliedFilters: ReadonlyArray<string>;
    kindOptions: ReadonlyArray<
      Readonly<{
        value: NonNullable<GiftDiscoveryQuery["kind"]>;
        label: string;
      }>
    >;
  }>;
