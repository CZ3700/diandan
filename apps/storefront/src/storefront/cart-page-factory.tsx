import "server-only";
import type { Metadata } from "next";
import type { SupportedLocale } from "@fan-support/contracts";
import {
  loadStorefrontRuntimeConfig,
  loadStorefrontPresentationConfig,
} from "../server/runtime-config";
import { loadStorefrontCopy } from "../server/storefront-copy";
import { queryString } from "./navigation";
import {
  StorefrontPageShell,
  type StorefrontPageProps,
} from "./storefront-page-shell";
import { CartPanel } from "./cart-panel";
export function createCartPage(locale: SupportedLocale) {
  return async function CartPage({ searchParams }: StorefrontPageProps) {
    loadStorefrontRuntimeConfig();
    const copy = await loadStorefrontCopy(locale);
    const contextQuery = queryString(await searchParams);
    return (
      <StorefrontPageShell
        locale={locale}
        copy={copy}
        name={loadStorefrontPresentationConfig().name}
        contextQuery={contextQuery}
        active="other"
      >
        <div className="storefront-section cart-page">
          <p className="storefront-eyebrow">{copy.giftEyebrow}</p>
          <h1>{copy.bag}</h1>
          <CartPanel
            locale={locale}
            copy={copy}
            contextQuery={contextQuery}
            page
          />
        </div>
      </StorefrontPageShell>
    );
  };
}
export function createCartMetadata(locale: SupportedLocale) {
  return async (): Promise<Metadata> => ({
    title: (await loadStorefrontCopy(locale)).bag,
    robots: { index: false, follow: false },
  });
}
