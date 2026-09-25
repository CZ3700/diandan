import { expect, test, vi } from "vitest";
import { createAdminFinanceWebhookHandler } from "./admin-finance-webhook.js";
const id = "10000000-0000-4000-8000-000000000001";
test("finance webhook uses the caller's repository and rejects unmatched evidence", async () => {
  const apply = vi.fn(async () => ({
    schemaVersion: 1,
    providerEventId: id,
    decision: "APPLIED",
    orderId: id,
    reasonCode: "REFUND_CONFIRMED",
  }));
  const handler = createAdminFinanceWebhookHandler(() => id),
    context = {
      providerEventRowId: id,
      event: { eventType: "REFUND_STATUS" },
    } as never,
    repositories = { adminFinance: { apply } } as never;
  expect(handler.effect(context)).toEqual({
    effectKey: "ADMIN_FINANCE_APPLICATION",
    subjectId: id,
  });
  await handler.handle(context, repositories);
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      providerEventId: id,
      taskName: "admin-finance-webhook",
    }),
  );
  apply.mockResolvedValueOnce({
    schemaVersion: 1,
    providerEventId: id,
    decision: "UNMATCHED",
    orderId: id,
    reasonCode: "REFUND_UNMATCHED",
  });
  await expect(handler.handle(context, repositories)).rejects.toThrow(
    "Unmatched",
  );
  await expect(handler.handle(context, {} as never)).rejects.toThrow();
});
