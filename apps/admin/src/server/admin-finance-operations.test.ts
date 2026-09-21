import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";
const id = "10000000-0000-4000-8000-000000000001";
test("finance mutations have distinct fixed routes and require reason, version, key and confirmation", () => {
  const cancel = getAdminOperation("finance-cancel");
  expect(cancel).toBeDefined();
  const body = {
    schemaVersion: 1,
    orderId: id,
    expectedOrderVersion: 1,
    reasonCode: "CUSTOMER_REQUEST",
    confirmed: true,
  };
  expect(cancel!.path).toBe("/api/v1/admin/finance/cancel");
  expect(cancel!.parseCommand(body, id)).toEqual({
    ...body,
    action: "CANCEL",
    idempotencyKey: id,
  });
  expect(() => cancel!.parseCommand(body)).toThrow();
  for (const extra of [
    { action: "REFUND" },
    { actorId: id },
    { confirmed: false },
    { reasonCode: "" },
  ])
    expect(() => cancel!.parseCommand({ ...body, ...extra }, id)).toThrow();
  expect(getAdminOperation("finance-list")!.readOnly).toBe(true);
});
