import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SUPPORTED_LOCALES,
  adminFinanceResponseSchema,
} from "@fan-support/contracts";
const views = await import("./detail-view").catch(() => undefined);
const messages = await import("./copy").catch(() => undefined);
const reviews = await import("./review-manifest").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
export const financeFixture = () => {
  const value = adminFinanceResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "DETAIL",
    canManage: true,
    canCancel: false,
    order: {
      orderId: id,
      publicOrderId: id,
      publicOrderNo: "FS-7K3M9C",
      version: 1,
      presentationLocale: "en",
      orderStatus: "OPEN",
      paymentStatus: "PAID",
      disputeStatus: "NONE",
      currency: "USD",
      totalAmountMinor: 1000,
      capturedAmountMinor: 1000,
      occupiedRefundAmountMinor: 0,
      refundedAmountMinor: 0,
      availableRefundAmountMinor: 1000,
      needsReconciliation: false,
      updatedAt: "2026-09-22T00:00:00Z",
    },
    items: [
      {
        orderItemId: id,
        position: 1,
        amountMinor: 1000,
        occupiedAmountMinor: 0,
        availableAmountMinor: 1000,
      },
    ],
    attempts: [],
    refunds: [],
    disputes: [],
    issues: [],
  });
  if (value.outcome !== "SUCCESS" || value.kind !== "DETAIL")
    throw new Error("Invalid fixture");
  return value;
};
test("finance panel uses server authority and withholds new refunds while reconciliation is outstanding", () => {
  expect(views?.FinanceDetailView).toBeTypeOf("function");
  const View = views!.FinanceDetailView;
  const detail = financeFixture();
  const render = () =>
    renderToStaticMarkup(
      <View
        detail={detail}
        locale="en"
        busy={false}
        locked={false}
        submit={() => {}}
      />,
    );
  expect(render()).toContain("data-finance-refund");
  detail.canManage = false;
  expect(render()).not.toContain("data-finance-refund");
  detail.canManage = true;
  detail.order.needsReconciliation = true;
  expect(render()).not.toContain("data-finance-refund");
  expect(render()).toContain("data-finance-pending");
  detail.order.needsReconciliation = false;
  detail.order.disputeStatus = "OPEN";
  expect(render()).not.toContain("data-finance-refund");
  expect(render()).toContain("data-finance-dispute-hold");
  detail.order.disputeStatus = "LOST";
  expect(render()).not.toContain("data-finance-refund");
});
test("financial language and exact copy bytes remain seven-language DRAFT with no invented human approval", () => {
  expect(messages?.financeCopy).toBeTypeOf("function");
  expect(reviews?.financeCopyReviews).toBeDefined();
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  for (const locale of SUPPORTED_LOCALES) {
    const copy = messages!.financeCopy(locale);
    expect(Object.keys(copy)).toEqual(Object.keys(messages!.financeCopy("en")));
    expect(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    ).toBe(true);
    expect(
      reviews!.financeCopyReviews.find((review) => review.locale === locale),
    ).toMatchObject({
      schemaVersion: 1,
      templateVersion: "admin-finance-v1",
      status: "DRAFT",
      reviewer: null,
      approvedCommit: null,
      sourceHash: hash(messages!.financeCopy("en")),
      translationHash: hash(copy),
    });
  }
});

test("processing balance excludes refunds already confirmed successful", () => {
  expect(views?.FinanceDetailView).toBeTypeOf("function");
  const View = views!.FinanceDetailView;
  const detail = financeFixture();
  Object.assign(detail.order, {
    occupiedRefundAmountMinor: 600,
    refundedAmountMinor: 400,
    availableRefundAmountMinor: 400,
  });
  const html = renderToStaticMarkup(
    <View
      detail={detail}
      locale="en"
      busy={false}
      locked={false}
      submit={() => {}}
    />,
  );
  const processing = /<dt>Refunds in progress<\/dt><dd>(.*?)<\/dd>/u.exec(
    html,
  )?.[1];
  expect(processing).toContain('value="200"');
  expect(processing).not.toContain('value="600"');
});
