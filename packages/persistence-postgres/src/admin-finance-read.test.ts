import { expect, test, vi } from "vitest";
import { readAdminFinance } from "./admin-finance-read.js";
import type { AdminFinanceStoreRequest } from "@fan-support/contracts";
test("finance list maps canonical public_order_id without leaking row internals", async () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    public_order_id: "22222222-2222-4222-8222-222222222222",
    public_order_no: "FS-7K3M9C",
    version: 1,
    presentation_locale: "en",
    order_status: "OPEN",
    payment_status: "PAID",
    dispute_status: "NONE",
    currency: "USD",
    total_amount_minor: 100,
    captured: 100,
    occupied: 0,
    refunded: 0,
    needs_reconciliation: false,
    updated_at: "2026-09-22T00:00:00.000Z",
  };
  const rows: unknown[][] = [[{ total: 1 }], [row]];
  const client = {
    query: vi.fn(async () => ({ rows: rows.shift() })),
    release: vi.fn(),
  };
  const request = {
    command: {
      schemaVersion: 1,
      action: "LIST",
      page: 1,
      pageSize: 10,
      query: "",
      filter: "ALL",
    },
  } as AdminFinanceStoreRequest;
  const result = await readAdminFinance(client, request, true);
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    kind: "LIST",
    items: [{ publicOrderId: row.public_order_id, publicOrderNo: "FS-7K3M9C" }],
  });
  expect(JSON.stringify(result)).not.toContain("public_order_id");
});
test("finance search matches a spoken public order number exactly", async () => {
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows: [{ total: 0 }] }));
  query.mockResolvedValueOnce({ rows: [{ total: 0 }] });
  query.mockResolvedValueOnce({ rows: [] });
  await readAdminFinance(
    { query, release: vi.fn() },
    {
      command: {
        schemaVersion: 1,
        action: "LIST",
        page: 2,
        pageSize: 10,
        query: "fs 7k3m9o",
        filter: "ALL",
      },
    } as AdminFinanceStoreRequest,
    true,
  );
  expect(query.mock.calls[0]?.[0]).toContain("o.public_order_no=$3::text");
  expect(query.mock.calls[0]?.[1]).toEqual(["fs 7k3m9o", "ALL", "FS-7K3M90"]);
  expect(query.mock.calls[1]?.[1]).toEqual([
    "fs 7k3m9o",
    "ALL",
    "FS-7K3M90",
    10,
    10,
  ]);
});
