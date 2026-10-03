import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { verifyCheckoutPreflightRollbackProtection } from "../../../packages/persistence-postgres/scripts/checkout-preflight-rollback-proof.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(
  await readFile(
    new URL("../../../database/migrations/manifest.json", import.meta.url),
    "utf8",
  ),
);
const latestHead = manifest.migrations.at(-1).version;
const guardMessage =
  "checkout rollback would discard observations or immutable checkout history";

function fixture(t, overrides = {}) {
  const queries = [];
  let rollbacks = 0;
  let ended = false;
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {
    ended = true;
  });
  t.mock.method(Client.prototype, "query", async (sql) => {
    queries.push(sql);
    if (sql === "BEGIN") return { rows: [] };
    if (sql === "ROLLBACK") {
      rollbacks++;
      return { rows: [] };
    }
    if (sql.includes("to_jsonb(record)")) {
      const table = /FROM public\.([a-z_]+) record/u.exec(sql)[1];
      if (overrides.emptyTable === table) return { rows: [] };
      const changed = rollbacks > 0 && overrides.changedTable === table;
      const rows = [{ value: { table, revision: changed ? 2 : 1 } }];
      if (changed && overrides.changeCount) rows.push({ value: { table } });
      return { rows };
    }
    // The old proof cannot rewind a fixture that has retained daily-image history.
    if (sql.includes("AS notifications"))
      return {
        rows: [
          {
            ...Object.fromEntries(
              [...sql.matchAll(/AS ([a-z_]+)/gu)].map((match) => [match[1], 0]),
            ),
            version: latestHead,
            filled_media_jobs: 3,
          },
        ],
      };
    if (sql.includes("FROM public.schema_migrations"))
      return { rows: [{ version: overrides.head ?? latestHead }] };
    if (
      sql.includes("SELECT count(*)") &&
      sql.includes("media_processing_jobs")
    )
      return { rows: [{ count: "3" }] };
    if (sql.includes("RAISE EXCEPTION") && sql.includes(guardMessage)) {
      if (overrides.acceptDown) return { rows: [] };
      throw Object.assign(new Error(overrides.guardMessage ?? guardMessage), {
        code: Object.hasOwn(overrides, "guardCode")
          ? overrides.guardCode
          : "55000",
      });
    }
    throw new Error("Unexpected query in current-schema checkout guard proof");
  });
  return {
    run: () =>
      verifyCheckoutPreflightRollbackProtection({
        clientConfig: {},
        workspaceRoot,
      }),
    queries,
    get rollbacks() {
      return rollbacks;
    },
    get ended() {
      return ended;
    },
  };
}

test("accepted checkout verifies 0025 at the latest head without discarding daily media history", async (t) => {
  const value = fixture(t);
  const result = await value.run();
  assert.equal(result.status, "PASS");
  assert.equal(result.proof, "CURRENT_SCHEMA_DIRECT_SQL");
  assert.equal(result.migrationHead, latestHead);
  assert.equal(result.filledMediaJobs, 3);
  assert.deepEqual(result.guards, ["0025"]);
  assert.equal(Object.keys(result.before).length, 22);
  assert.ok(result.before.checkout_preflight_receipts.sha256);
  assert.ok(result.before.orders.sha256);
  assert.ok(result.before.order_items.sha256);
  assert.ok(result.before.media_processing_jobs.sha256);
  assert.ok(result.before.schema_migrations.sha256);
  assert.deepEqual(result.before, result.after);
  assert.equal(value.rollbacks, 1);
  assert.equal(value.ended, true);
  assert.equal(
    value.queries.some((sql) => sql.includes("AS notifications")),
    false,
  );
});

for (const [label, overrides] of [
  ["wrong SQLSTATE", { guardCode: "42P01" }],
  ["different 55000 guard", { guardMessage: "unrelated immutable history" }],
  [
    "migration runner non-head rejection",
    {
      guardCode: undefined,
      guardMessage: "down migration confirmation must match the applied head",
    },
  ],
  ["unexpected successful down", { acceptDown: true }],
]) {
  test(`${label} cannot prove checkout history protection`, async (t) => {
    const value = fixture(t, overrides);
    await assert.rejects(
      value.run(),
      /exact immutable checkout history guard refuses down/u,
    );
    assert.equal(value.rollbacks, 1);
    assert.equal(value.ended, true);
  });
}

for (const changedTable of ["media_processing_jobs", "schema_migrations"]) {
  for (const changeCount of [false, true]) {
    test(`${changedTable} ${changeCount ? "count" : "bytes"} must stay unchanged`, async (t) => {
      const value = fixture(t, { changedTable, changeCount });
      await assert.rejects(
        value.run(),
        /preserves all 22 table counts and bytes/u,
      );
      assert.equal(value.ended, true);
    });
  }
}

test("a schema different from the latest manifest head is not accepted", async (t) => {
  const value = fixture(t, { head: "0025" });
  await assert.rejects(value.run(), /latest manifest head/u);
  assert.equal(value.rollbacks, 0);
  assert.equal(value.ended, true);
});

test("the fixture must contain an accepted checkout receipt", async (t) => {
  const value = fixture(t, { emptyTable: "checkout_preflight_receipts" });
  await assert.rejects(value.run(), /normal accepted checkout must exist/u);
  assert.equal(value.rollbacks, 0);
  assert.equal(value.ended, true);
});

test("the fixture must contain immutable order history", async (t) => {
  const value = fixture(t, { emptyTable: "order_items" });
  await assert.rejects(value.run(), /real immutable order history must exist/u);
  assert.equal(value.rollbacks, 0);
  assert.equal(value.ended, true);
});
