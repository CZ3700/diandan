import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import copy from "../../../../packages/i18n/src/storefront/en";
const state = vi.hoisted(() => ({ empty: false, locked: false }));
vi.mock("./cart-provider", () => ({
  useCartSession: () => ({ read: vi.fn() }),
  useCartSnapshot: () => ({
    status: "ready",
    cart: {
      version: 2,
      status: state.locked ? "LOCKED" : "ACTIVE",
      currency: "USD",
      market: "TEST",
      items: state.empty
        ? []
        : [
            {
              id: "test",
              quantity: 1,
              price: { current: { lineTotalMinor: 1 } },
              availability: { status: "AVAILABLE" },
            },
          ],
    },
  }),
}));
vi.mock("./cart-item", () => ({ CartItem: () => null }));
import { CartBody } from "./cart-body";
it("opens checkout in the same UI locale for active and locked bags without leaking unrelated query", () => {
  for (const locked of [false, true]) {
    state.empty = false;
    state.locked = locked;
    const html = renderToStaticMarkup(
      <CartBody
        locale="ja"
        copy={copy}
        contextQuery="market=TEST&state=secret"
        page
      />,
    );
    expect(html).toContain('href="/ja/checkout"');
    expect(html).not.toContain('href="/ja/checkout?');
  }
});
it("does not offer an empty bag as ready for checkout", () => {
  state.empty = true;
  const html = renderToStaticMarkup(
    <CartBody locale="en" copy={copy} contextQuery="" page />,
  );
  expect(html).not.toContain('href="/en/checkout"');
});
