import { expect, test } from "vitest";
import * as access from "./access";
import { AdminClientError } from "../workspace/client";
import type { OrdersContext } from "../management-orders/api";
test("order workspace authority is independent from content access and temporary failures are not treated as a role", () => {
  expect(access.resolveManagementAccess).toBeTypeOf("function");
  const orders: OrdersContext = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "CONTEXT",
    actorId: "10000000-0000-4000-8000-000000000001",
    permissions: ["orders.read"],
    reviewLocales: [],
  };
  const contentDenied = {
    status: "rejected",
    reason: new AdminClientError("FORBIDDEN"),
  } as const;
  const result = access.resolveManagementAccess(contentDenied, {
    status: "fulfilled",
    value: orders,
  });
  expect(result.contentAllowed).toBe(false);
  expect(result.orders).toEqual(orders);
  expect(result.temporaryFailure).toBe(false);
  expect(
    access.resolveManagementAccess(
      {
        status: "rejected",
        reason: new AdminClientError("CONTENT_UNAVAILABLE"),
      },
      { status: "rejected", reason: new AdminClientError("FORBIDDEN") },
    ),
  ).toMatchObject({
    contentAllowed: false,
    orders: null,
    temporaryFailure: true,
  });
});
