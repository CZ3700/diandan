import { checkoutPreflightCurrentSchema } from "@fan-support/contracts";
import { fixture, id } from "./cart-runtime.test-fixtures.js";
export { id } from "./cart-runtime.test-fixtures.js";
export function checkoutFixture() {
  const f = fixture();
  const provenance = {
    schemaVersion: 1,
    mode: "DAILY",
    publicationMode: "DIRECT_OPERATOR_V1",
    publicationId: id(100),
    revisionId: id(101),
    manifestHash: "a".repeat(64),
    sourceHash: "b".repeat(64),
    sourceLocale: "zh-CN",
    requestedLocale: "en",
    resolvedLocale: "zh-CN",
    translationRevisionId: id(102),
    fallbackUsed: true,
  };
  const media = {
    schemaVersion: 1,
    assetId: id(103),
    checksum: "c".repeat(64),
    objectKey: "test/checkout-original.webp",
    metadataRevisionId: id(101),
    alt: "测试原图",
    altTranslation: provenance,
  };
  return checkoutPreflightCurrentSchema.parse({
    schemaVersion: 1,
    cart: f.cart,
    evaluatedAt: "2026-09-08T00:00:00.123456Z",
    consent: {
      schemaVersion: 1,
      cartId: f.cart.id,
      cartVersion: f.cart.version,
      presentationLocale: "en",
      market: f.cart.market,
      currency: f.cart.currency,
      lines: [
        {
          schemaVersion: 1,
          cartItemId: f.item.id,
          itemVersion: 1,
          supportIntentId: id(104),
          intentVersion: 1,
          fulfillmentProfileId: id(105),
          idolId: f.command.idolId,
          idolHandle: "test-artist",
          idolDisplayName: "测试艺人",
          idolTranslation: provenance,
          idolPortrait: media,
          giftId: f.command.giftId,
          giftVariantId: f.command.giftVariantId,
          giftTitle: "测试礼物",
          giftVariantLabel: "单件",
          giftTranslation: provenance,
          giftImage: media,
          observedPriceId: f.command.observedPriceId,
          priceId: f.command.observedPriceId,
          priceRevision: 1,
          unitAmountMinor: 250,
          quantity: 2,
          displayMode: "anonymous",
          inventoryPolicy: "PROCURE_ON_DEMAND",
          inventoryItemId: null,
          eligibility: "ALL_ACTIVE_ARTISTS",
        },
      ],
      policies: [
        {
          schemaVersion: 1,
          policyKey: "terms",
          kind: "TERMS",
          locale: "en",
          policyRevisionId: id(110),
          policyTranslationRevisionId: id(111),
          publicationId: id(112),
          manifestHash: "d".repeat(64),
          sourceHash: "e".repeat(64),
          title: "TEST terms",
          body: "TEST policy body",
          effectiveAt: "2026-09-07T00:00:00Z",
        },
      ],
    },
    inventory: [],
  });
}
