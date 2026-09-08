import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { cartTimestamp } from "../dist/cart-runtime-data.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const files = [
  "cart-edit-data.ts",
  "cart-edit-private-read.ts",
  "cart-edit-write.ts",
  "cart-edit-repository.ts",
];
const statements = [];
for (const file of files) {
  const source = await readFile(
    new URL(`../src/${file}`, import.meta.url),
    "utf8",
  );
  for (const match of source.matchAll(/`([^`]+)`/gu)) {
    if (!match[1].includes("public.")) continue;
    const sql = match[1].replace(
      /\$\{cartTimestamp\("([^"]+)"\)\}/gu,
      (_match, column) => cartTimestamp(column),
    );
    assert.ok(
      !sql.includes("${"),
      "every dynamic identifier is resolved from the actual source",
    );
    statements.push(sql);
  }
}
assert.equal(
  statements.length,
  10,
  "all cart edit repository SQL statements are included",
);
let stage = "MIGRATION",
  assertions = 0;
try {
  await withEphemeralPostgres(async (configuration) => {
    await runMigrations({
      clientConfig: configuration,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(configuration);
    await client.connect();
    try {
      stage = "PREPARE_ALL";
      for (const [index, sql] of statements.entries()) {
        await client.query(`PREPARE cart_edit_statement_${index} AS ${sql}`);
        assertions++;
      }
      stage = "PRIVATE_MATERIAL_HASH";
      const row = (
        await client.query(
          "SELECT public.cart_private_material_hash(NULL,'anonymous',NULL,decode('abcd','hex'),'test-key','und') AS hash_a,public.cart_private_material_hash(NULL,'anonymous',NULL,decode('abce','hex'),'test-key','und') AS hash_b",
        )
      ).rows[0];
      stage = "HASH_ASSERT";
      assert.match(row.hash_a, /^[0-9a-f]{64}$/u);
      assert.notEqual(row.hash_a, row.hash_b);
      assertions += 2;
    } catch (error) {
      console.error(
        JSON.stringify({
          schemaVersion: 1,
          stage,
          sqlState:
            typeof error?.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code)
              ? error.code
              : null,
          errorKind:
            error instanceof assert.AssertionError ? "ASSERTION" : "DATABASE",
        }),
      );
      throw error;
    } finally {
      await client.end();
    }
  });
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      result: "PASS",
      assertions,
      scope:
        "actual migrated PostgreSQL parses every edit query; full relational mutation is not included and requires separate cart HTTP acceptance",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      schemaVersion: 1,
      result: "FAIL",
      stage,
      sqlState:
        typeof error?.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code)
          ? error.code
          : null,
    }),
  );
  process.exitCode = 1;
}
