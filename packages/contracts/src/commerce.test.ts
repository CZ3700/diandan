import { expect, test } from "vitest";

type ParseResult = Readonly<{ success: boolean; data?: unknown }>;
type Schema = Readonly<{
  parse: (value: unknown) => unknown;
  safeParse: (value: unknown) => ParseResult;
}>;

async function loadCommerceModule() {
  return import("./commerce.js").catch(() => undefined) as Promise<
    | Readonly<{
        cartGiftContextSchema?: Schema;
        cartSchema?: Schema;
        checkoutQuoteLineSchema?: Schema;
        checkoutQuoteSchema?: Schema;
        checkoutSessionSchema?: Schema;
        countrySchema?: Schema;
        orderAmountSnapshotSchema?: Schema;
        publicCartViewSchema?: Schema;
        supportIntentSchema?: Schema;
      }>
    | undefined
  >;
}

test("accepts only the untrusted gift selection and bounded support message input", async () => {
  const commerce = await loadCommerceModule();

  expect(commerce, "commerce contract module must exist").toBeDefined();
  expect(
    commerce?.cartGiftContextSchema,
    "CartGiftContext schema must be exported",
  ).toBeDefined();

  const schema = commerce?.cartGiftContextSchema as Schema;
  const baseInput = {
    schemaVersion: 1,
    idolId: "c24a7022-5ab1-4fe6-bc3e-c69f4fa7af7a",
    giftId: "7fd728b5-4304-4de8-bd09-f62f315b4a0c",
    giftVariantId: "9fa44c67-1a8e-45e9-afc2-887f0422cc8e",
    displayMode: "nickname",
    displayName: "A".repeat(40),
    fanMessage: "🎁".repeat(280),
    presentationLocale: "pt",
    fanMessageLocale: "und",
  };

  expect(schema.safeParse(baseInput).success).toBe(true);
  expect(
    schema.safeParse({ ...baseInput, fanMessage: "🎁".repeat(281) }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...baseInput, displayName: "🎁".repeat(41) }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...baseInput, displayMode: "anonymous" }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...baseInput, displayName: undefined }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...baseInput, fanMessageLocale: "en-XA" }).success,
  ).toBe(false);

  for (const untrustedField of [
    { unitAmountMinor: 1 },
    { lineTotalMinor: 1 },
    { currency: "USD" },
    { priceRevision: 1 },
    { available: true },
    { eligible: true },
    { fulfillmentAddress: "private address" },
  ]) {
    expect(schema.safeParse({ ...baseInput, ...untrustedField }).success).toBe(
      false,
    );
  }
});

test("requires safe-integer amount snapshots with explicit zeroes and exact totals", async () => {
  const commerce = await loadCommerceModule();

  expect(commerce?.orderAmountSnapshotSchema).toBeDefined();
  expect(commerce?.checkoutQuoteSchema).toBeDefined();
  expect(commerce?.checkoutSessionSchema).toBeDefined();

  const amountSchema = commerce?.orderAmountSnapshotSchema as Schema;
  const quoteLineSchema = commerce?.checkoutQuoteLineSchema as Schema;
  const quoteSchema = commerce?.checkoutQuoteSchema as Schema;
  const sessionSchema = commerce?.checkoutSessionSchema as Schema;
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
  const quote = {
    schemaVersion: 1,
    id: "dc7db228-5757-42a8-af9e-c610bc80ea55",
    cartVersion: 3,
    amount,
    lines: [
      {
        schemaVersion: 1,
        cartItemId: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
        giftVariantId: "9fa44c67-1a8e-45e9-afc2-887f0422cc8e",
        priceId: "ec4caf66-6e49-4112-876a-11e405b89cc7",
        priceRevision: 2,
        quantity: 2,
        unitAmountMinor: 1_250,
        lineSubtotalMinor: 2_500,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        lineTotalMinor: 2_500,
      },
    ],
    expiresAt: "2026-09-03T01:00:00Z",
  };
  const session = {
    schemaVersion: 1,
    id: "7258788e-ed3d-479a-90fb-a332af74cdda",
    status: "READY",
    cartVersion: 3,
    quote,
    createdAt: "2026-09-03T00:00:00Z",
    expiresAt: "2026-09-03T01:00:00Z",
  };

  expect(amountSchema.safeParse(amount).success).toBe(true);
  expect(quoteSchema.safeParse(quote).success).toBe(true);
  expect(sessionSchema.safeParse(session).success).toBe(true);

  for (const invalidMinor of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(
      amountSchema.safeParse({ ...amount, subtotalMinor: invalidMinor })
        .success,
    ).toBe(false);
  }
  for (const requiredZero of [
    "taxAmountMinor",
    "shippingAmountMinor",
    "feeAmountMinor",
    "discountAmountMinor",
  ]) {
    const incomplete = { ...amount } as Record<string, unknown>;
    delete incomplete[requiredZero];
    expect(amountSchema.safeParse(incomplete).success).toBe(false);
  }
  expect(
    amountSchema.safeParse({ ...amount, totalAmountMinor: 2_499 }).success,
  ).toBe(false);
  expect(
    amountSchema.safeParse({
      ...amount,
      subtotalMinor: Number.MAX_SAFE_INTEGER,
      feeAmountMinor: 2,
      discountAmountMinor: 2,
      totalAmountMinor: Number.MAX_SAFE_INTEGER - 1,
    }).success,
  ).toBe(false);
  expect(
    quoteLineSchema.safeParse({
      ...quote.lines[0],
      quantity: 1,
      unitAmountMinor: Number.MAX_SAFE_INTEGER,
      lineSubtotalMinor: Number.MAX_SAFE_INTEGER,
      taxAmountMinor: 2,
      discountAmountMinor: 2,
      lineTotalMinor: Number.MAX_SAFE_INTEGER - 1,
    }).success,
  ).toBe(false);
  expect(
    quoteSchema.safeParse({
      ...quote,
      lines: [{ ...quote.lines[0], lineSubtotalMinor: 2_499 }],
    }).success,
  ).toBe(false);
  expect(
    quoteSchema.safeParse({
      ...quote,
      lines: [{ ...quote.lines[0], lineTotalMinor: 2_499 }],
    }).success,
  ).toBe(false);
});

test("keeps country, market, currency, and presentation locale independent", async () => {
  const commerce = await loadCommerceModule();

  expect(commerce?.countrySchema).toBeDefined();
  expect(commerce?.countrySchema?.safeParse("US").success).toBe(true);
  expect(commerce?.countrySchema?.safeParse("BR").success).toBe(true);
  expect(commerce?.countrySchema?.safeParse("us").success).toBe(false);
  expect(commerce?.countrySchema?.safeParse("en").success).toBe(false);
});

test("separates encrypted support-intent storage from the safe cart view", async () => {
  const commerce = await loadCommerceModule();

  expect(
    commerce?.supportIntentSchema,
    "encrypted SupportIntent schema must be exported",
  ).toBeDefined();
  expect(
    commerce?.cartSchema,
    "internal Cart schema must be exported",
  ).toBeDefined();
  expect(
    commerce?.publicCartViewSchema,
    "safe PublicCartView schema must be exported",
  ).toBeDefined();

  const supportIntentSchema = commerce?.supportIntentSchema as Schema;
  const cartSchema = commerce?.cartSchema as Schema;
  const publicCartViewSchema = commerce?.publicCartViewSchema as Schema;
  const supportIntent = {
    schemaVersion: 1,
    id: "3ae12a25-feb8-4ea9-96e8-e0cd17216af8",
    cartItemId: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
    idolId: "c24a7022-5ab1-4fe6-bc3e-c69f4fa7af7a",
    fanMessageCiphertext: `enc:v1:${"M".repeat(43)}`,
    displayMode: "nickname",
    displayNameCiphertext: `enc:v1:${"N".repeat(43)}`,
    encryptedDataKey: `enc:v1:${"K".repeat(43)}`,
    encryptionKeyVersion: "key-v1",
    moderation: { status: "PENDING" },
    createdPresentationLocale: "ja",
    fanMessageLocale: "ja",
    status: "ACTIVE",
    version: 1,
    expiresAt: "2026-09-04T00:00:00Z",
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:00:00Z",
  };
  const safeCart = {
    schemaVersion: 1,
    version: 3,
    status: "ACTIVE",
    presentationLocale: "ja",
    market: "US",
    currency: "USD",
    expiresAt: "2026-09-04T00:00:00Z",
    items: [
      {
        schemaVersion: 1,
        id: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
        version: 2,
        quantity: 1,
        idol: {
          handle: "idol-one",
          displayName: "Idol One",
        },
        gift: {
          handle: "celebration-bouquet",
          title: "Celebration bouquet",
          variantLabel: "Large",
          image: {
            url: "https://media.example.invalid/gift.webp",
            alt: "Celebration bouquet",
          },
        },
        displayMode: "nickname",
        hasFanMessage: true,
        nicknameProvided: true,
        unitAmountMinor: 2_500,
        lineTotalMinor: 2_500,
        currency: "USD",
      },
    ],
  };
  const internalCart = {
    schemaVersion: 1,
    id: "4b72814f-6e89-4b95-99e5-0cbf045907ee",
    version: 3,
    status: "ACTIVE",
    presentationLocale: "ja",
    market: "US",
    currency: "USD",
    expiresAt: "2026-09-04T00:00:00Z",
    items: [
      {
        schemaVersion: 1,
        id: "c0d51f36-f139-4fd7-9205-fb6d9db1666e",
        cartId: "4b72814f-6e89-4b95-99e5-0cbf045907ee",
        version: 2,
        giftVariantId: "9fa44c67-1a8e-45e9-afc2-887f0422cc8e",
        quantity: 1,
        observedPriceId: "ec4caf66-6e49-4112-876a-11e405b89cc7",
        hasFanMessage: true,
        displayMode: "nickname",
        nicknameProvided: true,
      },
    ],
  };

  expect(supportIntentSchema.safeParse(supportIntent).success).toBe(true);
  expect(cartSchema.safeParse(internalCart).success).toBe(true);
  expect(
    cartSchema.safeParse({
      ...internalCart,
      items: [{ ...internalCart.items[0], cartId: supportIntent.cartItemId }],
    }).success,
  ).toBe(false);
  for (const requiredItemField of ["cartId", "version"]) {
    const itemWithoutRequiredField = {
      ...internalCart.items[0],
    } as Record<string, unknown>;
    delete itemWithoutRequiredField[requiredItemField];
    expect(
      cartSchema.safeParse({
        ...internalCart,
        items: [itemWithoutRequiredField],
      }).success,
    ).toBe(false);
  }
  expect(
    supportIntentSchema.safeParse({
      ...supportIntent,
      moderation: {
        status: "APPROVED",
        decision: {
          kind: "HUMAN",
          reviewerId: "9a3ea221-b7b4-4870-b997-2ced45b86186",
          reviewedAt: "2026-09-03T00:01:00Z",
        },
      },
    }).success,
  ).toBe(true);
  for (const unsafeInternalValue of [
    { fanMessageCiphertext: "PRIVATE_MESSAGE_SENTINEL" },
    { displayNameCiphertext: "PRIVATE_NAME_SENTINEL" },
    { encryptedDataKey: "PRIVATE_KEY_SENTINEL" },
    {
      moderation: {
        status: "REJECTED",
        reasonCode: "fan@example.invalid PRIVATE_MESSAGE",
        decision: {
          kind: "HUMAN",
          reviewerId: "9a3ea221-b7b4-4870-b997-2ced45b86186",
          reviewedAt: "2026-09-03T00:01:00Z",
        },
      },
    },
    { encryptionKeyVersion: "fan@example.invalid" },
  ]) {
    expect(
      supportIntentSchema.safeParse({
        ...supportIntent,
        ...unsafeInternalValue,
      }).success,
    ).toBe(false);
  }
  for (const invalidModeration of [
    {
      status: "PENDING",
      decision: {
        kind: "HUMAN",
        reviewerId: "9a3ea221-b7b4-4870-b997-2ced45b86186",
        reviewedAt: "2026-09-03T00:01:00Z",
      },
    },
    { status: "APPROVED" },
    {
      status: "REJECTED",
      decision: {
        kind: "AUTOMATED",
        ruleVersion: "moderation-v1",
        evidenceId: "0db24f05-6743-40f2-b5ec-3ba9e6e267f8",
        reviewedAt: "2026-09-03T00:01:00Z",
      },
    },
  ]) {
    expect(
      supportIntentSchema.safeParse({
        ...supportIntent,
        moderation: invalidModeration,
      }).success,
    ).toBe(false);
  }
  for (const plaintext of [
    { fanMessage: "PRIVATE_MESSAGE_SENTINEL" },
    { displayName: "PRIVATE_NAME_SENTINEL" },
  ]) {
    expect(
      supportIntentSchema.safeParse({ ...supportIntent, ...plaintext }).success,
    ).toBe(false);
  }

  const parsedCart = publicCartViewSchema.parse(safeCart);
  expect(JSON.parse(JSON.stringify(parsedCart))).toEqual(safeCart);
  expect(
    publicCartViewSchema.safeParse({
      ...safeCart,
      items: [{ ...safeCart.items[0], version: undefined }],
    }).success,
  ).toBe(false);
  expect(
    publicCartViewSchema.safeParse({
      ...safeCart,
      items: [{ ...safeCart.items[0], currency: "EUR" }],
    }).success,
  ).toBe(false);
  expect(
    publicCartViewSchema.safeParse({
      ...safeCart,
      items: [
        {
          ...safeCart.items[0],
          displayMode: "anonymous",
          nicknameProvided: true,
        },
      ],
    }).success,
  ).toBe(false);
  for (const sensitiveField of [
    { fanMessage: "PRIVATE_MESSAGE_SENTINEL" },
    { messagePreview: "PRIVATE_MESSAGE_SENTINEL" },
    { displayName: "PRIVATE_NAME_SENTINEL" },
    { fanMessageCiphertext: "ciphertext-message" },
    { displayNameCiphertext: "ciphertext-name" },
    { encryptionKeyVersion: "key-v1" },
    { supportIntentId: supportIntent.id },
    { cartToken: "PRIVATE_CART_TOKEN" },
    { email: "fan@example.invalid" },
    { fulfillmentAddress: "private address" },
    { objectKey: "internal/object/key" },
    { providerReference: "internal-provider-reference" },
  ]) {
    expect(
      publicCartViewSchema.safeParse({
        ...safeCart,
        items: [{ ...safeCart.items[0], ...sensitiveField }],
      }).success,
    ).toBe(false);
  }
});
