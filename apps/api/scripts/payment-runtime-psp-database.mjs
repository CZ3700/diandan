import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** An owned separate TEST database; no business tables or production connection are migrated. */
export async function createPaymentTestDatabase(database) {
  const name = `p404_psp_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client(database);
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  let closed = false;
  return {
    database: { ...database, database: name },
    async close() {
      if (closed) return;
      closed = true;
      const cleanup = new Client(database);
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE "${name}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
