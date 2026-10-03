import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
const views = await import("./detail-view").catch(() => undefined);
const messages = await import("./copy").catch(() => undefined);
const reviews = await import("./review-manifest").catch(() => undefined);
import { financeFixture } from "./fixtures.test-support";
export { financeFixture };
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

// The order page keeps payments and refunds folded at the bottom (user request 2026-09-29)
// unless something there still needs a person: it must never hide an unfinished refund.
test("payments and refunds open by themselves only when something needs attention", async () => {
  const { financeNeedsAttention } = await import("./model");
  const quiet = financeFixture();
  expect(financeNeedsAttention(quiet, false)).toBe(false);
  expect(financeNeedsAttention(null, false)).toBe(false);
  expect(financeNeedsAttention(quiet, true)).toBe(true);
  for (const change of [
    { occupiedRefundAmountMinor: 500 },
    { needsReconciliation: true },
    { disputeStatus: "OPEN" },
    { disputeStatus: "LOST" },
  ]) {
    const detail = financeFixture();
    Object.assign(detail.order, change);
    expect(financeNeedsAttention(detail, false)).toBe(true);
  }
  const settled = financeFixture();
  Object.assign(settled.order, {
    occupiedRefundAmountMinor: 500,
    refundedAmountMinor: 500,
    paymentStatus: "PARTIALLY_REFUNDED",
  });
  expect(financeNeedsAttention(settled, false)).toBe(false);
});
