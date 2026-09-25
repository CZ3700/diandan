#!/usr/bin/env node
import { Client } from "pg";
import { normalizePostgresConnectionConfig } from "../dist/connection-config.js";
import { rebuildIdolSearchProjections } from "../dist/index.js";

const databaseUrl = process.env.FAN_SUPPORT_DATABASE_URL;
const config =
  typeof databaseUrl === "string"
    ? normalizePostgresConnectionConfig({
        connectionString: databaseUrl,
        application_name: "fan-support-catalog-search-rebuild",
      })
    : undefined;
if (process.argv.length !== 2 || config === undefined) {
  console.error(
    "Catalog search rebuild requires FAN_SUPPORT_DATABASE_URL and no command-line arguments.",
  );
  process.exitCode = 1;
} else {
  const client = new Client(config);
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await rebuildIdolSearchProjections(client);
    await client.query("COMMIT");
    console.log(JSON.stringify(result));
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(
      "Catalog search rebuild failed. The transaction was not accepted; retry after checking database availability.",
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
