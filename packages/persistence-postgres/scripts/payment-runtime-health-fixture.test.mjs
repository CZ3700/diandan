import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const load = () =>
  import("./payment-runtime-health-fixture.mjs").catch(() => null);
const providerAccountId = randomUUID();
function fixture(
  t,
  row = {
    environment: "TEST",
    health_status: "HEALTHY",
    version: 1,
    changed_at: "2026-09-09T02:00:00.000001Z",
  },
  failCommit = false,
) {
  const calls = [];
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {
    calls.push(["END"]);
  });
  t.mock.method(Client.prototype, "query", async (sql, params) => {
    calls.push([sql, params]);
    if (sql === "COMMIT" && failCommit)
      throw new Error("Injected commit failure");
    if (sql.includes("FOR UPDATE")) return { rows: row ? [row] : [] };
    return { rows: [], rowCount: 1 };
  });
  return calls;
}
test("health fixture records one real versioned transition and leaves configuration untouched", async (t) => {
  const calls = fixture(t);
  const module = await load();
  assert.equal(typeof module?.changePaymentRuntimeTestHealth, "function");
  assert.deepEqual(
    await module.changePaymentRuntimeTestHealth({
      clientConfig: {},
      providerAccountId,
      healthStatus: "UNAVAILABLE",
    }),
    {
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "CHANGED",
      healthStatus: "UNAVAILABLE",
      version: 2,
    },
  );
  const event = calls.find(([sql]) =>
    sql.startsWith("INSERT INTO public.payment_provider_health_events"),
  );
  assert.ok(event);
  assert.equal(event[1][1], providerAccountId);
  assert.deepEqual(event[1].slice(2, 5), [2, "HEALTHY", "UNAVAILABLE"]);
  const update = calls.find(([sql]) =>
    sql.startsWith("UPDATE public.payment_provider_accounts"),
  );
  assert.ok(update);
  assert.equal(update[1][2], event[1].at(-1));
  assert.deepEqual(
    calls.slice(-2).map(([sql]) => sql),
    ["COMMIT", "END"],
  );
  assert.equal(
    calls.some(([sql]) =>
      /(?:payment_route_rules|config_versions|DISABLE|replica)/u.test(sql),
    ),
    false,
  );
});
test("same health returns unchanged without inventing history", async (t) => {
  const calls = fixture(t);
  const module = await load();
  assert.equal(typeof module?.changePaymentRuntimeTestHealth, "function");
  assert.deepEqual(
    await module.changePaymentRuntimeTestHealth({
      clientConfig: {},
      providerAccountId,
      healthStatus: "HEALTHY",
    }),
    {
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "UNCHANGED",
      healthStatus: "HEALTHY",
      version: 1,
    },
  );
  assert.equal(
    calls.some(([sql]) => /^(INSERT|UPDATE)/u.test(sql)),
    false,
  );
});
test("LIVE accounts are rejected before any mutation", async (t) => {
  const calls = fixture(t, {
    environment: "LIVE",
    health_status: "HEALTHY",
    version: 1,
  });
  const module = await load();
  assert.equal(typeof module?.changePaymentRuntimeTestHealth, "function");
  await assert.rejects(
    module.changePaymentRuntimeTestHealth({
      clientConfig: {},
      providerAccountId,
      healthStatus: "UNAVAILABLE",
    }),
    /TEST/u,
  );
  assert.equal(
    calls.some(([sql]) => /^(INSERT|UPDATE)/u.test(sql)),
    false,
  );
  assert.deepEqual(
    calls.slice(-2).map(([sql]) => sql),
    ["ROLLBACK", "END"],
  );
});
test("commit rejection rolls back and closes without a success result", async (t) => {
  const calls = fixture(t, undefined, true);
  const module = await load();
  assert.equal(typeof module?.changePaymentRuntimeTestHealth, "function");
  await assert.rejects(
    module.changePaymentRuntimeTestHealth({
      clientConfig: {},
      providerAccountId,
      healthStatus: "UNAVAILABLE",
    }),
    /commit/u,
  );
  assert.deepEqual(
    calls.slice(-3).map(([sql]) => sql),
    ["COMMIT", "ROLLBACK", "END"],
  );
});
