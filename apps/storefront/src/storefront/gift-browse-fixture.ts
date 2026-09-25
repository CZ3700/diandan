import {
  publishedGiftViewSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
const gift = publishedGiftViewSchema.parse({
  schemaVersion: 1,
  id: "10000000-0000-4000-8000-000000000001",
  handle: "fictional-gift",
  status: "active",
  localeContext: {
    schemaVersion: 1,
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: false,
  },
  title: "Fictional gift",
  subtitle: "Prepared for an artist",
  shortDescription: "A fictional gift",
  description: "A fictional gift description",
  fulfillmentDescription: "The studio prepares and delivers it to the artist.",
  category: "OTHER",
  contents: [{ componentCode: "GIFT", quantity: 1, unit: "ITEM" }],
  deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
  shippingMode: "internal_to_idol",
  primaryMedia: {
    schemaVersion: 1,
    kind: "INFORMATIVE",
    url: "https://media.example.test/processed/v1/source/variant.webp",
    alt: "Fictional gift photograph",
    width: 1000,
    height: 1000,
    focalPoint: { x: 0.5, y: 0.5 },
  },
  gallery: [],
  variants: [
    {
      schemaVersion: 1,
      id: "20000000-0000-4000-8000-000000000001",
      label: "Gift",
      status: "active",
      inventoryPolicy: "PROCURE_ON_DEMAND",
    },
  ],
  safetyNotice: "Fictional test gift",
  seoTitle: "Fictional gift",
  seoDescription: "A fictional gift for directory tests",
});
export function giftBrowseFixture(locale: SupportedLocale = "en") {
  return {
    ...gift,
    localeContext: {
      schemaVersion: 1 as const,
      requestedLocale: locale,
      resolvedLocale: locale,
      fallbackUsed: false,
    },
  };
}
