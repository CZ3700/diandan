import { randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createOrderAccessUseCases } from "@fan-support/application";
import { createOrderPaymentProtocolClient } from "./order-payment-client.mjs";
import { createOrderAccessProtocolClient } from "./order-access-client.mjs";
import { createCartDailyGiftFixture } from "./cart-daily-gift-fixture.mjs";

/** Normal authenticated commerce creates all factual orders; no financial rows are seeded or overwritten. */
export async function createOrderStorefrontOrders(context) {
  const payment = createOrderPaymentProtocolClient(context);
  const canaries = payment.canaries;
  const access = createOrderAccessProtocolClient({ ...context, canaries });
  const application = createOrderAccessUseCases({
    transactions: context.persistence.orderAccessTransactionManager,
  });
  async function confirmed(options) {
    const value = await payment.fresh(options);
    await payment.settle(value);
    const event = await payment.reconcile(value);
    context.check(
      (await payment.apply(event)).decision === "APPLIED",
      "Normal authenticated TEST PSP evidence confirms the existing order",
    );
    value.orderId = (await payment.assertPaid(value)).order_id;
    const grant = await access.bootstrap(value);
    const order = (
      await access.read(grant.session, value.checkout.publicOrderId)
    ).data.order;
    return { value, order };
  }
  const history = [];
  for (const locale of SUPPORTED_LOCALES)
    history.push(await confirmed({ locale }));
  const daily = await createCartDailyGiftFixture({
    ...context,
    presentation: {
      sourceLocale: "zh-CN",
      name: "历史查单测试花束",
      description: "仅用于本机历史原文和图片快照验证的测试礼物。",
    },
  });
  const dailyHistory = await confirmed({
    locale: "en",
    lines: [
      {
        gift: {
          id: daily.giftId,
          handle: daily.handle,
          variants: [{ id: daily.giftVariantId }],
        },
      },
    ],
  });
  async function issue(entry, ttl = context.configuration.linkTtlSeconds) {
    const link = await context.credentials.issueLink();
    canaries.push(link.token);
    const result = await application.issue({
      schemaVersion: 1,
      orderId: entry.value.orderId,
      tokenCredential: link.access,
      linkTtlSeconds: ttl,
      requestId: randomUUID(),
      correlationId: randomUUID(),
      taskName: "order-storefront-browser",
    });
    context.check(
      result.outcome === "SUCCESS" &&
        result.action === "GRANTED" &&
        result.grant.publicOrderId === entry.order.publicOrderId,
      "Internal expiring link issue binds the real paid historical order",
    );
    return link;
  }
  return { payment, access, canaries, history, dailyHistory, issue };
}
