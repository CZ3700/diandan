import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  orderAccessDetailSchema,
  type OrderAccessDetail,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import copy from "../../../../packages/i18n/src/storefront/en";

const language = {
  schemaVersion: 1,
  mode: "APPROVED",
  requestedLocale: "ja",
  resolvedLocale: "ja",
  fallbackUsed: false,
} as const;
const daily = {
  ...language,
  mode: "DAILY",
  sourceLocale: "zh-CN",
  resolvedLocale: "zh-CN",
  fallbackUsed: true,
} as const;
const fallback = {
  ...language,
  resolvedLocale: "en",
  fallbackUsed: true,
} as const;
const order = orderAccessDetailSchema.parse({
  schemaVersion: 1,
  publicOrderId: "10000000-0000-4000-8000-000000000001",
  presentationLocale: "ja",
  orderStatus: "OPEN",
  paymentStatus: "PAID",
  disputeStatus: "NONE",
  fulfillmentStatus: "PENDING",
  amount: {
    schemaVersion: 1,
    currency: "USD",
    subtotalMinor: 13500,
    taxAmountMinor: 800,
    discountAmountMinor: 300,
    shippingAmountMinor: 400,
    feeAmountMinor: 100,
    totalAmountMinor: 14500,
  },
  items: [
    {
      schemaVersion: 1,
      position: 1,
      idol: {
        handle: "historical-artist",
        displayName: "历史艺人",
        locale: daily,
        portrait: {
          url: "https://media.example.test/original-portrait.webp",
          alt: "Portrait from this order",
          locale: fallback,
        },
      },
      gift: {
        title: "注文時のギフト",
        variantLabel: "Original option",
        locale: language,
        image: {
          url: "https://media.example.test/original-gift.webp",
          alt: "原始礼物图片",
          locale: daily,
        },
      },
      quantity: 2,
      unitAmountMinor: 6750,
      lineSubtotalMinor: 13500,
      taxAmountMinor: 800,
      discountAmountMinor: 300,
      lineTotalMinor: 14000,
      currency: "USD",
      displayMode: "nickname",
      fulfillmentStatus: "PENDING",
    },
  ],
  createdAt: "2026-09-01T12:34:00.000Z",
  updatedAt: "2026-09-16T15:16:00.000Z",
});

async function render(
  value = order,
  locale: OrderAccessDetail["presentationLocale"] = "en",
) {
  const loaded = await import("./order-detail").catch(() => null);
  expect(loaded?.OrderDetail).toBeTypeOf("function");
  if (!loaded) return "";
  return renderToStaticMarkup(
    <loaded.OrderDetail
      order={value}
      locale={locale}
      copy={await loadStorefrontCopy(locale)}
    />,
  );
}

describe("protected historical order presentation", () => {
  it("renders the original recipient, gift, complete amount breakdown and only the actual creation date", async () => {
    const html = await render();
    expect(html).toContain(order.publicOrderId);
    expect(html).toContain("历史艺人");
    expect(html).toContain("注文時のギフト");
    expect(html).toContain("Original option");
    for (const amount of [6750, 13500, 800, 300, 400, 100, 14000, 14500])
      expect(html).toContain(`value="${amount}"`);
    expect(html).toContain('data-order-quantity="2"');
    expect(html).toContain("data-order-total");
    expect(html).toContain(`dateTime="${order.createdAt}"`);
    expect(html.match(/<time\b/gu)).toHaveLength(1);
    expect(html).not.toContain(order.updatedAt);
    expect(html).not.toMatch(
      /sent.*email|email.*sent|estimated|PRIVATE|support_intent|href=/iu,
    );
  });

  it("keeps all four snapshot languages and makes DAILY and fallback provenance explicit", async () => {
    const html = await render();
    expect(html).toContain('lang="zh-CN">历史艺人');
    expect(html).toContain('lang="ja">注文時のギフト');
    expect(html).toMatch(/lang="en"[^>]*alt="Portrait from this order"/u);
    expect(html).toMatch(/lang="zh-CN"[^>]*alt="原始礼物图片"/u);
    expect(html).toContain(`Original content: ${LOCALE_NATIVE_NAMES["zh-CN"]}`);
    expect(html).toContain(`Saved order content: ${LOCALE_NATIVE_NAMES.en}`);
    expect(html).toContain(`Saved order content: ${LOCALE_NATIVE_NAMES.ja}`);
  });

  it("changes only the interface language and currency formatting across the seven locales", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const html = await render(order, locale);
      const shell = await loadStorefrontCopy(locale);
      expect(html).toContain(shell.orderProgress);
      expect(html).toContain('value="14500"');
      expect(html).toContain('data-currency="USD"');
      expect(html).toContain("历史艺人");
      expect(html).toContain("注文時のギフト");
      expect(html).toContain(order.items[0]!.gift.image.url);
      expect(html).toContain(order.items[0]!.idol.portrait.url);
    }
  });

  it("omits missing historical variant labels without fabricating an option", async () => {
    const original = order.items[0]!;
    const html = await render({
      ...order,
      items: [{ ...original, gift: { ...original.gift, variantLabel: null } }],
    });
    expect(html).not.toContain("data-order-variant");
    expect(html).not.toMatch(/>null<|>undefined</u);
  });

  it("keeps paid, dispute and on-hold facts separate without implying preparation or delivery", async () => {
    const html = await render({
      ...order,
      disputeStatus: "OPEN",
      fulfillmentStatus: "ON_HOLD",
      items: [{ ...order.items[0]!, fulfillmentStatus: "ON_HOLD" }],
    });
    expect(html).toContain(copy.orderPaid);
    expect(html).toContain(copy.orderDisputeOpen);
    expect(html).toContain(copy.orderOnHold);
    expect(html).toContain(copy.orderReviewHelp);
    expect(html).not.toContain(copy.orderPreparing);
    expect(html).not.toContain(copy.orderDeliveredHelp);
    expect(html).not.toContain('data-payment-state="SUCCEEDED"');
  });

  it.each([
    ["CLOSED", "REFUNDED", "LOST", "CANCELED"],
    ["OPEN", "PARTIALLY_REFUNDED", "WON", "DELIVERED"],
    ["DRAFT", "UNPAID", "NONE", "PENDING"],
    ["PENDING_PAYMENT", "PENDING", "NONE", "PREPARING"],
    ["CANCELED", "UNPAID", "NONE", "CANCELED"],
  ] as const)(
    "exposes independent canonical statuses %s / %s / %s / %s",
    async (orderStatus, paymentStatus, disputeStatus, fulfillmentStatus) => {
      const html = await render({
        ...order,
        orderStatus,
        paymentStatus,
        disputeStatus,
        fulfillmentStatus,
      });
      for (const [field, state] of Object.entries({
        order: orderStatus,
        payment: paymentStatus,
        dispute: disputeStatus,
        fulfillment: fulfillmentStatus,
      }))
        expect(html).toContain(`data-order-${field}-status="${state}"`);
      expect(html).not.toMatch(/>undefined<|>null</u);
    },
  );
});
