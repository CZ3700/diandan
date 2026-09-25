import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import copy from "../../../../packages/i18n/src/storefront/en";
import { CartBody } from "./cart-body";
import { CartProvider } from "./cart-provider";

it("keeps one named page landmark when the same cart is also open in its labeled dialog", () => {
  const html = renderToStaticMarkup(
    <CartProvider locale="en">
      <CartBody locale="en" copy={copy} contextQuery="" page />
      <div role="dialog" aria-label={copy.bag}>
        <CartBody locale="en" copy={copy} contextQuery="" />
      </div>
    </CartProvider>,
  );
  expect(html.match(/<section[^>]*aria-label="Gift bag"/gu)).toHaveLength(1);
  expect(html).toMatch(/<div[^>]*class="cart-contents"[^>]*data-cart-root/gu);
  expect(html.match(/tabindex="-1"/gu)).toHaveLength(2);
  expect(html.match(/data-cart-root=/gu)).toHaveLength(2);
  expect(html.match(/data-cart-announcement=/gu)).toHaveLength(2);
});
