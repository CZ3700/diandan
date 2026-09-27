import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import en from "../../../../packages/i18n/src/storefront/en";
import zh from "../../../../packages/i18n/src/storefront/zh-CN";
import { GiftAdd, giftCheckoutHref } from "./gift-add";

const props = {
  giftId: "10000000-0000-4000-8000-000000000001",
  giftVariantId: "10000000-0000-4000-8000-000000000002",
  idolId: "10000000-0000-4000-8000-000000000003",
  observedPriceId: "10000000-0000-4000-8000-000000000004",
  market: "GLOBAL",
  currency: "USD",
  max: 5,
};

it.each([
  ["en", en],
  ["zh-CN", zh],
] as const)(
  "offers buying now as the primary action beside adding to the bag in %s",
  (locale, copy) => {
    const html = renderToStaticMarkup(
      <GiftAdd {...props} locale={locale} copy={copy} />,
    );
    const buy = html.indexOf("data-cart-buy-now");
    const add = html.indexOf("data-cart-add-state");
    expect(buy).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(buy);
    expect(html).toContain(copy.cartBuyNow);
    expect(html).toContain(copy.cartAdd);
    // Buying now is a plain button; Enter in the form still adds to the bag as before.
    expect(html).toMatch(
      /<button[^>]*class="storefront-primary gift-buy-now"[^>]*type="button"[^>]*data-cart-buy-now/u,
    );
    expect(html).toMatch(
      /<button[^>]*class="gift-add-secondary cart-add-button"[^>]*type="submit"/u,
    );
  },
);

it("sends a successful buy-now straight to the checkout of the same locale", () => {
  expect(giftCheckoutHref("zh-CN")).toBe("/zh-CN/checkout");
  expect(giftCheckoutHref("en")).toBe("/en/checkout");
});
