import {
  marketSchema,
  currencySchema,
  idolIdSchema,
  type SupportedLocale,
  type StorefrontNavigation,
} from "@fan-support/contracts";
import { storefrontHref } from "./navigation";

type NavigationTarget =
  StorefrontNavigation["header"][number] | "ORDER_LOOKUP" | "REGION";
const paths: Record<NavigationTarget, string> = {
  HOME: "/",
  ARTISTS: "/idols",
  GIFTS: "/gifts",
  ORDER_LOOKUP: "/orders/lookup",
  REGION: "/region",
};

/** Global destinations carry public browsing scope, never item or transaction credentials. */
export function navigationTargetHref(
  locale: SupportedLocale,
  target: NavigationTarget,
  currentSearch = "",
): string {
  if (target === "ORDER_LOOKUP") return storefrontHref(locale, paths[target]);
  return storefrontHref(
    locale,
    paths[target],
    publicNavigationQuery(currentSearch),
  );
}

export function publicNavigationQuery(currentSearch: string): string {
  const input = new URLSearchParams(currentSearch),
    output = new URLSearchParams();
  const single = (key: string) =>
    input.getAll(key).length === 1 ? input.get(key) : undefined;
  const market = marketSchema.safeParse(single("market"));
  const currency = currencySchema.safeParse(single("currency"));
  if (market.success && currency.success) {
    output.set("market", market.data);
    output.set("currency", currency.data);
  }
  const idol = idolIdSchema.safeParse(single("idol"));
  if (idol.success) output.set("idol", idol.data);
  return output.toString();
}
