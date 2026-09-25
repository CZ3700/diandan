import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  currencySchema,
  publicMediaUrlSchema,
  storefrontGiftOfferSchema,
  type PublishedGiftView,
} from "@fan-support/contracts";
import {
  createProductJsonLd,
  exactSeoPrice,
  JsonLd,
  createPageJsonLd,
} from "./seo-structured-data";

const gift: Pick<
  PublishedGiftView,
  "title" | "shortDescription" | "primaryMedia" | "localeContext"
> = {
  title: "Studio gift </script><script>alert(1)</script>",
  shortDescription: "Prepared for an artist",
  localeContext: {
    schemaVersion: 1,
    requestedLocale: "ja",
    resolvedLocale: "ja",
    fallbackUsed: false,
  },
  primaryMedia: {
    schemaVersion: 1,
    kind: "INFORMATIVE",
    url: publicMediaUrlSchema.parse("https://media.test/gift.webp"),
    alt: "Gift",
    width: 1200,
    height: 1200,
    focalPoint: { x: 0.5, y: 0.5 },
  },
};
const offer = storefrontGiftOfferSchema.parse({
  giftVariantId: "a1000000-0000-4000-8000-000000000001",
  price: {
    priceId: "a2000000-0000-4000-8000-000000000001",
    priceRevision: 1,
    unitAmountMinor: Number.MAX_SAFE_INTEGER,
  },
  availability: "AVAILABLE",
  reason: null,
  requiresRecipient: true,
  stock: { kind: "PROCURE_ON_DEMAND" },
  maxQuantity: Number.MAX_SAFE_INTEGER,
});
test("structured prices preserve minor-unit precision and currency exponent", () => {
  expect(
    exactSeoPrice(Number.MAX_SAFE_INTEGER, currencySchema.parse("USD")),
  ).toBe("90071992547409.91");
  expect(exactSeoPrice(105, currencySchema.parse("JPY"))).toBe("105");
  expect(exactSeoPrice(105, currencySchema.parse("KWD"))).toBe("0.105");
  expect(() => exactSeoPrice(-1, currencySchema.parse("USD"))).toThrow();
});
test("only the real visible offer is output, with no invented review or variant AggregateOffer", () => {
  const result = createProductJsonLd({
    url: "https://store.test/ja/gifts/studio?market=GLOBAL&currency=USD",
    gift,
    offer,
    currency: currencySchema.parse("USD"),
  });
  expect(result).toMatchObject({
    "@type": "Product",
    name: gift.title,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: "90071992547409.91",
      availability: "https://schema.org/InStock",
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /AggregateOffer|review|rating|priceValidUntil/,
  );
  expect(
    createProductJsonLd({ url: "https://store.test/ja/gifts/studio", gift }),
  ).not.toHaveProperty("offers");
});
test("preorder and depleted stock are distinct from repeatable procurement", () => {
  expect(
    createProductJsonLd({
      url: "https://store.test/ja/gifts/studio",
      gift,
      offer: {
        ...offer,
        availability: "PREORDER",
        stock: { kind: "PREORDER" },
      },
      currency: currencySchema.parse("USD"),
    }),
  ).toMatchObject({ offers: { availability: "https://schema.org/PreOrder" } });
  expect(
    createProductJsonLd({
      url: "https://store.test/ja/gifts/studio",
      gift,
      offer: {
        ...offer,
        availability: "UNAVAILABLE",
        reason: "OUT_OF_STOCK",
        maxQuantity: 0,
        stock: { kind: "TRACKED", availableQuantity: 0 },
      },
      currency: currencySchema.parse("USD"),
    }),
  ).toMatchObject({
    offers: { availability: "https://schema.org/OutOfStock" },
  });
  expect(
    createProductJsonLd({
      url: "https://store.test/ja/gifts/studio",
      gift,
      offer: {
        ...offer,
        availability: "UNAVAILABLE",
        reason: "NOT_ELIGIBLE",
        maxQuantity: 0,
      },
      currency: currencySchema.parse("USD"),
    }),
  ).not.toHaveProperty("offers");
});
test("fallback never advertises a Product offer", () => {
  expect(
    createProductJsonLd({
      url: "https://store.test/ja/gifts/studio",
      gift: {
        ...gift,
        localeContext: {
          schemaVersion: 1,
          requestedLocale: "ja",
          resolvedLocale: "en",
          fallbackUsed: true,
          translationRevision: "approved-source-v1",
        },
      },
      offer,
      currency: currencySchema.parse("USD"),
    }),
  ).toBeNull();
});
test("native JSON-LD cannot terminate its script with author supplied content", () => {
  const data = createProductJsonLd({
    url: "https://store.test/ja/gifts/studio",
    gift,
  });
  const html = renderToStaticMarkup(<JsonLd data={data} />);
  expect(html.match(/<script/g)).toHaveLength(1);
  expect(html).toContain("\\u003c/script>");
  const payload = html.slice(
    html.indexOf(">") + 1,
    html.lastIndexOf("</script>"),
  );
  expect(JSON.parse(payload).name).toBe(gift.title);
});
test("page language, configured site identity and real breadcrumbs are serializable", () => {
  const data = createPageJsonLd({
    url: "https://store.test/vi/idols/artist",
    origin: "https://store.test",
    locale: "vi",
    siteName: "Test studio",
    title: "Artist",
    description: "Profile",
    kind: "ProfilePage",
    breadcrumbs: [
      { name: "Home", url: "https://store.test/vi" },
      { name: "Artist", url: "https://store.test/vi/idols/artist" },
    ],
  });
  expect(data["@graph"]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ "@type": "ProfilePage", inLanguage: "vi" }),
      expect.objectContaining({ "@type": "Organization", name: "Test studio" }),
      expect.objectContaining({ "@type": "BreadcrumbList" }),
    ]),
  );
  expect(JSON.stringify(data)).not.toMatch(/taxID|legalName|address/);
});
