import type { OrdersDetail } from "./api";
import { adminOrdersResponseSchema } from "@fan-support/contracts";
export const orderId = "10000000-0000-4000-8000-000000000001";
export function detailFixture(): OrdersDetail {
  const locale = {
    schemaVersion: 1,
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: false,
    mode: "APPROVED",
  } as const;
  const media = {
    url: "https://media.example.invalid/test.webp",
    alt: "Synthetic gift",
    locale,
  };
  const result = adminOrdersResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "DETAIL",
    orderId,
    version: 1,
    order: {
      schemaVersion: 1,
      publicOrderId: orderId,
      presentationLocale: "en",
      orderStatus: "OPEN",
      paymentStatus: "PAID",
      disputeStatus: "NONE",
      fulfillmentStatus: "PENDING",
      amount: {
        schemaVersion: 1,
        currency: "USD",
        subtotalMinor: 100,
        totalAmountMinor: 100,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        shippingAmountMinor: 0,
        feeAmountMinor: 0,
      },
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
      items: [
        {
          schemaVersion: 1,
          position: 1,
          idol: {
            handle: "test-artist",
            displayName: "Synthetic Artist",
            locale,
            portrait: media,
          },
          gift: {
            title: "Synthetic gift",
            variantLabel: null,
            locale,
            image: media,
          },
          quantity: 1,
          unitAmountMinor: 100,
          lineSubtotalMinor: 100,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          lineTotalMinor: 100,
          currency: "USD",
          displayMode: "anonymous",
          fulfillmentStatus: "PENDING",
        },
      ],
    },
    items: [
      {
        itemId: orderId,
        position: 1,
        fulfillmentId: orderId,
        fulfillmentVersion: 1,
        intentVersion: 1,
        hasMessage: true,
        hasDisplayName: false,
        declaredLocale: "en",
        languageConfidence: "UNVERIFIED",
        reviewedLocale: null,
        moderationStatus: "PENDING",
        privacyState: "ACTIVE",
        giftKind: "VIRTUAL",
        inventoryPolicy: "PROCURE_ON_DEMAND",
        allowedActions: [],
      },
    ],
    notes: [],
    notification: {
      latestNotificationId: orderId,
      eventType: "PAYMENT_CONFIRMED",
      status: "SENT",
      canResend: true,
    },
  });
  if (result.outcome !== "SUCCESS" || result.kind !== "DETAIL")
    throw new Error("Invalid test fixture");
  return result;
}
