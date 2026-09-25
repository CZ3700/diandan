import {
  cartRuntimeAddCommandSchema,
  cartRuntimeHeaderSchema,
  cartRuntimeItemRecordSchema,
  storefrontGiftResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
export const id = (n: number) =>
  `ca000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-08T00:00:00Z";
export function fixture(locale: SupportedLocale = "en") {
  const localeContext = {
    schemaVersion: 2,
    publicationMode: "DIRECT_OPERATOR_V1",
    sourceLocale: "zh-CN",
    requestedLocale: locale,
    resolvedLocale: "zh-CN",
    fallbackUsed: locale !== "zh-CN",
    translationRevision: id(9),
  };
  const media = {
    schemaVersion: 2,
    kind: "INFORMATIVE",
    url: "https://media.example.invalid/cart-test.webp",
    alt: "原始图片",
    width: 960,
    height: 1200,
    focalPoint: { x: 0.5, y: 0.5 },
    localeContext,
  };
  const command = cartRuntimeAddCommandSchema.parse({
    schemaVersion: 1,
    operation: "ADD_CART_ITEM",
    presentationLocale: locale,
    market: "TEST",
    currency: "USD",
    idolId: id(1),
    giftId: id(2),
    giftVariantId: id(3),
    quantity: 2,
    observedPriceId: id(4),
    displayMode: "anonymous",
    fanMessageLocale: "und",
  });
  const cart = cartRuntimeHeaderSchema.parse({
    schemaVersion: 1,
    id: id(5),
    version: 1,
    status: "ACTIVE",
    expired: false,
    presentationLocale: "en",
    market: "TEST",
    currency: "USD",
    expiresAt: "2026-09-09T00:00:00Z",
    createdAt: at,
    updatedAt: at,
  });
  const current = storefrontGiftResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_GIFT",
    publication: {
      id: id(6),
      revisionId: id(7),
      manifestHash: "a".repeat(64),
      publishedAt: at,
    },
    content: {
      kind: "GIFT",
      view: {
        schemaVersion: 1,
        id: id(2),
        handle: "test-gift",
        status: "active",
        localeContext,
        title: "原始礼物",
        shortDescription: "原始描述",
        description: "原始描述",
        category: "OTHER",
        contents: [],
        shippingMode: "internal_to_idol",
        primaryMedia: media,
        gallery: [],
        variants: [
          {
            schemaVersion: 1,
            id: id(3),
            label: "单件礼物",
            status: "active",
            inventoryPolicy: "PROCURE_ON_DEMAND",
          },
        ],
        seoTitle: "原始礼物",
        seoDescription: "原始描述",
      },
      details: { format: "LEGACY_TEXT", text: "原始描述" },
    },
    classification: {
      kind: "CLASSIFIED",
      giftKind: "WISH",
      profileHash: "a".repeat(64),
    },
    market: "TEST",
    currency: "USD",
    recipient: {
      kind: "PUBLISHED",
      idol: {
        schemaVersion: 1,
        id: id(1),
        handle: "test-artist",
        status: "active",
        acceptingGifts: true,
        localeContext,
        displayName: "原始艺人",
        portrait: media,
      },
    },
    offers: [
      {
        giftVariantId: id(3),
        price: { priceId: id(4), priceRevision: 1, unitAmountMinor: 250 },
        availability: "AVAILABLE",
        reason: null,
        requiresRecipient: false,
        stock: { kind: "PROCURE_ON_DEMAND" },
        maxQuantity: Number.MAX_SAFE_INTEGER,
      },
    ],
  });
  const item = cartRuntimeItemRecordSchema.parse({
    schemaVersion: 1,
    id: id(8),
    version: 1,
    cartId: cart.id,
    giftId: command.giftId,
    giftVariantId: command.giftVariantId,
    idolId: command.idolId,
    quantity: command.quantity,
    observedPriceId: command.observedPriceId,
    displayMode: "anonymous",
    nicknameProvided: false,
    hasFanMessage: false,
  });
  return { schemaVersion: 1, cart, command, current, item };
}
