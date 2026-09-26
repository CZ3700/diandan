import { orderAccessDetailSchema } from "@fan-support/contracts";

export const orderTestId = "10000000-0000-4000-8000-000000000001";
export const checkoutTestId = "10000000-0000-4000-8000-000000000002";
export const otherOrderTestId = "10000000-0000-4000-8000-000000000003";
export const orderTestToken = "A".repeat(43);
export const orderTestCsrf = "B".repeat(42) + "A";
export const cartTestCsrf = "C".repeat(43);
export const orderTestGrant = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "GRANTED",
  grant: {
    schemaVersion: 1,
    publicOrderId: orderTestId,
    expiresAt: "2099-01-01T00:00:00.123Z",
  },
} as const;
const language = {
  schemaVersion: 1,
  mode: "APPROVED",
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
};
const media = {
  url: "https://media.example.invalid/test.webp",
  alt: "Test image",
  locale: language,
};
export const orderTestDetail = orderAccessDetailSchema.parse({
  schemaVersion: 1,
  publicOrderId: orderTestId,
  publicOrderNo: "FS-7K3M9C",
  presentationLocale: "en",
  orderStatus: "OPEN",
  paymentStatus: "PAID",
  disputeStatus: "NONE",
  fulfillmentStatus: "PENDING",
  amount: {
    schemaVersion: 1,
    currency: "USD",
    subtotalMinor: 100,
    taxAmountMinor: 0,
    shippingAmountMinor: 0,
    feeAmountMinor: 0,
    discountAmountMinor: 0,
    totalAmountMinor: 100,
  },
  items: [
    {
      schemaVersion: 1,
      position: 1,
      idol: {
        handle: "test-idol",
        displayName: "Test artist",
        locale: language,
        portrait: media,
      },
      gift: {
        title: "Test gift",
        variantLabel: null,
        locale: language,
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
      giftKind: "PHYSICAL",
      fulfillmentStatus: "PENDING",
      deliveryProofs: [],
    },
  ],
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:01Z",
});
export const orderTestRead = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "READ",
  order: orderTestDetail,
} as const;
export const orderTestRevoked = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  action: "REVOKED",
  publicOrderId: orderTestId,
} as const;
export const orderTestCookie = `__Host-fan-order=${orderTestToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(orderTestGrant.grant.expiresAt).toUTCString()}`;
export const orderTestClear =
  "__Host-fan-order=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
export function orderTestResponse(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      ...extra,
    },
  });
}
