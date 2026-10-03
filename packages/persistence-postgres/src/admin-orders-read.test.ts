import { expect, test, vi } from "vitest";
import type { AdminOrdersStoreRequest } from "@fan-support/contracts";
import { readAdminOrdersList } from "./admin-orders-read.js";

const listRequest = (query: string) =>
  ({
    command: {
      schemaVersion: 1,
      action: "LIST",
      page: 1,
      pageSize: 20,
      query,
      fulfillment: "ALL",
      moderation: "ALL",
    },
  }) as AdminOrdersStoreRequest;

test("order list shows the public number and matches it as support hears it", async () => {
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows: [] }));
  query.mockResolvedValueOnce({ rows: [{ total: "1" }] });
  query.mockResolvedValueOnce({
    rows: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        public_order_id: "22222222-2222-4222-8222-222222222222",
        public_order_no: "FS-7K3M9C",
        version: "3",
        presentation_locale: "ja",
        order_status: "OPEN",
        payment_status: "PAID",
        dispute_status: "NONE",
        fulfillment_status: "PREPARING",
        currency: "USD",
        total_amount_minor: "1200",
        item_count: 1,
        pending_review_count: 0,
        created_at: "2026-09-26T00:00:00.000Z",
        updated_at: "2026-09-26T00:00:00.000Z",
      },
    ],
  });
  const result = await readAdminOrdersList(
    { query, release: vi.fn() },
    listRequest("7k3m 9c"),
  );
  expect(result).toMatchObject({
    kind: "LIST",
    items: [{ publicOrderNo: "FS-7K3M9C" }],
  });
  const [countSql, countArgs] = query.mock.calls[0]!;
  expect(countSql).toContain("o.public_order_no=$5::text");
  expect(countSql).toContain("o.public_order_no ILIKE $2");
  expect(countArgs).toEqual([
    "7k3m 9c",
    "%7k3m 9c%",
    "ALL",
    "ALL",
    "FS-7K3M9C",
  ]);
  expect(query.mock.calls[1]![1]).toEqual([
    "7k3m 9c",
    "%7k3m 9c%",
    "ALL",
    "ALL",
    "FS-7K3M9C",
    20,
    0,
  ]);
});

test("free text that is not a public number binds no exact number", async () => {
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows: [] }));
  query.mockResolvedValueOnce({ rows: [{ total: "0" }] });
  await readAdminOrdersList(
    { query, release: vi.fn() },
    listRequest("Rose Palace"),
  );
  expect(query.mock.calls[0]![1]?.[4]).toBeNull();
});
