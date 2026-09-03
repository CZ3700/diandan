import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

test("makes webhook endpoint rotation finite, same-account, irreversible, and audited", async () => {
  const sql = await readFile(
    path.join(
      workspaceRoot,
      "database/migrations/0005_payments-reliable-events.up.sql",
    ),
    "utf8",
  );

  expect(sql).toContain(
    "lifecycle_audit_log_id uuid NOT NULL REFERENCES audit_logs(id) ON DELETE RESTRICT",
  );
  expect(sql).toContain(
    "FOREIGN KEY (rotated_from_endpoint_id, provider_account_id, environment)",
  );
  expect(sql).toContain(
    "REFERENCES payment_webhook_endpoints(id, provider_account_id, environment)",
  );
  expect(sql).toContain(
    "CREATE FUNCTION guard_payment_webhook_endpoint_transition",
  );
  expect(sql).toContain(
    "OLD.status = 'ACTIVE' AND NEW.status IN ('ROTATION_OVERLAP', 'RETIRED')",
  );
  expect(sql).toContain(
    "OLD.status = 'ROTATION_OVERLAP' AND NEW.status = 'RETIRED'",
  );
  expect(sql).toContain("PAYMENT_WEBHOOK_ENDPOINT_ROTATION_STARTED");
  expect(sql).toContain("PAYMENT_WEBHOOK_ENDPOINT_RETIRED");
  expect(sql).toContain("isfinite(retired_at)");
  expect(sql).toContain("interval '24 hours'");
  expect(sql).toContain("NEW.overlap_started_at <> transaction_timestamp()");
  expect(sql).toContain("endpoint.overlap_started_at <= NEW.received_at");
  expect(sql).toContain("endpoint.retired_at > NEW.received_at");
  expect(sql).toContain(
    "payment_webhook_endpoints_one_active_per_account_environment_idx",
  );
  expect(sql).toContain(
    "payment_webhook_endpoints_one_overlap_per_account_environment_idx",
  );
  expect(sql).toContain("payment_webhook_endpoints_key_history_unique");
  expect(sql).toContain("payment_webhook_endpoints_secret_history_unique");
  expect(sql).toContain("NEW.active_from <> transaction_timestamp()");
  expect(sql).toContain(
    "only the first webhook endpoint may omit a rotation predecessor",
  );
  expect(sql).toContain(
    "predecessor.verification_key_reference_hash <> NEW.verification_key_reference_hash",
  );
  expect(sql).toContain(
    "predecessor.verification_secret_ref <> NEW.verification_secret_ref",
  );
  expect(sql).toContain("isfinite(signature_timestamp)");
  expect(sql).toContain("isfinite(received_at)");
  expect(sql).toContain("isfinite(retention_expires_at)");
  expect(sql).toContain(
    "retention_expires_at <= created_at + interval '7 days'",
  );
  expect(sql).toContain("NEW.created_at <> transaction_timestamp()");
  expect(sql).toContain("NEW.received_at <> transaction_timestamp()");
  expect(sql).toContain("NEW.purged_at <> transaction_timestamp()");
  expect(sql).toContain("payload.created_at = NEW.received_at");
});
