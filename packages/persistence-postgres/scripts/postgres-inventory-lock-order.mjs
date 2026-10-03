#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  setImmediate as yieldToEventLoop,
  setTimeout as delay,
} from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { withEphemeralPostgres, runMigrations } from "../dist/index.js";
import { createPostgresQueryLayer } from "../dist/query-layer.js";
import { createInventoryRepository } from "../dist/inventory-repository.js";
import {
  lockCheckoutVariantKeys,
  readCheckoutInventoryItems,
  readCheckoutInventoryLocations,
} from "../dist/checkout-preflight-current.js";

// Audit TXN-01: real checkout, reservation-transition and studio-adjustment row locks on
// the migrated schema. Seeds skip triggers; every probed lock is the production statement.
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const CHECKOUTS = 12;
const DISTINCT_GIFTS = 10;
const id = (group, n) =>
  `64000000-0000-4000-8000-${String(group * 1000 + n).padStart(12, "0")}`;

async function seed(client) {
  const location = id(9, 1),
    lines = [];
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role = replica");
  await client.query(
    `INSERT INTO inventory_locations (id, location_key, status, created_at) VALUES ($1, 'LOCK_ORDER', 'ACTIVE', now())`,
    [location],
  );
  for (let n = 1; n <= DISTINCT_GIFTS; n++) {
    const line = { giftId: id(1, n), variantId: id(2, n), itemId: id(3, n) };
    await client.query(
      `INSERT INTO gift_variants (id, gift_id, sku, status, inventory_policy, version, created_at, updated_at) VALUES ($1, $2, $3, 'active', 'TRACKED', 1, now(), now())`,
      [line.variantId, line.giftId, `LOCK-ORDER-${n}`],
    );
    await client.query(
      `INSERT INTO inventory_items (id, gift_variant_id, sku, policy, status, created_at) VALUES ($1, $2, $3, 'TRACKED', 'ACTIVE', now())`,
      [line.itemId, line.variantId, `LOCK-ORDER-${n}`],
    );
    await client.query(
      `INSERT INTO inventory_balances (inventory_item_id, location_id, on_hand, reserved, version, updated_at) VALUES ($1, $2, 10, 0, 1, now())`,
      [line.itemId, location],
    );
    lines.push(line);
  }
  await client.query("COMMIT");
  return { location, lines };
}

async function session(config, name) {
  const client = new Client({ ...config, application_name: name });
  await client.connect();
  // A lock-order regression must fail this script, never hang it.
  await client.query("SET lock_timeout = '20s'");
  return client;
}

function repository(client) {
  const failures = [];
  return {
    failures,
    inventory: createInventoryRepository(createPostgresQueryLayer(client), {
      trackOperation: (work) => work(),
      markRollbackOnly: (failure) => failures.push(failure),
    }),
  };
}

async function lockForUpdate(client, line, location) {
  const { inventory, failures } = repository(client);
  const result = await inventory.loadManyForUpdate({
    schemaVersion: 1,
    operation: "LOAD_INVENTORY_FOR_UPDATE",
    targets: [{ inventoryItemId: line.itemId, inventoryLocationId: location }],
  });
  if (result.outcome !== "SUCCESS")
    throw Object.assign(new Error("inventory lock failed"), {
      code: result.error?.code,
      failures,
    });
  assert.equal(result.value.items.length, 1);
}

/** The preflight statements, in the order loadCheckoutCurrent runs them. */
async function preflightLocks(client, line) {
  await lockCheckoutVariantKeys(client, [line.variantId]);
  const items = await readCheckoutInventoryItems(client, line.variantId);
  assert.equal(items.length, 1);
  assert.ok((await readCheckoutInventoryLocations(client, line.itemId)).length);
}

/** gift-commerce-inventory-data.ts order: variant → location → item → balance. */
async function studioAdjustment(client, line, location, beforeItem) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query(
    "SELECT * FROM public.gift_variants WHERE id=$1 FOR UPDATE",
    [line.variantId],
  );
  await client.query(
    "SELECT id FROM public.inventory_locations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
    [location],
  );
  await beforeItem?.();
  await client.query(
    "SELECT * FROM public.inventory_items WHERE gift_variant_id=$1 FOR UPDATE",
    [line.variantId],
  );
  await client.query(
    "SELECT * FROM public.inventory_balances WHERE inventory_item_id=$1 AND location_id=$2 FOR UPDATE",
    [line.itemId, location],
  );
  await client.query("COMMIT");
}

function track(promise) {
  const state = { settled: false, error: undefined };
  state.promise = promise.then(
    () => {
      state.settled = true;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

async function waitForLockOrSettle(observer, name, state, expectWait) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE application_name=$1",
      [name],
    );
    if (rows.some((row) => row.wait_event_type === "Lock")) return "WAITING";
    if (state.settled && !expectWait) return "SETTLED";
    await yieldToEventLoop();
  }
  throw new Error(`${name} neither waited on a row lock nor settled`);
}

async function deadlocks(observer) {
  await observer.query("SELECT pg_stat_clear_snapshot()");
  const { rows } = await observer.query(
    "SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname=current_database()",
  );
  return rows[0].n;
}

/** Ended backends flush their counters; wait until the cumulative value stops moving. */
async function settledDeadlocks(observer) {
  let previous = await deadlocks(observer),
    stableSince = Date.now();
  while (Date.now() - stableSince < 1500) {
    await delay(100);
    const current = await deadlocks(observer);
    if (current !== previous) {
      previous = current;
      stableSince = Date.now();
    }
  }
  return previous;
}

const codeOf = (error) => error?.code ?? error?.message ?? null;

await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot,
    command: { direction: "up" },
  });
  const observer = new Client({
    ...config,
    application_name: "lock-order-observer",
  });
  await observer.connect();
  const report = {};
  try {
    const { location, lines } = await seed(observer);
    const before = await settledDeadlocks(observer);

    // A: every checkout holds its preflight shares at the same location before any locks for update.
    const checkouts = await Promise.all(
      Array.from({ length: CHECKOUTS }, (_, k) =>
        session(config, `lock-order-checkout-${k}`),
      ),
    );
    const targets = checkouts.map((_, k) => lines[k % DISTINCT_GIFTS]);
    try {
      for (const [k, client] of checkouts.entries()) {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await preflightLocks(client, targets[k]);
      }
      // Two pairs share a gift: they queue on its balance row instead of deadlocking.
      const outcomes = await Promise.allSettled(
        checkouts.map(async (client, k) => {
          await lockForUpdate(client, targets[k], location);
          await client.query("COMMIT");
        }),
      );
      report.sameLocationCheckouts = outcomes.map((o) =>
        o.status === "fulfilled" ? "COMMITTED" : codeOf(o.reason),
      );
    } finally {
      await Promise.all(checkouts.map((client) => client.end()));
    }
    assert.deepEqual(
      report.sameLocationCheckouts,
      Array(CHECKOUTS).fill("COMMITTED"),
      "concurrent checkouts at one location all commit",
    );

    // C: the studio starts adjusting the variant while a checkout holds its preflight shares.
    {
      const checkout = await session(config, "lock-order-checkout-c"),
        studio = await session(config, "lock-order-studio-c"),
        line = lines[0];
      try {
        await checkout.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await preflightLocks(checkout, line);
        const adjusting = track(studioAdjustment(studio, line, location));
        await waitForLockOrSettle(
          observer,
          "lock-order-studio-c",
          adjusting,
          true,
        );
        const continuing = track(
          (async () => {
            await lockForUpdate(checkout, line, location);
            // What the order-line and reservation foreign keys run at insert or commit.
            await checkout.query(
              "SELECT 1 FROM ONLY public.gift_variants x WHERE id=$1 FOR KEY SHARE OF x",
              [line.variantId],
            );
            await checkout.query("COMMIT");
          })(),
        );
        await continuing.promise;
        await adjusting.promise;
        report.checkoutVersusStudio = [
          continuing.error ? codeOf(continuing.error) : "COMMITTED",
          adjusting.error ? codeOf(adjusting.error) : "COMMITTED",
        ];
      } finally {
        await checkout.end();
        await studio.end();
      }
      assert.deepEqual(
        report.checkoutVersusStudio,
        ["COMMITTED", "COMMITTED"],
        "checkout and studio adjustment of one variant both commit",
      );
    }

    // D: a reservation transition (payment, expiry, cancel) locks while the studio holds the
    // location share. A regression guard: the old single statement deadlocked only for some row orders.
    {
      const transition = await session(config, "lock-order-transition-d"),
        studio = await session(config, "lock-order-studio-d"),
        line = lines[1];
      let locking;
      try {
        await transition.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const adjusting = track(
          studioAdjustment(studio, line, location, async () => {
            locking = track(
              (async () => {
                await lockForUpdate(transition, line, location);
                await transition.query("COMMIT");
              })(),
            );
            await waitForLockOrSettle(
              observer,
              "lock-order-transition-d",
              locking,
              false,
            );
          }),
        );
        await adjusting.promise;
        await locking?.promise;
        report.transitionVersusStudio = [
          locking?.error ? codeOf(locking.error) : "COMMITTED",
          adjusting.error ? codeOf(adjusting.error) : "COMMITTED",
        ];
      } finally {
        await transition.end();
        await studio.end();
      }
      assert.deepEqual(
        report.transitionVersusStudio,
        ["COMMITTED", "COMMITTED"],
        "reservation transition and studio adjustment both commit",
      );
    }

    report.deadlocks = (await settledDeadlocks(observer)) - before;
    assert.equal(report.deadlocks, 0, "PostgreSQL recorded no deadlock");
    console.log(JSON.stringify({ status: "PASS", ...report }));
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", ...report }));
    throw error;
  } finally {
    await observer.end();
  }
});
