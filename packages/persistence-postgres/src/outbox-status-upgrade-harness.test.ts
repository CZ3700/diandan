import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("exercises typed outbox status data through rejected up, up, down, and re-up", async () => {
  const script = await readFile(
    path.join(
      workspaceRoot,
      "packages/persistence-postgres/scripts/postgres-outbox-status-upgrade.mjs",
    ),
    "utf8",
  ).catch(() => "");

  expect(script).toContain("seedVersionEightStatusHistory");
  expect(script).toContain("assertCurrentAdapterWritesAtVersionEight");
  expect(script).toContain("assertFailedUpgradeWasAtomic");
  expect(script).toContain("assertTypedStatusState");
  expect(script).toContain("assertLegacyWriterAtVersionNine");
  expect(script).toContain("assertDirectStatusDriftRejected");
  expect(script).toContain("assertVersionEightState");
  expect(script).toContain('confirmVersion: "0009"');
  expect(script.match(/targetVersion: "0009"/gu)).toHaveLength(3);
});

test("derives status for an older writer that omits the 0009 projection column", async () => {
  const migration = await readFile(
    path.join(
      workspaceRoot,
      "database/migrations/0009_outbox-status-payload.up.sql",
    ),
    "utf8",
  );

  expect(migration).toContain("derive_outbox_payload_status");
  expect(migration).toContain("BEFORE INSERT ON public.outbox_events");
  expect(migration).toContain("NEW.payload_status IS NULL");
});
