import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { verifyCartRuntimeRollbackProtection } from "../../../packages/persistence-postgres/scripts/cart-runtime-rollback-proof.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(
  await readFile(
    new URL("../../../database/migrations/manifest.json", import.meta.url),
    "utf8",
  ),
);
const latestHead = manifest.migrations.at(-1).version;
const ownershipMessage =
  "cart ownership requires the daily recipient rule migration";
const mediaMessage =
  "daily image fill rollback would discard filled media processing history";

function fixture(t, overrides = {}) {
  const queries = [];
  let rollbacks = 0;
  let ended = false;
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {
    ended = true;
  });
  t.mock.method(console, "error", () => {});
  t.mock.method(Client.prototype, "query", async (sql) => {
    queries.push(sql);
    if (sql === "BEGIN") return { rows: [] };
    if (sql === "ROLLBACK") {
      rollbacks++;
      return { rows: [] };
    }
    if (sql.includes("to_jsonb(record)")) {
      const table = /FROM public\.([a-z_]+) record/u.exec(sql)[1];
      const mutated = rollbacks > 0 && overrides.changedTable === table;
      return { rows: [{ value: { table, revision: mutated ? 2 : 1 } }] };
    }
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
    if (sql.includes("SELECT count(*)") && sql.includes("public.cart_items"))
      return { rows: [{ count: String(overrides.dynamicCount ?? 3) }] };
    if (
      sql.includes("SELECT count(*)") &&
      sql.includes("public.media_processing_jobs")
    )
      return { rows: [{ count: String(overrides.filledCount ?? 3) }] };
    if (sql.includes("RAISE EXCEPTION") && sql.includes(ownershipMessage)) {
      if (overrides.acceptOwnership) return { rows: [] };
      throw Object.assign(
        new Error(overrides.ownershipMessage ?? ownershipMessage),
        {
          code: Object.hasOwn(overrides, "ownershipCode")
            ? overrides.ownershipCode
            : "55000",
        },
      );
    }
    if (sql.includes("RAISE EXCEPTION") && sql.includes(mediaMessage)) {
      if (overrides.acceptMedia) return { rows: [] };
      throw Object.assign(new Error(overrides.mediaMessage ?? mediaMessage), {
        code: "55000",
      });
    }
    throw new Error("Unexpected query in current-schema guard proof");
  });
  return {
    run: () =>
      verifyCartRuntimeRollbackProtection({ clientConfig: {}, workspaceRoot }),
    queries,
    get rollbacks() {
      return rollbacks;
    },
    get ended() {
      return ended;
    },
  };
}

test("daily cart history verifies 0023 and 0041 directly without rewinding the current schema", async (t) => {
  const value = fixture(t);
  const result = await value.run();
  assert.equal(result.status, "PASS");
  assert.equal(result.proof, "CURRENT_SCHEMA_DIRECT_SQL");
  assert.equal(result.migrationHead, latestHead);
  assert.equal(result.dynamicOnlyIntents, 3);
  assert.equal(result.filledMediaJobs, 3);
  assert.deepEqual(result.guards, ["0023", "0041"]);
  assert.deepEqual(result.after, result.before);
  assert.ok(result.before.media_processing_jobs.sha256);
  assert.ok(result.before.management_operations.sha256);
  assert.ok(result.before.daily_publication_manifests.sha256);
  assert.ok(result.before.schema_migrations.sha256);
  assert.equal(value.rollbacks, 2);
  assert.equal(value.ended, true);
  assert.equal(
    value.queries.some((sql) => sql.includes("AS notifications")),
    false,
  );
});

for (const [label, overrides] of [
  ["wrong SQLSTATE", { ownershipCode: "42P01" }],
  [
    "different 55000 guard",
    {
      ownershipMessage:
        "pending support intents require null-safe moderation validation",
    },
  ],
  [
    "non-head runner error",
    {
      ownershipCode: undefined,
      ownershipMessage:
        "down migration confirmation must match the applied head",
    },
  ],
  ["unexpected successful down", { acceptOwnership: true }],
  ["different media guard", { mediaMessage: "unrelated 55000" }],
  ["unexpected successful media down", { acceptMedia: true }],
]) {
  test(`${label} cannot satisfy the direct history proof`, async (t) => {
    const value = fixture(t, overrides);
    await assert.rejects(value.run(), /exact .*guard must reject rollback/u);
    assert.ok(value.rollbacks >= 1);
    assert.equal(value.ended, true);
  });
}

for (const changedTable of ["media_processing_jobs", "schema_migrations"]) {
  test(`${changedTable} must remain byte-for-byte unchanged`, async (t) => {
    const value = fixture(t, { changedTable });
    await assert.rejects(
      value.run(),
      /preserves all cart, daily publication and media history/u,
    );
    assert.equal(value.ended, true);
  });
}

for (const [label, overrides, message] of [
  ["no dynamic ownership", { dynamicCount: 0 }, /real accepted cart intent/u],
  [
    "no filled media",
    { filledCount: 0 },
    /retained filled media processing history/u,
  ],
  ["unexpected schema head", { head: "9999" }, /latest manifest head/u],
]) {
  test(`${label} is not a valid daily fixture`, async (t) => {
    const value = fixture(t, overrides);
    await assert.rejects(value.run(), message);
    assert.equal(value.ended, true);
  });
}
