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
  publicOrderNo: "FS-7K3M9C",
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
      giftKind: "PHYSICAL",
      fulfillmentStatus: "PENDING",
      deliveryProofs: [],
      supportCertificate: null,
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
    // Fans see the public number; the UUID stays in the URL and API.
    expect(html).toMatch(/data-order-number[^>]*><bdi>FS-7K3M9C<\/bdi>/u);
    expect(html).not.toContain(order.publicOrderId);
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

  it("shows a studio hold as preparing on one timeline, never naming a dispute or promising progress during it", async () => {
    const html = await render({
      ...order,
      disputeStatus: "OPEN",
      fulfillmentStatus: "ON_HOLD",
      items: [{ ...order.items[0]!, fulfillmentStatus: "ON_HOLD" }],
    });
    expect(html).toContain('data-order-step="PAID" data-step-state="DONE"');
    expect(html).toContain(
      'data-order-step="PREPARING" data-step-state="CURRENT" aria-current="step"',
    );
    expect(html).toContain(
      'data-order-step="DELIVERED" data-step-state="UPCOMING"',
    );
    for (const hidden of [
      copy.orderDisputeLabel,
      copy.orderDisputeOpen,
      copy.orderOnHold,
      copy.orderReviewHelp,
      copy.orderPreparationHelp,
      copy.orderDeliveredHelp,
    ])
      expect(html).not.toContain(hidden);
    expect(html).toContain('data-order-dispute-status="OPEN"');
    expect(html).not.toContain('data-payment-state="SUCCEEDED"');
  });

  it("describes a digital support gift as the artist's record and drops the preparation step for digital-only orders", async () => {
    const digital = {
      ...order,
      fulfillmentStatus: "DELIVERED" as const,
      items: [
        {
          ...order.items[0]!,
          giftKind: "VIRTUAL" as const,
          fulfillmentStatus: "DELIVERED" as const,
        },
      ],
    };
    const html = await render(digital);
    const escaped = (value: string) => value.replaceAll("'", "&#x27;");
    expect(html).toContain('data-order-item-kind="VIRTUAL"');
    expect(html).toContain(escaped(copy.orderDigitalDelivered));
    expect(html).toContain(escaped(copy.orderDigitalDeliveredHelp));
    expect(html).not.toContain(copy.orderDeliveredHelp);
    expect(html).not.toContain('data-order-step="PREPARING"');
    expect(html).toContain('data-order-step="PAID" data-step-state="DONE"');
    expect(html).toContain(
      'data-order-step="DELIVERED" data-step-state="CURRENT" aria-current="step"',
    );
    // A mixed order keeps the studio timeline; only the digital line reads as a record.
    const mixed = {
      ...order,
      fulfillmentStatus: "PREPARING" as const,
      items: [
        digital.items[0]!,
        {
          ...order.items[0]!,
          position: 2,
          fulfillmentStatus: "PENDING" as const,
        },
      ],
    };
    const mixedHtml = await render(mixed);
    expect(mixedHtml).toContain('data-order-step="PREPARING"');
    expect(mixedHtml).toContain(escaped(copy.orderDigitalDelivered));
    expect(mixedHtml).toContain(copy.orderPending);
    expect(mixedHtml).toContain(escaped(copy.orderPreparationHelp));
    // Before payment settles, a digital line is a pending record, never "awaiting preparation".
    const awaiting = await render({
      ...order,
      items: [{ ...digital.items[0]!, fulfillmentStatus: "PENDING" as const }],
    });
    expect(awaiting).toContain(copy.orderDigitalAwaiting);
    expect(awaiting).not.toContain(copy.orderPending);
  });

  it("replaces the timeline with one outcome when payment is unconfirmed, refunded or canceled", async () => {
    for (const [change, label] of [
      [
        { orderStatus: "PENDING_PAYMENT", paymentStatus: "PENDING" },
        copy.orderPaymentProcessing,
      ],
      [{ paymentStatus: "REFUNDED" }, copy.orderRefunded],
      [
        { orderStatus: "CANCELED", fulfillmentStatus: "CANCELED" },
        copy.orderCanceled,
      ],
    ] as const) {
      const html = await render({ ...order, ...change });
      expect(html).toContain("data-order-stage-label");
      expect(html).toContain(label);
      expect(html).not.toContain("data-order-step=");
    }
    const partial = await render({
      ...order,
      paymentStatus: "PARTIALLY_REFUNDED",
    });
    expect(partial).toContain("data-order-step=");
    expect(partial).toContain(copy.orderPartiallyRefunded);
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

// ADR-019 supplement (L3-09): a savable digital support certificate per delivered virtual line.
describe("digital support certificate", () => {
  const certificate = {
    deliveredAt: "2026-09-29T12:00:00.000000Z",
    revoked: false,
  };
  const virtual = orderAccessDetailSchema.parse({
    ...order,
    fulfillmentStatus: "DELIVERED",
    items: [
      {
        ...order.items[0]!,
        giftKind: "VIRTUAL",
        fulfillmentStatus: "DELIVERED",
        supportCertificate: certificate,
      },
      {
        ...order.items[0]!,
        position: 2,
        unitAmountMinor: 0,
        lineSubtotalMinor: 0,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        lineTotalMinor: 0,
        giftKind: "PHYSICAL",
        fulfillmentStatus: "DELIVERED",
      },
    ],
  });
  const section = (html: string) =>
    html.split("data-support-certificate")[1]?.split("</section>")[0] ?? "";

  it("appears only on the delivered virtual line, with artist, gift, quantity, date and number", async () => {
    const html = await render(virtual);
    expect(html.split("data-support-certificate")).toHaveLength(2);
    const lines = html.split("data-order-line=");
    expect(lines[1]).toContain("data-support-certificate");
    expect(lines[2]).not.toContain("data-support-certificate");
    const card = section(html);
    expect(card).toContain('data-certificate-state="AVAILABLE"');
    expect(card).toContain(copy.orderCertificateTitle);
    expect(card).toContain("历史艺人");
    expect(card).toContain("注文時のギフト · Original option × 2");
    expect(card).toContain('dateTime="2026-09-29T12:00:00.000000Z"');
    expect(card).toContain("Delivered on September 29, 2026");
    expect(card).toContain("Order FS-7K3M9C");
    expect(card).toContain("data-certificate-save");
    expect(card).toContain(copy.orderCertificateSignatureNone);
    expect(card).toContain(copy.orderCertificateSignatureAnonymous);
    expect(card).toContain(copy.orderCertificateSignatureName);
  });

  it("carries no private message, amount or contact detail", async () => {
    const card = section(await render(virtual));
    expect(card).not.toMatch(
      /value="\d|data-currency|\$|USD|@|support_intent/u,
    );
    expect(card).not.toContain(order.publicOrderId);
  });

  it("shows a fully refunded line as withdrawn with nothing to save", async () => {
    const revoked = orderAccessDetailSchema.parse({
      ...virtual,
      items: [
        {
          ...virtual.items[0]!,
          supportCertificate: { ...certificate, revoked: true },
        },
        virtual.items[1]!,
      ],
    });
    const card = section(await render(revoked));
    expect(card).toContain('data-certificate-state="REVOKED"');
    expect(card).toContain(copy.orderCertificateRevoked);
    expect(card).not.toContain("data-certificate-save");
    expect(card).not.toContain('type="radio"');
  });

  it("stays away from physical lines and orders that are not yet paid", async () => {
    expect(await render()).not.toContain("data-support-certificate");
    const unpaid = orderAccessDetailSchema.parse({
      ...order,
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      items: [{ ...order.items[0]!, giftKind: "VIRTUAL" }],
    });
    expect(await render(unpaid)).not.toContain("data-support-certificate");
  });

  it("is written in the page language across the seven locales", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const shell = await loadStorefrontCopy(locale);
      const card = section(await render(virtual, locale));
      expect(card).toContain(shell.orderCertificateTitle);
      expect(card).toContain(shell.orderCertificateSave);
      expect(card).not.toMatch(/[{}]/u);
    }
  });
});

describe("private delivery photos", () => {
  const proofIds = [
    "10000000-0000-4000-8000-0000000000f1",
    "10000000-0000-4000-8000-0000000000f2",
  ];
  const delivered = orderAccessDetailSchema.parse({
    ...order,
    fulfillmentStatus: "DELIVERED",
    items: order.items.map((item, index) =>
      index === 0
        ? {
            ...item,
            giftKind: "PHYSICAL",
            fulfillmentStatus: "DELIVERED",
            deliveryProofs: proofIds.map((proofId) => ({
              proofId,
              width: 1600,
              height: 1200,
              thumbnailWidth: 480,
              thumbnailHeight: 360,
            })),
          }
        : { ...item, fulfillmentStatus: "DELIVERED" },
    ),
  });
  it("shows session-bound thumbnails and keeps full photos closed until requested", async () => {
    const html = await render(delivered);
    expect(html).toContain("data-order-proofs");
    expect(html).toContain("Delivery photos");
    for (const [index, proofId] of proofIds.entries()) {
      expect(html).toContain(
        `src="/api/storefront/orders/${delivered.publicOrderId}/delivery-proofs/${proofId}/thumbnail"`,
      );
      expect(html).toContain(`alt="View delivery photo ${index + 1} of 2"`);
    }
    expect(html).not.toContain("/display");
    expect(html).not.toMatch(
      /fulfillment-proofs\/|X-Amz|https:\/\/[^"]*proof/iu,
    );
  });
  it("renders nothing for lines without photos and localizes counts", async () => {
    expect(await render()).not.toContain("data-order-proofs");
    const japanese = await render(delivered, "ja");
    expect(japanese).toContain("お届け写真 1/2 を表示");
  });
});

it("shows a paid wish record before delivery, without exposing private personalization", async () => {
  const { OrderDetail } = await import("./order-detail");
  const detail = orderAccessDetailSchema.parse({
    ...order,
    items: [
      {
        ...order.items[0],
        giftKind: "WISH",
        wishSupport: {
          entryId: "20000000-0000-4000-8000-000000000001",
          supportedAt: "2026-10-01T02:00:00.000Z",
          visibility: "PUBLIC_ANONYMOUS",
          withdrawn: false,
          revoked: false,
        },
      },
    ],
  });
  const html = renderToStaticMarkup(
    <OrderDetail
      order={detail}
      locale="en"
      copy={copy}
      onWithdrawWish={async () => true}
    />,
  );
  expect(html).toContain(copy.wishSupported);
  expect(html).toContain(copy.wishRecordPublic);
  expect(html).toContain(copy.wishRecordHide);
  expect(html).not.toContain("Your private name");
});
