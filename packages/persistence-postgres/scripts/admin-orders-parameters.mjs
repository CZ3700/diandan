#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { withEphemeralPostgres, runMigrations } from "../dist/index.js";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
// PREPARE resolves actual PostgreSQL domains without ever writing business rows.
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(clientConfig);
  await client.connect();
  let checks = 0;
  try {
    const source = await readFile(
      new URL("../src/admin-orders-write.ts", import.meta.url),
      "utf8",
    );
    for (const [index, match] of [
      ...source.matchAll(/`((?:INSERT|UPDATE)[\s\S]*?)`/gu),
    ].entries()) {
      assert.ok(
        !match[1].includes("${"),
        "write query is parameterized static SQL",
      );
      await client.query(`PREPARE admin_order_write_${index} AS ${match[1]}`);
      checks++;
    }
    assert.equal(
      checks,
      8,
      "all order write statements resolve their parameter domains",
    );
    console.log(JSON.stringify({ status: "PASS", checks }));
  } finally {
    await client.end();
  }
});
