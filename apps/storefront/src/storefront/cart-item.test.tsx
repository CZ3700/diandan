import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CartRuntimeItemView } from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import { CartItem } from "./cart-item";
import { createCartSession } from "./cart-session";
vi.mock("./published-image", () => ({
  PublishedImage: ({
    media,
  }: {
    media: { alt: string; localeContext?: { resolvedLocale: string } };
  }) => (
    <span
      role="img"
      aria-label={media.alt}
      lang={media.localeContext?.resolvedLocale}
    />
  ),
}));
const media = (locale: string) => ({
  schemaVersion: 2,
  alt: "Photo",
  localeContext: { resolvedLocale: locale },
});
const item = {
  schemaVersion: 1,
  id: "10000000-0000-4000-8000-000000000001",
  version: 1,
  quantity: 2,
  displayMode: "nickname",
  nicknameProvided: true,
  hasFanMessage: true,
  idol: {
    handle: "idol",
    displayName: "Artist original",
    portrait: media("ja"),
    localeContext: { resolvedLocale: "th" },
  },
  gift: {
    handle: "gift",
    title: "Gift original",
    variantLabel: "Option",
    primaryMedia: media("zh-CN"),
    localeContext: { resolvedLocale: "vi" },
  },
  price: {
    status: "UNAVAILABLE",
    observedPriceId: "20000000-0000-4000-8000-000000000001",
    current: null,
  },
  availability: {
    status: "UNAVAILABLE",
    reason: "PRICE_UNAVAILABLE",
    maxQuantity: 0,
  },
} as unknown as CartRuntimeItemView;
describe("cart row preserves current public facts", () => {
  it("renders all four source languages independently, without fabricated price or plaintext", () => {
    const html = renderToStaticMarkup(
      <CartItem
        item={item}
        cartVersion={1}
        currency={"USD" as never}
        locale="en"
        copy={copy}
        session={createCartSession("en")}
      />,
    );
    for (const locale of ["ja", "th", "zh-CN", "vi"])
      expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(copy.cartSavedMessage);
    expect(html).toContain(copy.cartSavedName);
    expect(html).not.toContain("$0");
    expect(html).not.toMatch(/href=.*(?:idol|gift)/u);
    expect(html).not.toContain("textarea");
  });
  it("retains removal and edit controls when both public objects become unavailable", () => {
    const html = renderToStaticMarkup(
      <CartItem
        item={{ ...item, gift: null, idol: null }}
        cartVersion={2}
        currency={"USD" as never}
        locale="en"
        copy={copy}
        session={createCartSession("en")}
      />,
    );
    expect(html).toContain("data-cart-remove");
    expect(html).toContain("data-cart-editor-open");
    expect(html).toContain(copy.cartUnavailable);
  });
});

it("shows the selected gallery visibility and keeps wish quantity fixed in the bag", () => {
  const html = renderToStaticMarkup(
    <CartItem
      item={{
        ...item,
        quantity: 1,
        galleryPreference: { visibility: "PUBLIC_ANONYMOUS" },
      }}
      cartVersion={1}
      currency={"USD" as never}
      locale="en"
      copy={copy}
      session={createCartSession("en")}
    />,
  );
  expect(html).toContain(copy.wishRecordPlanned);
  expect(html).toContain(copy.wishDisplayAnonymous);
  expect(html).not.toContain("data-cart-quantity-save");
  expect(html).toContain("data-cart-editor-open");
});
