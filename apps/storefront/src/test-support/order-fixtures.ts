import { orderAccessDetailSchema } from "@fan-support/contracts";
import { checkoutFixture } from "./checkout-fixtures";

const language = {
  schemaVersion: 1,
  mode: "APPROVED",
  requestedLocale: checkoutFixture.presentationLocale,
  resolvedLocale: checkoutFixture.presentationLocale,
  fallbackUsed: false,
} as const;

/** Unit-only authorized view compatible with the shared checkout fixture. */
export const orderFixture = orderAccessDetailSchema.parse({
  schemaVersion: 1,
  publicOrderId: checkoutFixture.publicOrderId,
  publicOrderNo: "FS-7K3M9C",
  presentationLocale: checkoutFixture.presentationLocale,
  orderStatus: "OPEN",
  paymentStatus: "PAID",
  disputeStatus: "NONE",
  fulfillmentStatus: "PENDING",
  amount: checkoutFixture.amount,
  items: checkoutFixture.lines.map((line, index) => ({
    schemaVersion: 1,
    position: index + 1,
    idol: {
      handle: "test-artist",
      displayName: line.idolDisplayName,
      locale: language,
      portrait: {
        url: "https://media.example.test/order-portrait.webp",
        alt: "TEST order artist",
        locale: language,
      },
    },
    gift: {
      title: line.giftTitle,
      variantLabel: line.giftVariantLabel,
      locale: language,
      image: {
        url: "https://media.example.test/order-gift.webp",
        alt: "TEST order gift",
        locale: language,
      },
    },
    quantity: line.quantity,
    unitAmountMinor: line.unitAmountMinor,
    lineSubtotalMinor: line.lineSubtotalMinor,
    taxAmountMinor: line.taxAmountMinor,
    discountAmountMinor: line.discountAmountMinor,
    lineTotalMinor: line.lineTotalMinor,
    currency: checkoutFixture.currency,
    displayMode: "anonymous",
    giftKind: "PHYSICAL",
    fulfillmentStatus: "PENDING",
  })),
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
});
