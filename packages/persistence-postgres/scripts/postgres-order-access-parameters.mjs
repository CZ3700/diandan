import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import ts from "../../../node_modules/typescript/lib/typescript.js";
import { Client } from "pg";
import {
  runMigrations,
  withEphemeralPostgres,
  createPostgresPersistence,
} from "../dist/index.js";
import { cartTimestamp } from "../dist/cart-runtime-data.js";
import { orderAccessOrderColumns } from "../dist/order-access-data.js";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const queries = [];
for (const name of [
  "order-access-data",
  "order-access-write",
  "order-access-read",
  "order-access-rate",
  "order-access-repository",
]) {
  const source = await readFile(
    new URL(`../src/${name}.ts`, import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  function walk(node) {
    if (
      (ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      node.getText(ast).includes("public.")
    ) {
      const query = Function(
        "cartTimestamp",
        "orderAccessOrderColumns",
        `return ${node.getText(ast)}`,
      )(cartTimestamp, orderAccessOrderColumns);
      if (/^(SELECT|WITH|INSERT|UPDATE|DELETE)\b/u.test(query.trim()))
        queries.push({ name, query });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
assert.ok(queries.length >= 15);
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(configuration);
  await client.connect();
  const instances = [
    createPostgresPersistence(configuration),
    createPostgresPersistence(configuration),
  ];
  let stage = "PREPARE",
    assertions = 0;
  try {
    for (const [i, entry] of queries.entries()) {
      stage = `PREPARE_${i}_${entry.name}`;
      await client.query(`PREPARE order_access_${i} AS ${entry.query}`);
      assertions++;
    }
    stage = "TWO_INSTANCE_ATOMIC_RATE_LIMIT";
    const command = {
      schemaVersion: 1,
      scope: "EXCHANGE",
      bucket: {
        schemaVersion: 1,
        tokenDigest: "a".repeat(64),
        pepperVersion: "test-access-v1",
      },
      windowSeconds: 60,
      maxRequests: 4,
    };
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        instances[
          i % 2
        ].orderAccessTransactionManager.runInOrderAccessTransaction((repo) =>
          repo.consumeRateLimit(command),
        ),
      ),
    );
    assert.equal(responses.filter((result) => result.allowed).length, 4);
    assert.equal(
      responses.filter(
        (result) => !result.allowed && result.retryAfterSeconds > 0,
      ).length,
      8,
    );
    const [counter] = (
      await client.query(
        "SELECT request_count FROM public.order_access_rate_limits",
      )
    ).rows;
    assert.equal(counter.request_count, 12);
    assertions += 3;
    await instances[0].close();
    instances[0] = createPostgresPersistence(configuration);
    stage = "RESTART_PRESERVES_RATE_LIMIT";
    const restarted =
      await instances[0].orderAccessTransactionManager.runInOrderAccessTransaction(
        (repo) => repo.consumeRateLimit(command),
      );
    assert.equal(restarted.allowed, false);
    assertions++;
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        preparedStatements: queries.length,
        assertions,
        actualPostgres: true,
        twoIndependentPools: true,
        financialRowsCreated: 0,
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        stage,
        sqlState: error.code ?? null,
        position: error.position ?? null,
      }) + "\n",
    );
    throw error;
  } finally {
    await Promise.all(instances.map((instance) => instance.close()));
    await client.end();
  }
});
