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
test("payment access remains independent when content and order services reject access", () => {
  const denied = {
    status: "rejected",
    reason: new AdminClientError("FORBIDDEN"),
  } as const;
  const payment = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "WORKSPACE",
    actorId: "10000000-0000-4000-8000-000000000001",
    canEdit: true,
    canPublish: false,
    reviewLocales: [],
    currentPublicationId: null,
    currentRevisionId: null,
    generation: 0,
    accounts: [],
    selected: null,
    history: [],
  } as const;
  const result = access.resolveManagementAccess(denied, denied, {
    status: "fulfilled",
    value: { ...payment, reviewLocales: [], accounts: [], history: [] },
  });
  expect(result).toMatchObject({
    contentAllowed: false,
    orders: null,
    payments: payment,
    temporaryFailure: false,
  });
  expect(
    access.resolveManagementAccess(
      denied,
      {
        status: "rejected",
        reason: new AdminClientError("TEMPORARY_UNAVAILABLE"),
      },
      {
        status: "fulfilled",
        value: { ...payment, reviewLocales: [], accounts: [], history: [] },
      },
    ),
  ).toMatchObject({ payments: payment, temporaryFailure: true });
});
