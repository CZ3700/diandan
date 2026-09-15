import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import ts from "../../../node_modules/typescript/lib/typescript.js";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { cartTimestamp } from "../dist/cart-runtime-data.js";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const queries = [];
for (const name of [
  "order-payment-application",
  "order-payment-data",
  "order-payment-write",
  "payment-transaction-canonical",
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
        `return ${node.getText(ast)}`,
      )(cartTimestamp);
      if (/^(SELECT|WITH|INSERT|UPDATE|DELETE)\b/u.test(query.trim()))
        queries.push({ name, query });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "insertPaymentRow" &&
      ts.isStringLiteral(node.arguments[1]) &&
      ts.isObjectLiteralExpression(node.arguments[2])
    ) {
      const columns = node.arguments[2].properties.map((p) =>
        p.name?.getText(ast),
      );
      assert.ok(columns.every(Boolean));
      queries.push({
        name,
        query: `INSERT INTO public.${node.arguments[1].text} (${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
      });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
assert.ok(queries.length >= 25);
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(configuration);
  await client.connect();
  try {
    for (const [i, entry] of queries.entries()) {
      try {
        await client.query(`PREPARE order_payment_${i} AS ${entry.query}`);
      } catch (error) {
        process.stdout.write(
          JSON.stringify({
            stage: `PREPARE_${i}`,
            module: entry.name,
            code: error.code,
            position: error.position,
          }) + "\n",
        );
        throw error;
      }
    }
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        preparedStatements: queries.length,
        scope:
          "Actual PostgreSQL parses and binds each source-owned SQL statement; financial row behavior separately uses normal HTTP/PSP fixture",
      }) + "\n",
    );
  } finally {
    await client.end();
  }
});
