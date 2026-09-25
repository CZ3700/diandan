import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
const file = (direction: string) =>
  new URL(
    `../../../database/migrations/0026_payment-runtime.${direction}.sql`,
    import.meta.url,
  );
test("runtime migration adds permanent identity, fenced work and pending evidence without rewriting financial authority", async () => {
  const sql = await readFile(file("up"), "utf8").catch(() => "");
  for (const table of [
    "payment_create_receipts",
    "payment_runtime_operations",
    "payment_reconcile_receipts",
  ])
    expect(sql).toContain(`CREATE TABLE public.${table}`);
  expect(sql).toContain("payment_runtime_dispatch_guard");
  expect(sql).toContain("payment_runtime_receipt_validate");
});
test("rollback refuses durable payment work before dropping its tables", async () => {
  const sql = await readFile(file("down"), "utf8").catch(() => "");
  expect(sql).toContain(
    "LOCK TABLE public.payment_create_receipts,public.payment_runtime_operations,public.payment_reconcile_receipts IN ACCESS EXCLUSIVE MODE",
  );
  expect(sql).toContain(
    "payment runtime rollback would discard durable payment history",
  );
  expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(
    sql.indexOf("DROP TABLE"),
  );
});

test("only authenticated UNKNOWN action recovery extends the original mutation guard", async () => {
  const baseline = await readFile(
    new URL(
      "../../../database/migrations/0005_payments-reliable-events.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const original = baseline.slice(
    baseline.indexOf("CREATE FUNCTION validate_payment_attempt_mutation()"),
    baseline.indexOf(
      "CREATE FUNCTION assert_payment_attempt_evidence_and_event()",
    ),
  );
  const signature = original.replace(
    "CREATE FUNCTION validate_payment_attempt_mutation()",
    "CREATE OR REPLACE FUNCTION public.validate_payment_attempt_mutation()",
  );
  const oldEdge =
    "WHEN 'UNKNOWN' THEN NEW.status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED')";
  const newEdge =
    oldEdge +
    " OR (NEW.status='REQUIRES_ACTION' AND NEW.status_evidence_kind='AUTHENTICATED_RECONCILE' AND NEW.action_type IN('REDIRECT','PROVIDER_HOSTED_IFRAME','PROVIDER_COMPONENT','QR_CODE') AND NEW.action_ciphertext IS NOT NULL AND NEW.action_encrypted_data_key IS NOT NULL AND NEW.action_key_version IS NOT NULL)";
  expect(await readFile(file("up"), "utf8")).toContain(
    signature.replace(oldEdge, newEdge).trim(),
  );
  expect(await readFile(file("down"), "utf8")).toContain(signature.trim());
});
