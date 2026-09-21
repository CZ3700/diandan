import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import * as domain from "@fan-support/domain";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migration = "database/migrations/0034_payment-rollout";
const first = {
  schemaVersion: 1,
  checkoutSessionId: "a1000000-0000-4000-8000-000000000001",
  providerAccountId: "a1000000-0000-4000-8000-000000000002",
  routeRuleId: "a1000000-0000-4000-8000-000000000003",
  providerRolloutBasisPoints: 10000,
  ruleRolloutBasisPoints: 10000,
};
let assertions = 0;
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot,
    command: { direction: "up" },
  }).catch((error) => {
    console.error(
      JSON.stringify({
        stage: "MIGRATIONS",
        name: error.name,
        code: error.code,
      }),
    );
    throw error;
  });
  const client = new Client(configuration);
  await client.connect();
  try {
    const {
      rows: [present],
    } = await client.query(
      "SELECT to_regprocedure('public.payment_rollout_bucket_v1(text,uuid,uuid)') IS NOT NULL present",
    );
    assert.equal(
      present.present,
      true,
      "partial rollout needs its immutable PostgreSQL bucket function",
    );
    assertions++;
    assert.equal(typeof domain.evaluatePaymentRollout, "function");
    const vectors = [
      [
        first.checkoutSessionId,
        first.providerAccountId,
        first.routeRuleId,
        506,
        7857,
      ],
      [
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
        "00000000-0000-4000-8000-000000000000",
        "12345678-1234-4234-8234-123456789abc",
        7268,
        7592,
      ],
      [
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111",
        9865,
        8778,
      ],
    ];
    const inputs = [
      ...vectors.map(([checkoutSessionId, providerAccountId, routeRuleId]) => ({
        ...first,
        checkoutSessionId,
        providerAccountId,
        routeRuleId,
      })),
      ...Array.from({ length: 4096 }, (_, index) => ({
        ...first,
        checkoutSessionId: `d1000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
        providerAccountId: `f1000000-0000-4000-8000-${(index * 7919).toString(16).padStart(12, "0")}`,
        routeRuleId: `e1000000-0000-4000-8000-${(index * 104729).toString(16).padStart(12, "0")}`,
      })),
    ];
    const actual = (
      await client.query(
        `SELECT input.ordinality::int ordinal,
      public.payment_rollout_bucket_v1('provider',(value->>'checkoutSessionId')::uuid,(value->>'providerAccountId')::uuid) provider,
      public.payment_rollout_bucket_v1('rule',(value->>'checkoutSessionId')::uuid,(value->>'routeRuleId')::uuid) rule
      FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY input(value,ordinality) ORDER BY ordinality`,
        [JSON.stringify(inputs)],
      )
    ).rows;
    assert.equal(actual.length, inputs.length);
    assertions++;
    for (const [index, input] of inputs.entries()) {
      const expected = domain.evaluatePaymentRollout(input);
      assert.equal(expected.kind, "ELIGIBLE");
      assert.deepEqual(actual[index], {
        ordinal: index + 1,
        provider: expected.providerBucket,
        rule: expected.ruleBucket,
      });
      assertions += 2;
    }
    for (const [index, vector] of vectors.entries()) {
      assert.equal(actual[index].provider, vector[3]);
      assert.equal(actual[index].rule, vector[4]);
      assertions += 2;
    }
    const upper = (
      await client.query(
        "SELECT public.payment_rollout_bucket_v1('provider',$1::uuid,$2::uuid) bucket",
        [
          first.checkoutSessionId.toUpperCase(),
          first.providerAccountId.toUpperCase(),
        ],
      )
    ).rows[0];
    assert.equal(upper.bucket, 506);
    assertions++;
    for (const [provider, rule, eligible] of [
      [0, 10000, false],
      [10000, 0, false],
      [10000, 10000, true],
      [506, 7858, false],
      [507, 7857, false],
      [507, 7858, true],
      [500, 10000, false],
      [2500, 10000, true],
    ]) {
      const {
        rows: [row],
      } = await client.query(
        "SELECT public.payment_rollout_bucket_v1('provider',$1::uuid,$2::uuid)<$4::int AND public.payment_rollout_bucket_v1('rule',$1::uuid,$3::uuid)<$5::int eligible",
        [
          first.checkoutSessionId,
          first.providerAccountId,
          first.routeRuleId,
          provider,
          rule,
        ],
      );
      assert.equal(row.eligible, eligible);
      assertions++;
    }
    await assert.rejects(
      client.query(
        "SELECT public.payment_rollout_bucket_v1('browser',$1::uuid,$2::uuid)",
        [first.checkoutSessionId, first.providerAccountId],
      ),
      { code: "22023" },
    );
    assertions++;
    await assert.rejects(
      client.query(
        "SELECT public.payment_rollout_bucket_v1('provider','not-a-uuid'::uuid,$1::uuid)",
        [first.providerAccountId],
      ),
      { code: "22P02" },
    );
    assertions++;
    assert.equal(
      (
        await client.query(
          "SELECT public.payment_rollout_bucket_v1(NULL,$1::uuid,$2::uuid) bucket",
          [first.checkoutSessionId, first.providerAccountId],
        )
      ).rows[0].bucket,
      null,
    );
    assertions++;

    const original = await readFile(
      new URL(
        "../../../database/migrations/0026_payment-runtime.up.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const oldGuard = original.slice(
      original.indexOf(
        "CREATE FUNCTION public.assert_payment_runtime_receipt()",
      ),
      original.indexOf(
        "CREATE CONSTRAINT TRIGGER payment_runtime_receipt_validate",
      ),
    );
    const originalPredicate =
      "rule.rollout_basis_points=10000 AND config.rollout_basis_points=10000";
    const replacement =
      "public.payment_rollout_bucket_v1('rule',session.id,rule.id)<rule.rollout_basis_points AND public.payment_rollout_bucket_v1('provider',session.id,account.id)<config.rollout_basis_points";
    const up = await readFile(
      new URL(`../../../${migration}.up.sql`, import.meta.url),
      "utf8",
    );
    const down = await readFile(
      new URL(`../../../${migration}.down.sql`, import.meta.url),
      "utf8",
    );
    assert.equal(
      up.slice(
        up.indexOf(
          "CREATE OR REPLACE FUNCTION public.assert_payment_runtime_receipt()",
        ),
      ),
      oldGuard
        .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
        .replace(originalPredicate, replacement),
    );
    assertions++;
    assert.ok(
      down.includes(
        oldGuard.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
      ),
    );
    assertions++;
    const live = (
      await client.query(
        "SELECT pg_get_functiondef('public.assert_payment_runtime_receipt()'::regprocedure) definition",
      )
    ).rows[0].definition;
    assert.ok(live.includes(replacement));
    assertions++;
    await client.query(down);
    const restored = (
      await client.query(
        "SELECT pg_get_functiondef('public.assert_payment_runtime_receipt()'::regprocedure) definition",
      )
    ).rows[0].definition;
    assert.ok(restored.includes(originalPredicate));
    assertions++;
    assert.equal(
      (
        await client.query(
          "SELECT to_regprocedure('public.payment_rollout_bucket_v1(text,uuid,uuid)') IS NULL absent",
        )
      ).rows[0].absent,
      true,
    );
    assertions++;
    await client.query(up);
    assert.equal(
      (
        await client.query(
          "SELECT public.payment_rollout_bucket_v1('provider',$1::uuid,$2::uuid) bucket",
          [first.checkoutSessionId, first.providerAccountId],
        )
      ).rows[0].bucket,
      506,
    );
    assertions++;
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        comparedInputs: inputs.length,
        scope:
          "Actual PostgreSQL/Domain bucket parity, exact boundaries and isolated DDL down/up. Complete checkout/receipt/PSP admission requires separate HTTP integration.",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        stage: "ROLLOUT_ASSERTION",
        name: error.name,
        code: error.code,
        actual: error.actual,
        expected: error.expected,
      }),
    );
    throw error;
  } finally {
    await client.end();
  }
});
