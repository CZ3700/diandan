import { expect } from "@playwright/test";
import { URL } from "node:url";
import { adminFinanceResponseSchema } from "@fan-support/contracts";

/** Reads the durable economic result through the manager's actual refresh button. */
export async function readLocalRefundResult({ admin, config, check }) {
  let detail;
  await expect
    .poll(
      async () => {
        const refresh = admin.locator("[data-finance-refresh]");
        if (!(await refresh.isEnabled())) return false;
        const response = admin.waitForResponse((value) => {
          const url = new URL(value.url());
          return (
            url.origin === config.origins.admin &&
            url.pathname === "/api/admin/finance-detail" &&
            value.request().method() === "POST"
          );
        });
        await refresh.click();
        const result = await response;
        check(
          result.status() === 200,
          "Refund read uses the authenticated BFF",
        );
        detail = adminFinanceResponseSchema.parse(await result.json());
        check(
          detail.outcome === "SUCCESS" && detail.kind === "DETAIL",
          "Refund read satisfies the canonical finance contract",
        );
        return (
          detail.refunds.length === 1 &&
          detail.refunds[0].status === "SUCCEEDED"
        );
      },
      { timeout: 90000, intervals: [500, 1000] },
    )
    .toBe(true);
  check(
    detail.order.capturedAmountMinor === detail.order.totalAmountMinor &&
      detail.order.refundedAmountMinor === detail.order.totalAmountMinor &&
      detail.refunds[0].processedAmountMinor === detail.order.totalAmountMinor,
    "The original captured amount is refunded exactly once in full",
  );
  return {
    schemaVersion: 1,
    orderId: detail.order.orderId,
    publicOrderId: detail.order.publicOrderId,
    currency: detail.order.currency,
    capturedAmountMinor: detail.order.capturedAmountMinor,
    refundedAmountMinor: detail.order.refundedAmountMinor,
    refundId: detail.refunds[0].refundId,
    status: detail.refunds[0].status,
  };
}
