import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";

test("all literal order-payment harness SQL prepares against the actual migrated schema before expensive fixture setup", async () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const files = [
    "order-payment-client.mjs",
    "order-payment-runtime.mjs",
    "order-payment-protocol.mjs",
    "order-payment-commit-faults.mjs",
  ];
  const statements = [];
  let querySites = 0,
    transactionControlStatements = 0;
  for (const file of files) {
    const source = await readFile(path.join(directory, file), "utf8");
    querySites += [...source.matchAll(/\.query\s*\(/gu)].length;
    for (const match of source.matchAll(
      /\.query\(\s*(?:`([^`]+)`|("(?:[^"\\]|\\.)*"))/gu,
    )) {
      const sql = match[1] ?? JSON.parse(match[2]);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
        transactionControlStatements++;
        continue;
      }
      assert.ok(
        !sql.includes("${"),
        "Dynamic harness SQL requires an explicit parameterized probe",
      );
      statements.push({ file, sql });
    }
  }
  assert.ok(statements.length > 0);
  assert.equal(
    statements.length + transactionControlStatements,
    querySites,
    "All harness query sites must be literal SQL or explicit transaction control",
  );
  const failures = [];
  await withEphemeralPostgres(async (database) => {
    await runMigrations({
      clientConfig: database,
      workspaceRoot: path.resolve(directory, "../../.."),
      command: { direction: "up" },
    });
    const client = new Client(database);
    await client.connect();
    try {
      for (const [index, { file, sql }] of statements.entries()) {
        try {
          await client.query(`PREPARE p405_script_${index} AS ${sql}`);
        } catch (error) {
          failures.push({
            file,
            statement: index,
            code: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null,
          });
        }
      }
    } finally {
      await client.end();
    }
  });
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      actualMigratedHarnessStatements: statements.length,
      failures: failures.length,
    }),
  );
});
