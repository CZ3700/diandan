import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import ts from "../../../node_modules/typescript/lib/typescript.js";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { cartTimestamp } from "../dist/cart-runtime-data.js";
import { checkoutReceiptColumns } from "../dist/checkout-preflight-data.js";
import { validPaymentReservationsSql } from "../dist/payment-runtime-data.js";
import { runtimeOperationColumns } from "../dist/payment-runtime-fence.js";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const files = [
  "data",
  "config",
  "context",
  "fence",
  "write",
  "recovery",
  "repository",
  "evidence",
];
const queries = [];
for (const name of files) {
  const source = await readFile(
    new URL(`../src/payment-runtime-${name}.ts`, import.meta.url),
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
      const raw = node.getText(ast);
      // These are only source-owned static SQL expressions; parameters remain placeholders.
      const query = Function(
        "cartTimestamp",
        "checkoutReceiptColumns",
        "validPaymentReservationsSql",
        "runtimeOperationColumns",
        "canonical",
        `return ${raw}`,
      )(
        cartTimestamp,
        checkoutReceiptColumns,
        validPaymentReservationsSql,
        runtimeOperationColumns,
        { supported: true, canonicalId: null },
      );
      if (/^(SELECT|WITH|INSERT|UPDATE|DELETE)\b/u.test(query.trim()))
        queries.push({ name, query });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "insertPaymentRow" &&
      ts.isStringLiteral(node.arguments[1]) &&
      ts.isObjectLiteralExpression(node.arguments[2])
    ) {
      const columns = node.arguments[2].properties.map((property) =>
        property.name?.getText(ast),
      );
      assert.ok(
        columns.every(Boolean),
        "every payment row uses fixed named columns",
      );
      queries.push({
        name,
        query: `INSERT INTO public.${node.arguments[1].text} (${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
      });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
assert.ok(queries.length >= 25, "all payment module queries are inventoried");
let stage = "MIGRATIONS",
  assertions = 0;
await withEphemeralPostgres(async (configuration) => {
  try {
    await runMigrations({
      clientConfig: configuration,
      workspaceRoot,
      command: { direction: "up" },
    });
  } catch {
    const diagnostic = new Client(configuration);
    await diagnostic.connect();
    try {
      await diagnostic.query("BEGIN");
      await diagnostic.query(
        await readFile(
          new URL(
            "../../../database/migrations/0026_payment-runtime.up.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          stage: "DDL",
          sqlState: error.code,
          position: error.position,
          detail: error.message,
        }) + "\n",
      );
    } finally {
      await diagnostic.query("ROLLBACK");
      await diagnostic.end();
    }
    throw new Error("Payment migration failed");
  }
  const client = new Client(configuration);
  await client.connect();
  try {
    for (const [index, entry] of queries.entries()) {
      stage = `PREPARE_${index}_${entry.name}`;
      await client.query(`PREPARE payment_runtime_${index} AS ${entry.query}`);
      assertions++;
    }
    const routeQuery = queries.find(
      (entry) =>
        entry.name === "config" && entry.query.includes("ARRAY(SELECT country"),
    )?.query;
    for (const column of ["country", "market", "currency"])
      assert.ok(
        routeQuery?.includes(`ARRAY(SELECT ${column}::text FROM`),
        "actual route SQL uses supported PostgreSQL text-array decoding",
      );
    stage = "ACTUAL_ROUTE_ARRAY_TYPES";
    const domains = (
      await client.query(
        "SELECT ARRAY(SELECT country::text FROM (VALUES('US'::public.country_code)) sample(country)) countries,ARRAY(SELECT market::text FROM (VALUES('TEST'::public.market_code)) sample(market)) markets,ARRAY(SELECT currency::text FROM (VALUES('USD'::public.currency_code)) sample(currency)) currencies",
      )
    ).rows[0];
    assert.ok(
      Object.values(domains).every(Array.isArray),
      "route SQL must return real arrays rather than unknown domain-array strings",
    );
    assertions++;
    const functions = (
      await client.query(
        "SELECT count(*)::integer count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('guard_payment_runtime_operation','guard_payment_runtime_dispatch','assert_payment_runtime_receipt','assert_payment_reconcile_receipt')",
      )
    ).rows[0].count;
    assert.equal(functions, 4);
    assertions++;
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        preparedStatements: queries.length,
        scope:
          "Actual full migrated PostgreSQL parameter and column validation; no PSP or complete checkout fixture",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        stage,
        sqlState: typeof error.code === "string" ? error.code : null,
        constraint:
          typeof error.constraint === "string" ? error.constraint : null,
      }) + "\n",
    );
    throw new Error("Payment SQL parameter probe failed", { cause: error });
  } finally {
    await client.end();
  }
});
