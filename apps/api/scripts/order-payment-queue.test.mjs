import assert from "node:assert/strict";
import test from "node:test";
import {
  createPgBossReliableEventQueue,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { prepareOrderPaymentQueue } from "./order-payment-queue.mjs";

test("new order-payment fixture provisions the durable queue once before unchanged VERIFY runtimes start", async () => {
  let result;
  await withEphemeralPostgres(async (database) => {
    try {
      await prepareOrderPaymentQueue(database);
      const verifier = createPgBossReliableEventQueue({
        schemaVersion: 1,
        connectionString:
          preflightEnvironment(database).FAN_SUPPORT_DATABASE_URL,
        schema: "pgboss",
        managementMode: "VERIFY",
        localConcurrency: 1,
      });
      try {
        await verifier.start();
        result = { success: true };
      } finally {
        await verifier.stop();
      }
    } catch (error) {
      result = {
        success: false,
        code: /^[A-Z_]+$/u.test(error?.code ?? "") ? error.code : null,
      };
    }
  });
  assert.deepEqual(result, { success: true });
});
