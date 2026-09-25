import { createPgBossReliableEventQueue } from "@fan-support/persistence-postgres";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";

/** Explicit fixture infrastructure bootstrap; runtime compositions continue to use VERIFY. */
export async function prepareOrderPaymentQueue(database) {
  const queue = createPgBossReliableEventQueue({
    schemaVersion: 1,
    connectionString: preflightEnvironment(database).FAN_SUPPORT_DATABASE_URL,
    schema: "pgboss",
    managementMode: "PROVISION",
    localConcurrency: 1,
  });
  try {
    await queue.start();
  } finally {
    await queue.stop();
  }
}
