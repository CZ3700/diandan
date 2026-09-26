import { expect, test, vi } from "vitest";
import {
  DIGITAL_DELIVERY_REASON,
  deliverDigitalFulfillments,
  isDigitalFulfillmentLine,
} from "./digital-fulfillment.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-26T10:00:00.000001Z";
const line = (n: number, giftKind: string | null, status = "PENDING") => ({
  fulfillmentId: id(n),
  orderItemId: id(n + 50),
  status,
  version: 1,
  giftKind,
});

function harness(updatedRows = 1) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      return {
        rows: sql.startsWith("UPDATE public.fulfillments")
          ? Array.from({ length: updatedRows }, () => ({ id: values[0] }))
          : [],
      };
    }),
    release: vi.fn(),
  };
  const outbox = vi.fn(async () => undefined);
  return { calls, client, outbox };
}

test("only VIRTUAL lines are digital support records; legacy lines are studio work", () => {
  expect(isDigitalFulfillmentLine({ giftKind: "VIRTUAL" })).toBe(true);
  for (const giftKind of ["PHYSICAL", "WISH", "MERCHANDISE", "OTHER", null])
    expect(isDigitalFulfillmentLine({ giftKind })).toBe(false);
});

test("delivers pending VIRTUAL lines with a SYSTEM audit, event and outbox record in order and skips every other line", async () => {
  const { calls, client, outbox } = harness();
  const delivered = await deliverDigitalFulfillments(client, {
    orderId: id(5),
    lines: [
      line(10, "VIRTUAL"),
      line(11, "PHYSICAL"),
      line(12, null),
      line(13, "VIRTUAL", "ON_HOLD"),
    ],
    at,
    taskName: "order-payment-apply",
    requestId: id(2),
    correlationId: id(3),
    appendOutbox: outbox,
  });
  expect(delivered).toEqual([id(10)]);
  expect(
    calls.map(({ sql }) => sql.split(" ")[0] + " " + sql.split(" ")[2]),
  ).toEqual([
    "UPDATE SET",
    "INSERT public.audit_logs",
    "INSERT public.fulfillment_events",
  ]);
  const update = calls[0]!;
  expect(update.sql).toContain(
    "status='DELIVERED',prepared_at=coalesce(prepared_at,$2::timestamptz),delivered_at=$2::timestamptz",
  );
  expect(update.sql).toContain("status='PENDING' AND version=$3");
  expect(update.values).toEqual([id(10), at, 1, id(5)]);
  const audit = calls[1]!;
  expect(audit.sql).toContain(
    "(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)",
  );
  expect(audit.values.slice(1)).toEqual([
    "SYSTEM",
    "order-payment-apply",
    DIGITAL_DELIVERY_REASON,
    "FULFILLMENT",
    id(10),
    DIGITAL_DELIVERY_REASON,
    id(2),
    id(3),
    "SUCCEEDED",
    at,
  ]);
  const event = calls[2]!;
  expect(event.sql).toContain(
    "(id,fulfillment_id,order_id,sequence,from_status,to_status,authority_kind,reason_code,audit_log_id,request_id,correlation_id,occurred_at)",
  );
  expect(event.values.slice(1)).toEqual([
    id(10),
    id(5),
    2,
    "PENDING",
    "DELIVERED",
    "SYSTEM",
    DIGITAL_DELIVERY_REASON,
    audit.values[0],
    id(2),
    id(3),
    at,
  ]);
  expect(outbox).toHaveBeenCalledTimes(1);
  expect(outbox).toHaveBeenCalledWith({
    eventId: event.values[0],
    fulfillmentId: id(10),
    orderId: id(5),
    version: 2,
    at,
  });
});

test("a concurrent change to the pending row is an integrity failure, never a silent skip", async () => {
  const { client, outbox } = harness(0);
  await expect(
    deliverDigitalFulfillments(client, {
      orderId: id(5),
      lines: [line(10, "VIRTUAL")],
      at,
      taskName: "order-payment-apply",
      requestId: id(2),
      correlationId: id(3),
      appendOutbox: outbox,
    }),
  ).rejects.toMatchObject({ code: "INTEGRITY_VIOLATION" });
  expect(outbox).not.toHaveBeenCalled();
});
