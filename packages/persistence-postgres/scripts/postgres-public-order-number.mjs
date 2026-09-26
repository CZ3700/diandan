#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publicOrderNoSchema } from "@fan-support/contracts";
import { Client } from "pg";

import { readAdminFinance } from "../dist/admin-finance-read.js";
import { readAdminOrdersList } from "../dist/admin-orders-read.js";
import {
  EphemeralPostgresError,
  MigrationExecutionError,
  MigrationManifestError,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

class PublicOrderNumberHarnessError extends Error {}

function fail(message) {
  throw new PublicOrderNumberHarnessError(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} did not match`);
}

function databaseErrorCode(error) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "unknown";
}

async function rollbackQuietly(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The ephemeral PostgreSQL instance is the final cleanup boundary.
  }
}

/** Replica role skips foreign-key and guard triggers so bare order rows can stand in for history. */
async function runReplicaTransaction(client, operation) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function expectFailure(client, operation, code, label) {
  let failure;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  await rollbackQuietly(client);
  if (databaseErrorCode(failure) !== code)
    fail(`${label} did not fail with ${code}`);
}

async function migrate(clientConfig, command) {
  return runMigrations({ clientConfig, workspaceRoot, command });
}

async function insertDraftOrder(client, publicOrderNo) {
  const id = randomUUID();
  const columns = [
    "id",
    "public_order_id",
    "checkout_session_id",
    "checkout_quote_id",
    "cart_id",
    "customer_contact_id",
    "presentation_locale",
    "market",
    "currency",
    "quote_revision",
    "quote_expires_at",
    "subtotal_minor",
    "total_amount_minor",
    "order_status",
    "payment_status",
    "dispute_status",
    "fulfillment_status",
    ...(publicOrderNo === undefined ? [] : ["public_order_no"]),
  ];
  await client.query(
    `INSERT INTO public.orders(${columns.join(",")}) VALUES($1,$2,$3,$4,$5,$6,'en','TEST','USD',1,'2099-01-01T00:00:00Z',100,100,'DRAFT','UNPAID','NONE','PENDING'${publicOrderNo === undefined ? "" : ",$7"})`,
    [
      id,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      ...(publicOrderNo === undefined ? [] : [publicOrderNo]),
    ],
  );
  return id;
}

async function readNumbers(client) {
  const result = await client.query(
    "SELECT id,public_order_no FROM public.orders ORDER BY created_at,id",
  );
  return result.rows;
}

function assertWellFormedAndUnique(rows, label) {
  const numbers = rows.map((row) => row.public_order_no);
  for (const number of numbers)
    if (!publicOrderNoSchema.safeParse(number).success)
      fail(`${label} produced a malformed public order number`);
  assertEqual(new Set(numbers).size, numbers.length, `${label} uniqueness`);
}

async function readColumnShape(client) {
  const result = await client.query(
    `SELECT attribute.attnotnull AS "notNull",
            pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) AS "defaultExpression"
       FROM pg_catalog.pg_attribute attribute
       JOIN pg_catalog.pg_class relation ON relation.oid = attribute.attrelid
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
       LEFT JOIN pg_catalog.pg_attrdef defaults
         ON defaults.adrelid = attribute.attrelid AND defaults.adnum = attribute.attnum
      WHERE namespace.nspname = 'public' AND relation.relname = 'orders'
        AND attribute.attname = 'public_order_no' AND NOT attribute.attisdropped`,
  );
  return result.rows[0];
}

async function assertGeneratorDistribution(client) {
  const result = await client.query(
    "SELECT public.generate_public_order_no() AS value FROM generate_series(1, 2000)",
  );
  const seen = new Set();
  for (const { value } of result.rows) {
    if (!publicOrderNoSchema.safeParse(value).success)
      fail("generator produced a malformed public order number");
    for (const character of value.slice(3)) seen.add(character);
  }
  // 12,000 uniform draws over 32 symbols: a missing symbol means a biased or truncated alphabet.
  assertEqual(seen.size, alphabet.length, "generator alphabet coverage");
}

/** The real list SQL finds an order by a number typed with other case, spacing and read-alike letters. */
async function assertSupportSearch(client, number) {
  const financeList = (query) =>
    readAdminFinance(
      client,
      {
        command: {
          schemaVersion: 1,
          action: "LIST",
          page: 1,
          pageSize: 50,
          query,
          filter: "ALL",
        },
      },
      true,
    );
  const spoken = number
    .slice(3)
    .toLowerCase()
    .replace(/0/gu, "o")
    .replace(/1/gu, "l");
  for (const query of [number, `fs ${spoken}`, number.slice(3, 7)]) {
    const result = await financeList(query);
    if (!result.items?.some((item) => item.publicOrderNo === number))
      fail("finance search did not find the order by its public number");
  }
  const orders = await readAdminOrdersList(client, {
    command: {
      schemaVersion: 1,
      action: "LIST",
      page: 1,
      pageSize: 50,
      query: "FS-ZZZZZZ-no-such-order",
      fulfillment: "ALL",
      moderation: "ALL",
    },
  });
  assertEqual(orders.totalItems, 0, "order search without a match");
}

async function seedRuntimeState(client) {
  const id = randomUUID();
  await runReplicaTransaction(client, () =>
    client.query(
      `INSERT INTO public.notification_runtime_state(notification_delivery_id,source_outbox_event_id,event_rank,base_variables,public_storefront_origin,transport_key,contact_lookup_hmac,contact_lookup_key_version,link_nonce,link_pepper_version,link_ttl_seconds,dedupe_until,created_at,updated_at)
       VALUES($1,$2,1,'{}'::jsonb,'https://shop.example',repeat('a',64),decode(repeat('01',32),'hex'),'lookup-1',decode(repeat('02',32),'hex'),'pepper-1',3600,clock_timestamp()+interval '1 day',clock_timestamp(),clock_timestamp())`,
      [id, randomUUID()],
    ),
  );
  return id;
}

async function runHarness(clientConfig) {
  const client = new Client(clientConfig);
  await client.connect();
  try {
    await migrate(clientConfig, { direction: "up", targetVersion: "0038" });
    const legacy = await runReplicaTransaction(client, async () => [
      await insertDraftOrder(client),
      await insertDraftOrder(client),
      await insertDraftOrder(client),
    ]);

    const upgraded = await migrate(clientConfig, {
      direction: "up",
      targetVersion: "0039",
    });
    assertEqual(upgraded.currentVersion, "0039", "upgraded migration head");
    const backfilled = await readNumbers(client);
    assertEqual(backfilled.length, legacy.length, "backfilled order count");
    assertWellFormedAndUnique(backfilled, "backfill");
    const shape = await readColumnShape(client);
    assertEqual(shape?.notNull, true, "public order number NOT NULL");
    assertEqual(
      shape?.defaultExpression,
      "generate_public_order_no()",
      "public order number default",
    );

    const fresh = await runReplicaTransaction(client, () =>
      insertDraftOrder(client),
    );
    const afterInsert = await readNumbers(client);
    if (!afterInsert.some((row) => row.id === fresh && row.public_order_no))
      fail("new order did not receive a default public order number");
    assertWellFormedAndUnique(afterInsert, "default insert");
    await assertGeneratorDistribution(client);
    await assertSupportSearch(client, backfilled[0].public_order_no);

    const taken = backfilled[0].public_order_no;
    await expectFailure(
      client,
      () =>
        runReplicaTransaction(client, () => insertDraftOrder(client, taken)),
      "23505",
      "duplicate public order number",
    );
    for (const malformed of ["FS-7K3M9", "FS-7K3M9I", "fs-7k3m9c", "7K3M9C"])
      await expectFailure(
        client,
        () =>
          runReplicaTransaction(client, () =>
            insertDraftOrder(client, malformed),
          ),
        "23514",
        `malformed public order number ${malformed}`,
      );
    await expectFailure(
      client,
      async () => {
        await client.query("BEGIN");
        await client.query(
          "UPDATE public.orders SET public_order_no='FS-000000',version=version+1 WHERE id=$1",
          [fresh],
        );
      },
      "55000",
      "public order number immutability",
    );

    const runtime = await seedRuntimeState(client);
    let refused;
    try {
      await migrate(clientConfig, {
        direction: "down",
        confirmVersion: "0039",
      });
    } catch (error) {
      refused = error;
    }
    if (!(refused instanceof MigrationExecutionError))
      fail("downgrade was accepted while notification variables are frozen");
    assertEqual(
      (await readNumbers(client)).length,
      legacy.length + 1,
      "refused downgrade keeps orders",
    );
    await runReplicaTransaction(client, () =>
      client.query(
        "DELETE FROM public.notification_runtime_state WHERE notification_delivery_id=$1",
        [runtime],
      ),
    );

    const downgraded = await migrate(clientConfig, {
      direction: "down",
      confirmVersion: "0039",
    });
    assertEqual(downgraded.currentVersion, "0038", "downgraded migration head");
    if ((await readColumnShape(client)) !== undefined)
      fail("downgrade left the public order number column");
    const reapplied = await migrate(clientConfig, {
      direction: "up",
      targetVersion: "0039",
    });
    assertEqual(reapplied.currentVersion, "0039", "reapplied migration head");
    assertWellFormedAndUnique(await readNumbers(client), "reapplied backfill");
    return { orders: legacy.length + 1 };
  } finally {
    try {
      await client.end();
    } catch {
      // The ephemeral PostgreSQL harness owns process-level cleanup.
    }
  }
}

try {
  const result = await withEphemeralPostgres(async (clientConfig) => {
    try {
      return await runHarness(clientConfig);
    } catch (error) {
      if (
        error instanceof PublicOrderNumberHarnessError ||
        error instanceof MigrationExecutionError ||
        error instanceof MigrationManifestError
      )
        throw new EphemeralPostgresError(error.message);
      throw new EphemeralPostgresError(
        "PostgreSQL public order number integration failed",
      );
    }
  });
  console.log(
    `PostgreSQL public order number migration passed (${result.orders} orders backfilled, constrained and round-tripped).`,
  );
} catch (error) {
  const message =
    error instanceof EphemeralPostgresError
      ? error.message
      : "PostgreSQL public order number integration failed";
  console.error(message);
  process.exitCode = 1;
}
