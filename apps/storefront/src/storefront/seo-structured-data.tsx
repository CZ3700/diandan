import {
  currencySchema,
  minorAmountSchema,
  type CurrencyCode,
  type PublishedGiftView,
  type StorefrontGiftOffer,
  type SupportedLocale,
} from "@fan-support/contracts";

export function exactSeoPrice(amount: number, currency: CurrencyCode): string {
  const value = BigInt(minorAmountSchema.parse(amount));
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: currencySchema.parse(currency),
    }).resolvedOptions().maximumFractionDigits ?? 0;
  const scale = 10n ** BigInt(digits);
  return digits === 0
    ? String(value)
    : `${value / scale}.${String(value % scale).padStart(digits, "0")}`;
}

export function createProductJsonLd({
  url,
  gift,
  offer,
  currency,
}: Readonly<{
  url: string;
  gift: Pick<
    PublishedGiftView,
    "title" | "shortDescription" | "primaryMedia" | "localeContext"
  >;
  offer?: StorefrontGiftOffer;
  currency?: CurrencyCode;
}>) {
  if (gift.localeContext.fallbackUsed) return null;
  const availability =
    offer?.availability === "AVAILABLE"
      ? "InStock"
      : offer?.availability === "PREORDER"
        ? "PreOrder"
        : offer?.reason === "OUT_OF_STOCK"
          ? "OutOfStock"
          : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    url,
    name: gift.title,
    description: gift.shortDescription,
    image: [gift.primaryMedia.url],
    ...(offer?.price && currency && availability
      ? {
          offers: {
            "@type": "Offer",
            url,
            priceCurrency: currency,
            price: exactSeoPrice(offer.price.unitAmountMinor, currency),
            availability: `https://schema.org/${availability}`,
          },
        }
      : {}),
  };
}

export function createPageJsonLd(
  input: Readonly<{
    url: string;
    origin: string;
    locale: SupportedLocale;
    siteName: string;
    title: string;
    description: string;
    kind: "WebPage" | "CollectionPage" | "ProfilePage";
    person?: Readonly<{ name: string; image: string }>;
    breadcrumbs: readonly Readonly<{ name: string; url: string }>[];
  }>,
) {
  const organization = new URL("/#organization", input.origin).href;
  const website = new URL("/#website", input.origin).href;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organization,
        name: input.siteName,
        url: new URL("/", input.origin).href,
      },
      {
        "@type": "WebSite",
        "@id": website,
        name: input.siteName,
        url: new URL("/", input.origin).href,
        publisher: { "@id": organization },
      },
      {
        "@type": input.kind,
        "@id": `${input.url}#page`,
        url: input.url,
        name: input.title,
        description: input.description,
        inLanguage: input.locale,
        isPartOf: { "@id": website },
        ...(input.person
          ? {
              mainEntity: {
                "@type": "Person",
                ...input.person,
                url: input.url,
              },
            }
          : {}),
      },
      ...(input.breadcrumbs.length > 1
        ? [
            {
              "@type": "BreadcrumbList",
              itemListElement: input.breadcrumbs.map((item, index) => ({
                "@type": "ListItem",
                position: index + 1,
                name: item.name,
                item: item.url,
              })),
            },
          ]
        : []),
    ],
  };
}

/** JSON-LD is data, not executable JS. Escape author text before crossing the HTML parser. */
export function JsonLd({ data }: Readonly<{ data: unknown }>) {
  if (data === null || data === undefined) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data)
          .replace(/</gu, "\\u003c")
          .replace(/\u2028/gu, "\\u2028")
          .replace(/\u2029/gu, "\\u2029"),
      }}
    />
  );
}
