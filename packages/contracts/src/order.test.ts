import { expect, test } from "vitest";

type Schema = Readonly<{
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => Readonly<{ success: boolean }>;
}>;

type OrderModule = Readonly<{
  internalOrderItemSnapshotSchema?: Schema;
  mediaSnapshotSchema?: Schema;
  orderSchema?: Schema;
  policyAcceptanceSnapshotSchema?: Schema;
  publicOrderItemViewSchema?: Schema;
  publicOrderAmountViewSchema?: Schema;
  publicOrderViewSchema?: Schema;
  toPublicOrderItemView?: (
    item: unknown,
    mediaUrls: Readonly<{
      idolPortraitUrl: string;
      giftImageUrl: string;
    }>,
  ) => unknown;
  translationSnapshotRefSchema?: Schema;
}>;

async function loadOrderModule() {
  return import("./order.js").catch(() => undefined) as Promise<
    OrderModule | undefined
  >;
}

const translationSnapshot = {
  requestedLocale: "en",
  resolvedLocale: "en",
  translationRevisionId: "7ef0823b-a666-430a-9055-4aa9465d41c7",
  fallbackUsed: false,
};

const internalItem = {
  schemaVersion: 1,
  idolTranslation: translationSnapshot,
  giftTranslation: translationSnapshot,
  idolId: "c24a7022-5ab1-4fe6-bc3e-c69f4fa7af7a",
  idolHandle: "idol-one",
  idolDisplayName: "Idol One",
  idolPortrait: {
    assetId: "169823b4-175b-493b-991e-44e1b8ad5e83",
    checksum: "a".repeat(64),
    objectKey: "private/idol/original.webp",
    metadataRevisionId: "a86287e0-a6bd-4d7b-82ad-93105e090bf0",
    alt: "Portrait of Idol One",
    altTranslation: translationSnapshot,
  },
  giftId: "7fd728b5-4304-4de8-bd09-f62f315b4a0c",
  giftVariantId: "9fa44c67-1a8e-45e9-afc2-887f0422cc8e",
  giftTitle: "Celebration bouquet",
  giftImage: {
    assetId: "42dfc5c4-b905-4053-bf78-2548c7eadc12",
    checksum: "b".repeat(64),
    objectKey: "private/gift/original.webp",
    metadataRevisionId: "71f2177d-cbb2-4bbb-a2b4-7ed3c98b8d3e",
    alt: "Celebration bouquet",
    altTranslation: translationSnapshot,
  },
  priceId: "ec4caf66-6e49-4112-876a-11e405b89cc7",
  priceRevision: 2,
  quantity: 2,
  unitAmountMinor: 1_250,
  lineSubtotalMinor: 2_500,
  taxAmountMinor: 0,
  discountAmountMinor: 0,
  lineTotalMinor: 2_500,
  currency: "USD",
  supportIntentId: "3ae12a25-feb8-4ea9-96e8-e0cd17216af8",
  displayMode: "nickname",
};

test("keeps immutable internal snapshots separate from public order items", async () => {
  const order = await loadOrderModule();
  for (const schemaName of [
    "translationSnapshotRefSchema",
    "mediaSnapshotSchema",
    "internalOrderItemSnapshotSchema",
    "publicOrderItemViewSchema",
  ] as const) {
    expect(order?.[schemaName], `${schemaName} must be exported`).toBeDefined();
  }
  expect(order?.toPublicOrderItemView).toBeTypeOf("function");

  expect(
    (order?.internalOrderItemSnapshotSchema as Schema).safeParse(internalItem)
      .success,
  ).toBe(true);
  expect(
    (order?.internalOrderItemSnapshotSchema as Schema).safeParse({
      ...internalItem,
      idolPortrait: { ...internalItem.idolPortrait, objectKey: ".hidden.webp" },
    }).success,
  ).toBe(false);
  expect(
    (order?.publicOrderItemViewSchema as Schema).safeParse(internalItem)
      .success,
  ).toBe(false);
  const cancellationOverflowLine = {
    ...internalItem,
    quantity: 1,
    unitAmountMinor: Number.MAX_SAFE_INTEGER,
    lineSubtotalMinor: Number.MAX_SAFE_INTEGER,
    taxAmountMinor: 2,
    discountAmountMinor: 2,
    lineTotalMinor: Number.MAX_SAFE_INTEGER - 1,
  };
  expect(
    (order?.internalOrderItemSnapshotSchema as Schema).safeParse(
      cancellationOverflowLine,
    ).success,
  ).toBe(false);

  const publicItem = order?.toPublicOrderItemView?.(internalItem, {
    idolPortraitUrl: "https://media.example.invalid/idol.webp",
    giftImageUrl: "https://media.example.invalid/gift.webp",
  });
  expect(publicItem).toEqual({
    schemaVersion: 1,
    idol: {
      handle: "idol-one",
      displayName: "Idol One",
      portrait: {
        url: "https://media.example.invalid/idol.webp",
        alt: "Portrait of Idol One",
      },
    },
    gift: {
      title: "Celebration bouquet",
      image: {
        url: "https://media.example.invalid/gift.webp",
        alt: "Celebration bouquet",
      },
    },
    quantity: 2,
    unitAmountMinor: 1_250,
    lineSubtotalMinor: 2_500,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    lineTotalMinor: 2_500,
    currency: "USD",
    displayMode: "nickname",
  });
  expect(
    (order?.publicOrderItemViewSchema as Schema).safeParse(publicItem).success,
  ).toBe(true);

  const serialized = JSON.stringify(publicItem);
  for (const forbidden of [
    "supportIntentId",
    "objectKey",
    "assetId",
    "metadataRevisionId",
    "priceId",
    "giftVariantId",
    "private/idol",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
});

test("defines strict internal and public orders with immutable policy and locale snapshots", async () => {
  const order = await loadOrderModule();
  expect(order?.policyAcceptanceSnapshotSchema).toBeDefined();
  expect(order?.orderSchema).toBeDefined();
  expect(order?.publicOrderViewSchema).toBeDefined();
  expect(order?.publicOrderAmountViewSchema).toBeDefined();

  const amount = {
    schemaVersion: 1,
    market: "US",
    currency: "USD",
    quoteRevision: 4,
    quoteExpiresAt: "2026-09-03T01:00:00Z",
    subtotalMinor: 2_500,
    taxAmountMinor: 0,
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
    discountAmountMinor: 0,
    totalAmountMinor: 2_500,
  };
  const policy = {
    schemaVersion: 1,
    locale: "en",
    policyRevisionId: "7422a7a5-c493-4a0c-ad08-5f7a14ddae39",
    policyTranslationRevisionId: "26c3cfda-21f0-49ef-889b-1b8567345a12",
    acceptedAt: "2026-09-03T00:00:00Z",
  };
  const internalOrder = {
    schemaVersion: 1,
    id: "4f847525-ed50-44db-b2cb-319977b397e0",
    publicOrderId: "92368267-ce38-474a-b6f7-76cbeed24430",
    presentationLocale: "en",
    orderStatus: "OPEN",
    paymentStatus: "PAID",
    disputeStatus: "NONE",
    fulfillmentStatus: "PENDING",
    amount,
    items: [internalItem],
    policyAcceptances: [policy],
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:05:00Z",
  };
  expect((order?.orderSchema as Schema).safeParse(internalOrder).success).toBe(
    true,
  );
  expect(
    (order?.orderSchema as Schema).safeParse({
      ...internalOrder,
      items: [{ ...internalItem, currency: "EUR" }],
    }).success,
  ).toBe(false);
  expect(
    (order?.publicOrderAmountViewSchema as Schema).safeParse({
      schemaVersion: 1,
      currency: "USD",
      subtotalMinor: Number.MAX_SAFE_INTEGER,
      taxAmountMinor: 0,
      shippingAmountMinor: 0,
      feeAmountMinor: 2,
      discountAmountMinor: 2,
      totalAmountMinor: Number.MAX_SAFE_INTEGER - 1,
    }).success,
  ).toBe(false);
  expect(
    (order?.orderSchema as Schema).safeParse({
      ...internalOrder,
      amount: {
        ...amount,
        subtotalMinor: 2_600,
        totalAmountMinor: 2_600,
      },
    }).success,
  ).toBe(false);

  const publicOrder = {
    schemaVersion: 1,
    publicOrderId: internalOrder.publicOrderId,
    presentationLocale: "en",
    orderStatus: "OPEN",
    paymentStatus: "PAID",
    disputeStatus: "NONE",
    fulfillmentStatus: "PENDING",
    amount: {
      schemaVersion: 1,
      currency: "USD",
      subtotalMinor: 2_500,
      taxAmountMinor: 0,
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
      discountAmountMinor: 0,
      totalAmountMinor: 2_500,
    },
    items: [
      order?.toPublicOrderItemView?.(internalItem, {
        idolPortraitUrl: "https://media.example.invalid/idol.webp",
        giftImageUrl: "https://media.example.invalid/gift.webp",
      }),
    ],
    createdAt: internalOrder.createdAt,
    updatedAt: internalOrder.updatedAt,
  };
  const publicSchema = order?.publicOrderViewSchema as Schema;
  expect(publicSchema.safeParse(publicOrder).success).toBe(true);
  expect(
    publicSchema.safeParse({
      ...publicOrder,
      amount: {
        ...publicOrder.amount,
        subtotalMinor: 2_600,
        totalAmountMinor: 2_600,
      },
    }).success,
  ).toBe(false);

  for (const privateField of [
    { id: internalOrder.id },
    { customerEmail: "fan@example.invalid" },
    { orderAccessToken: "PRIVATE_ORDER_TOKEN" },
    { providerAccountId: "3331d8c0-5483-4d35-b4f2-2ae52d22d37e" },
    { supportIntentId: internalItem.supportIntentId },
  ]) {
    expect(
      publicSchema.safeParse({ ...publicOrder, ...privateField }).success,
    ).toBe(false);
  }
});
