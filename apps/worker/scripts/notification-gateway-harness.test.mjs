import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { withEphemeralPostgres } from "../../../packages/persistence-postgres/dist/index.js";

test(
  "real TLS and PostgreSQL enforce immutable replay across dropped HTTP responses, process restart, concurrency and deadline",
  { timeout: 120000 },
  async () => {
    const module = await import("./notification-gateway-harness.mjs").catch(
      () => undefined,
    );
    assert.equal(
      typeof module?.createPersistentNotificationGatewayHarness,
      "function",
      "persistent TLS notification harness must exist",
    );
    await withEphemeralPostgres(async (database) => {
      const harness = await module.createPersistentNotificationGatewayHarness({
        context: { database },
      });
      try {
        const report = await harness.verifyPersistenceAndDeadline();
        assert.equal(report.status, "PASS");
        assert.equal(report.actualPostgres, true);
        assert.equal(report.actualTls, true);
        assert.equal(report.processRestarted, true);
        assert.equal(report.acceptedAfterLostResponse, 1);
        assert.equal(report.acceptedAfterConcurrentRequests, 1);
        assert.equal(report.firstSendAfterDeadline, 0);
        assert.equal(report.privateFieldsPersisted, false);
        const reportPath =
          process.env["FAN_SUPPORT_NOTIFICATION_GATEWAY_REPORT"];
        if (reportPath)
          await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
      } finally {
        await harness.close();
      }
    });
  },
);
