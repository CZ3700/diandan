import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  withEphemeralPostgres,
  runMigrations,
} from "../../../packages/persistence-postgres/dist/index.js";
const { Client } = createRequire(
  new globalThis.URL(
    "../../../packages/persistence-postgres/package.json",
    import.meta.url,
  ),
)("pg");
await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot: fileURLToPath(
      new globalThis.URL("../../../", import.meta.url),
    ),
    command: { direction: "up" },
  });
  const client = new Client(config);
  await client.connect();
  try {
    const original = await client.query(
      "SELECT array_agg(currency ORDER BY currency COLLATE \"C\") currencies FROM (VALUES ('USD'::public.currency_code)) scopes(currency)",
    );
    assert.equal(Array.isArray(original.rows[0].currencies), false);
    console.log(
      JSON.stringify({
        stage: "ORIGINAL",
        array: Array.isArray(original.rows[0].currencies),
        type: typeof original.rows[0].currencies,
      }),
    );
    const corrected = await client.query(
      "SELECT array_agg(currency::text ORDER BY currency COLLATE \"C\") currencies FROM (VALUES ('USD'::public.currency_code)) scopes(currency)",
    );
    assert.deepEqual(corrected.rows[0].currencies, ["USD"]);
    console.log(
      JSON.stringify({
        stage: "TEXT_CAST",
        array: Array.isArray(corrected.rows[0].currencies),
        type: typeof corrected.rows[0].currencies,
        passed: true,
      }),
    );
  } finally {
    await client.end();
  }
});
