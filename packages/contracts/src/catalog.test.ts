import { expect, test } from "vitest";

type Schema = Readonly<{
  safeParse: (value: unknown) => Readonly<{ success: boolean }>;
}>;

test("defines strict server-owned catalog, offer, price-book, and reservation views", async () => {
  const catalog = await import("./catalog.js").catch(() => undefined);

  expect(catalog, "catalog contract module must exist").toBeDefined();
  for (const schemaName of [
    "idolSchema",
    "giftSchema",
    "giftOfferSchema",
    "priceBookSchema",
    "inventoryReservationSchema",
  ] as const) {
    expect(
      catalog?.[schemaName],
      `${schemaName} must be exported`,
    ).toBeDefined();
  }

  const localeContext = {
    schemaVersion: 1,
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: false,
    translationRevision: "translation-7",
  };
  const idol = {
    schemaVersion: 1,
    id: "c24a7022-5ab1-4fe6-bc3e-c69f4fa7af7a",
    handle: "idol-one",
    status: "active",
    acceptingGifts: true,
    localeContext,
    displayName: "Idol One",
    shortBio: "A safe published biography.",
    portrait: {
      url: "https://media.example.invalid/idol.webp",
      alt: "Portrait of Idol One",
    },
  };
  const gift = {
    schemaVersion: 1,
    id: "7fd728b5-4304-4de8-bd09-f62f315b4a0c",
    handle: "celebration-bouquet",
    status: "active",
    localeContext,
    title: "Celebration bouquet",
    subtitle: "A bright arrangement",
    description: "Prepared and delivered by the platform.",
    fulfillmentDescription: "The platform procures, prepares, and delivers it.",
    shippingMode: "internal_to_idol",
    variants: [
      {
        schemaVersion: 1,
        id: "9fa44c67-1a8e-45e9-afc2-887f0422cc8e",
        label: "Large",
        status: "active",
        inventoryPolicy: "TRACKED",
      },
    ],
  };
  const offer = {
    schemaVersion: 1,
    idolId: idol.id,
    giftId: gift.id,
    giftVariantId: gift.variants[0]?.id,
    eligible: true,
    priceId: "ec4caf66-6e49-4112-876a-11e405b89cc7",
    priceRevision: 2,
    market: "US",
    currency: "USD",
    unitAmountMinor: 2_500,
    inventoryPolicy: "TRACKED",
    availability: "AVAILABLE",
  };
  const priceBook = {
    schemaVersion: 1,
    id: "33650349-95d0-43df-9c85-9dcb486c35c7",
    revision: 4,
    market: "US",
    currency: "USD",
    status: "PUBLISHED",
    validFrom: "2026-09-03T00:00:00Z",
  };
  const validatedPriceBook = { ...priceBook, status: "VALIDATED" };
  const reservation = {
    schemaVersion: 1,
    id: "fc2bdc97-5cd3-4584-9215-fb13476aa83c",
    checkoutQuoteId: "dc7db228-5757-42a8-af9e-c610bc80ea55",
    cartItemId: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
    giftVariantId: gift.variants[0]?.id,
    inventoryLocationId: "4f24087f-25fd-4b74-aa5f-024ef6027582",
    quantity: 1,
    status: "ACTIVE",
    expiresAt: "2026-09-03T01:00:00Z",
    version: 1,
  };

  const fixtures = [
    [catalog?.idolSchema, idol],
    [catalog?.giftSchema, gift],
    [catalog?.giftOfferSchema, offer],
    [catalog?.priceBookSchema, priceBook],
    [catalog?.inventoryReservationSchema, reservation],
  ] as const;
  for (const [schema, fixture] of fixtures) {
    expect((schema as Schema).safeParse(fixture).success).toBe(true);
    expect(
      (schema as Schema).safeParse({ ...fixture, schemaVersion: 2 }).success,
    ).toBe(false);
  }
  expect(
    (catalog?.priceBookSchema as Schema).safeParse(validatedPriceBook).success,
  ).toBe(true);
  for (const status of ["draft", "archived"] as const) {
    expect(
      (catalog?.idolSchema as Schema).safeParse({ ...idol, status }).success,
    ).toBe(true);
    expect(
      (catalog?.giftSchema as Schema).safeParse({ ...gift, status }).success,
    ).toBe(true);
  }
  expect(
    (catalog?.giftSchema as Schema).safeParse({
      ...gift,
      variants: [{ ...gift.variants[0], status: "archived" }],
    }).success,
  ).toBe(true);

  for (const forbiddenField of [
    { fulfillmentAddress: "private address" },
    { procurementCostMinor: 1 },
    { objectKey: "internal/object/key" },
    { inventoryOnHand: 99 },
  ]) {
    expect(
      (catalog?.giftSchema as Schema).safeParse({
        ...gift,
        ...forbiddenField,
      }).success,
    ).toBe(false);
  }
});
