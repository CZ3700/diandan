import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
const api = await import("./api").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
test("finance client uses a caller-owned retry key and binds mutation response to its order", async () => {
  expect(api?.createFinanceApi).toBeTypeOf("function");
  const requests: RequestInit[] = [];
  const client = createAdminClient(
    () => "csrf",
    () => {},
    (async (_url, init) => {
      requests.push(init!);
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        orderId: id,
        operationId: id,
        refundId: null,
        replayed: false,
      });
    }) as typeof fetch,
  );
  const finance = api!.createFinanceApi(client);
  const command = {
    orderId: id,
    expectedOrderVersion: 1,
    reasonCode: "CUSTOMER_REQUEST",
    confirmed: true as const,
  };
  await finance.cancel(command, id);
  await finance.cancel(command, id);
  expect(
    requests.map((request) =>
      new Headers(request.headers).get("idempotency-key"),
    ),
  ).toEqual([id, id]);
  expect(JSON.parse(String(requests[0]!.body))).toEqual({
    schemaVersion: 1,
    ...command,
  });
  await expect(
    finance.cancel(
      { ...command, orderId: "10000000-0000-4000-8000-000000000002" },
      id,
    ),
  ).rejects.toThrow("INVALID_RESPONSE");
});
test("finance list rejects mismatched pagination", async () => {
  expect(api?.createFinanceApi).toBeTypeOf("function");
  const client = createAdminClient(
    () => "csrf",
    () => {},
    async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "LIST",
        page: 2,
        pageSize: 12,
        totalItems: 0,
        canManage: false,
        items: [],
      }),
  );
  await expect(
    api!
      .createFinanceApi(client)
      .list({ page: 1, pageSize: 12, query: "", filter: "ALL" }),
  ).rejects.toThrow("INVALID_RESPONSE");
});
