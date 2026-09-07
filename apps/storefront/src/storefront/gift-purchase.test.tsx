import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  storefrontGiftResponseSchema,
  storefrontGiftRecipientSchema,
  type StorefrontGiftOffer,
  type StorefrontGiftRecipient,
} from "@fan-support/contracts";
import copy from "../../../../packages/i18n/src/storefront/en";
import { GiftPurchase } from "./gift-purchase";
import * as quantity from "./gift-quantity";

vi.mock("server-only", () => ({}));

const variantId = "2abc0000-0000-4000-8000-000000000001";
const idolId = "30000000-0000-4000-8000-000000000001";
const localeContext = {
  schemaVersion: 1,
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
} as const;
const media = {
  schemaVersion: 1,
  kind: "INFORMATIVE",
  url: "https://media.example.test/processed/v1/source/variant.webp",
  alt: "Fictional test photograph",
  width: 1000,
  height: 1000,
  focalPoint: { x: 0.5, y: 0.5 },
} as const;
const selectedRecipient = storefrontGiftRecipientSchema.parse({
  kind: "PUBLISHED",
  idol: {
    schemaVersion: 1,
    id: idolId,
    handle: "fictional-recipient",
    status: "active",
    acceptingGifts: true,
    localeContext,
    displayName: "Fictional recipient",
    portrait: media,
  },
});

function fixture(
  overrides: Partial<StorefrontGiftOffer> = {},
  recipient: StorefrontGiftRecipient = selectedRecipient,
) {
  const offer = {
    giftVariantId: variantId,
    price: {
      priceId: "40000000-0000-4000-8000-000000000001",
      priceRevision: 2,
      unitAmountMinor: 1200,
    },
    availability: "AVAILABLE",
    reason: null,
    requiresRecipient: recipient.kind === "NONE",
    stock: { kind: "TRACKED", availableQuantity: 3 },
    maxQuantity: 3,
    ...overrides,
  };
  const parsed = storefrontGiftResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_GIFT",
    publication: {
      id: "50000000-0000-4000-8000-000000000001",
      revisionId: "60000000-0000-4000-8000-000000000001",
      manifestHash: "a".repeat(64),
      publishedAt: "2026-09-07T00:00:00.000Z",
    },
    classification: {
      kind: "CLASSIFIED",
      giftKind: "WISH",
      profileHash: "b".repeat(64),
    },
    market: "TEST",
    currency: "USD",
    recipient,
    offers: [offer],
    content: {
      kind: "GIFT",
      details: {
        format: "LEGACY_TEXT",
        text: "A fictional test gift description",
      },
      view: {
        schemaVersion: 1,
        id: "10000000-0000-4000-8000-000000000001",
        handle: "fictional-gift",
        status: "active",
        localeContext,
        title: "Fictional gift",
        subtitle: "A gift for an artist",
        shortDescription: "A fictional gift",
        description: "A fictional test gift description",
        fulfillmentDescription:
          "The studio prepares and delivers it to the artist.",
        category: "OTHER",
        contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        shippingMode: "internal_to_idol",
        primaryMedia: media,
        gallery: [],
        variants: [
          {
            schemaVersion: 1,
            id: variantId,
            label: "Fictional option",
            status: "active",
            inventoryPolicy: offer.stock.kind,
          },
        ],
        safetyNotice: "Fictional test only",
        seoTitle: "Fictional gift",
        seoDescription: "A fictional gift description",
      },
    },
  });
  if (parsed.outcome !== "SUCCESS")
    throw new Error("Expected a valid success fixture");
  return parsed;
}

function render(gift: ReturnType<typeof fixture>, variant?: string) {
  const html = renderToStaticMarkup(
    <GiftPurchase
      gift={gift}
      locale="en"
      copy={copy}
      contextQuery={`market=TEST&currency=USD&idol=${idolId}&cart=preserved`}
      {...(variant ? { variantId: variant } : {})}
    />,
  );
  const checkout = html.match(
    /<button\b[^>]*data-checkout-unavailable[^>]*>/u,
  )?.[0];
  expect(checkout).toBeDefined();
  expect(checkout).toContain('disabled=""');
  expect(checkout).toContain('aria-describedby="gift-checkout-explanation"');
  expect(html).toContain(copy.giftCheckoutBody);
  expect(html).not.toMatch(/href="[^"]*\/checkout/u);
  return html;
}

describe("gift purchase presentation against canonical offer contracts", () => {
  it("keeps offer, price and ICU presentation outside the client entry", () => {
    const source = readFileSync(
      new URL("./gift-purchase.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/^["']use client["'];/u);
    expect(source).toContain('import "server-only"');
  });
  it("only sends the quantity ceiling and three labels to the interactive boundary", () => {
    const client = vi.spyOn(quantity, "GiftQuantity");
    try {
      render(fixture());
      expect(client).toHaveBeenCalledOnce();
      expect(client.mock.calls[0]?.[0]).toEqual({
        max: 3,
        label: copy.giftQuantity,
        decreaseLabel: copy.giftQuantityDecrease,
        increaseLabel: copy.giftQuantityIncrease,
      });
      const source = readFileSync(
        new URL("./gift-quantity.tsx", import.meta.url),
        "utf8",
      );
      expect(source).toMatch(/^["']use client["'];/u);
      expect(source).not.toContain("@fan-support/contracts");
      expect(source).not.toContain("./copy");
      expect(source).not.toContain("@fan-support/i18n");
    } finally {
      client.mockRestore();
    }
  });
  it("exposes variant links as a named group", () => {
    const html = render(fixture());
    expect(html).toContain(
      `class="gift-variant-options" role="group" aria-label="${copy.giftVariant}"`,
    );
  });
  it.each([
    ["TRACKED", copy.giftTracked, "AVAILABLE", 3],
    [
      "PROCURE_ON_DEMAND",
      copy.giftProcureOnDemand,
      "AVAILABLE",
      Number.MAX_SAFE_INTEGER,
    ],
    ["PREORDER", copy.giftPreorder, "PREORDER", Number.MAX_SAFE_INTEGER],
  ] as const)(
    "renders %s independently of the gift kind with its real quantity ceiling",
    (kind, label, availability, maxQuantity) => {
      const stock =
        kind === "TRACKED" ? { kind, availableQuantity: 3 } : { kind };
      const html = render(fixture({ stock, availability, maxQuantity }));
      expect(html).toContain(`data-inventory-policy="${kind}"`);
      expect(html).toContain(`data-availability="${availability}"`);
      expect(html).toContain(label);
      expect(html).toContain('value="1200"');
      expect(html).toContain("$12.00");
      expect(html).toContain('role="spinbutton"');
      expect(html).toContain(`aria-valuemax="${maxQuantity}"`);
      expect(html).toContain('aria-valuemin="1"');
      if (kind === "TRACKED") expect(html).toContain("data-stock-remaining");
      else {
        expect(html).not.toContain("data-stock-remaining");
        expect(html).not.toContain(copy.giftSoldOut);
      }
    },
  );

  it("shows a real starting price before recipient selection but no editable quantity", () => {
    const html = render(fixture({}, { kind: "NONE" }));
    expect(html).toContain(copy.giftPriceStartingAt);
    expect(html).toContain(copy.giftRecipientMissing);
    expect(html).toContain("$12.00");
    expect(html).not.toContain('role="spinbutton"');
  });

  it("sold-out tracked stock keeps the known price and exposes no selectable quantity", () => {
    const html = render(
      fixture({
        availability: "UNAVAILABLE",
        reason: "OUT_OF_STOCK",
        stock: { kind: "TRACKED", availableQuantity: 0 },
        maxQuantity: 0,
      }),
    );
    expect(html).toContain(copy.giftSoldOut);
    expect(html).toContain("$12.00");
    expect(html).not.toContain('role="spinbutton"');
    expect(html).not.toContain("data-stock-remaining");
  });

  it("missing price never becomes a zero price or a purchasable quantity", () => {
    const html = render(
      fixture({
        availability: "UNAVAILABLE",
        reason: "PRICE_UNAVAILABLE",
        price: null,
        maxQuantity: 0,
      }),
    );
    expect(html).toContain(copy.giftNotAvailable);
    expect(html).not.toContain('class="fs-price"');
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain('role="spinbutton"');
  });

  it("unknown variants stay unselected rather than substituting the first available offer", () => {
    const html = render(fixture(), "20000000-0000-4000-8000-000000000099");
    expect(html).toContain(copy.giftNotAvailable);
    expect(html).not.toContain("data-gift-offer");
    expect(html).not.toContain('aria-current="true"');
    expect(html).not.toContain('class="fs-price"');
    expect(html).not.toContain('role="spinbutton"');
    expect(html).toContain(`variant=${variantId}`);
    expect(html).toContain(`idol=${idolId}`);
    expect(html).toContain("cart=preserved");
  });

  it("selects a matching variant case-insensitively", () => {
    const gift = fixture();
    const html = render(gift, gift.offers[0]!.giftVariantId.toUpperCase());
    expect(html).toContain("data-gift-offer");
    expect(html).toContain('aria-current="true"');
  });

  it("an incompatible recipient gets the specific explanation without a quantity selector", () => {
    const html = render(
      fixture({
        availability: "UNAVAILABLE",
        reason: "NOT_ELIGIBLE",
        maxQuantity: 0,
      }),
    );
    expect(html).toContain(copy.giftRecipientIneligible);
    expect(html).not.toContain('role="spinbutton"');
  });

  it("a paused published recipient is distinguished from an unavailable recipient", () => {
    if (selectedRecipient.kind !== "PUBLISHED")
      throw new Error("Expected published test recipient");
    const recipient: StorefrontGiftRecipient = {
      kind: "PUBLISHED",
      idol: {
        ...selectedRecipient.idol,
        status: "paused",
        acceptingGifts: false,
      },
    };
    const html = render(
      fixture(
        {
          availability: "UNAVAILABLE",
          reason: "RECIPIENT_UNAVAILABLE",
          maxQuantity: 0,
        },
        recipient,
      ),
    );
    expect(html).toContain(copy.artistPaused);
    expect(html).not.toContain('role="spinbutton"');
  });
});
