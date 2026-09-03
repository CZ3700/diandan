import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

async function migration(name: string): Promise<string> {
  return readFile(
    path.join(workspaceRoot, "database/migrations", name),
    "utf8",
  );
}

test("binds admin order and fulfillment events to exact fresh one-use audit evidence", async () => {
  const sql = await migration("0004_orders-fulfillment.up.sql");

  expect(sql).toContain("PERFORM 1 FROM audit_logs audit");
  expect(sql).toContain("FOR UPDATE");
  expect(sql).toContain("audit.action = 'ORDER_CANCELED'");
  expect(sql).toContain("audit.action = 'FULFILLMENT_STATUS_CHANGED'");
  expect(sql).toContain("audit.reason_code = NEW.reason_code");
  expect(sql).toContain("audit.request_id = NEW.request_id");
  expect(sql).toContain("audit.correlation_id = NEW.correlation_id");
  expect(sql).toContain("audit.created_at = NEW.occurred_at");
  expect(sql).toContain("NEW.occurred_at = transaction_timestamp()");
  expect(sql).toContain("admin authority audit evidence was already consumed");
});

test("binds provider cancellation to the current attempt and exact terminal event chain", async () => {
  const sql = await migration("0005_payments-reliable-events.up.sql");

  expect(sql).toContain(
    "CREATE FUNCTION validate_order_provider_cancel_evidence",
  );
  expect(sql).toContain(
    "event.normalized_status IN ('FAILED', 'CANCELED', 'EXPIRED')",
  );
  expect(sql).toContain("association.association_status = 'MATCHED'");
  expect(sql).toContain("association.payment_attempt_id = attempt.id");
  expect(sql).toContain("attempt.order_id = NEW.order_id");
  expect(sql).toContain("order_row.current_payment_attempt_id = attempt.id");
  expect(sql).toContain("attempt_event.provider_event_id = event.id");
  expect(sql).toContain("attempt_event.request_id = NEW.request_id");
  expect(sql).toContain("attempt_event.correlation_id = NEW.correlation_id");
  expect(sql).toContain("attempt_event.occurred_at = NEW.occurred_at");
});
