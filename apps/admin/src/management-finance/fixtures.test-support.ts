import { adminFinanceResponseSchema } from "@fan-support/contracts";

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
