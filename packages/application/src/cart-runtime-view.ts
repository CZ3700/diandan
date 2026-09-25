import {
  cartRuntimeItemRecordSchema,
  type CartRuntimeAddCommand,
  type CartRuntimeHeader,
  type StorefrontGiftResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { projectCartRuntimeView } from "@fan-support/cart";
import {
  CartRuntimeRepositoryError,
  type CartRuntimeRepositories,
} from "@fan-support/persistence-port";
import { createStorefrontCommerceUseCases } from "./storefront-commerce.js";

export async function readCartRuntimeGift(
  repos: Pick<CartRuntimeRepositories, "cartRuntime" | "storefrontCommerce">,
  cart: CartRuntimeHeader,
  locale: SupportedLocale,
  target: { giftId: string; giftVariantId: string; idolId: string },
): Promise<StorefrontGiftResponse> {
  const resolved = await repos.cartRuntime.resolveGiftHandle({
    schemaVersion: 1,
    giftId: target.giftId as CartRuntimeAddCommand["giftId"],
    giftVariantId:
      target.giftVariantId as CartRuntimeAddCommand["giftVariantId"],
  });
  if (!resolved)
    return { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" };
  // Bind the established publication/price validator to this already-open write transaction.
  const reader = createStorefrontCommerceUseCases({
    transactions: {
      runInStorefrontCommerceTransaction: (work) =>
        work({ storefrontCommerce: repos.storefrontCommerce }),
    },
  });
  const current = await reader.readGift({
    schemaVersion: 1,
    handle: resolved.handle,
    locale,
    market: cart.market,
    currency: cart.currency,
    idolId: target.idolId,
  });
  if (current.outcome === "FAILURE" && current.code === "CONTENT_UNAVAILABLE")
    throw new CartRuntimeRepositoryError(current.code);
  return current;
}
export async function readCartRuntimeView(
  repos: Pick<CartRuntimeRepositories, "cartRuntime" | "storefrontCommerce">,
  cart: CartRuntimeHeader,
  locale: SupportedLocale,
) {
  const stored = await repos.cartRuntime.listItems({
    schemaVersion: 1,
    cartId: cart.id,
  });
  const items = [];
  for (const row of stored) {
    const item = cartRuntimeItemRecordSchema.parse(row);
    items.push({
      item,
      current: await readCartRuntimeGift(repos, cart, locale, item),
    });
  }
  return projectCartRuntimeView({
    schemaVersion: 1,
    cart,
    presentationLocale: locale,
    items,
  });
}
