import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createOutboxRepository } from "../dist/outbox-repository.js";
import { createPostgresQueryLayer } from "../dist/query-layer.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const instant = (expression) =>
  `to_char((${expression}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
let stage = "MIGRATIONS",
  assertions = 0,
  lastDatabaseError = null;

// Same deliberately isolated source-fixture convention as postgres-repositories.mjs.
// Only TEST source setup bypasses unrelated full order/cart foreign-key histories;
// the real Outbox repository, all its triggers and COMMIT authority checks run normally.
async function seedSource(client, at) {
  const ids = Object.fromEntries(
    [
      "order",
      "publicOrder",
      "session",
      "quote",
      "cart",
      "contact",
      "fulfillment",
      "item",
      "idol",
      "profile",
      "event",
      "request",
      "correlation",
    ].map((key) => [key, randomUUID()]),
  );
  await client.query("SET LOCAL session_replication_role = replica");
  await client.query(
    `INSERT INTO public.orders(id,public_order_id,checkout_session_id,checkout_quote_id,cart_id,customer_contact_id,presentation_locale,market,currency,quote_revision,quote_expires_at,subtotal_minor,tax_amount_minor,shipping_amount_minor,fee_amount_minor,discount_amount_minor,total_amount_minor,order_status,payment_status,dispute_status,fulfillment_status,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'en','TEST','USD',1,'2099-01-01T00:00:00Z',0,0,0,0,0,0,'DRAFT','UNPAID','NONE','PENDING',1,$7,$7)`,
    [
      ids.order,
      ids.publicOrder,
      ids.session,
      ids.quote,
      ids.cart,
      ids.contact,
      at,
    ],
  );
  await client.query(
    `INSERT INTO public.fulfillments(id,order_id,order_item_id,idol_id,fulfillment_profile_id,status,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'PENDING',1,$6,$6)`,
    [ids.fulfillment, ids.order, ids.item, ids.idol, ids.profile, at],
  );
  await client.query(
    `INSERT INTO public.fulfillment_events(id,fulfillment_id,order_id,sequence,to_status,authority_kind,reason_code,request_id,correlation_id,occurred_at) VALUES($1,$2,$3,1,'PENDING','SYSTEM','FULFILLMENT_CREATED',$4,$5,$6)`,
    [ids.event, ids.fulfillment, ids.order, ids.request, ids.correlation, at],
  );
  await client.query("SET LOCAL session_replication_role = origin");
  assert.equal(
    (await client.query("SHOW session_replication_role")).rows[0]
      .session_replication_role,
    "origin",
  );
  assertions++;
  return ids;
}
async function runCase(client, mode) {
  await client.query("BEGIN");
  let open = true;
  try {
    stage = `${mode}_CLOCK_BOUNDARY`;
    const deadline = performance.now() + 5_000;
    let time;
    do {
      time = (
        await client.query(
          `SELECT ${instant("clock_timestamp()")} now,${instant("transaction_timestamp()-interval '1 second'")} past,(extract(epoch FROM clock_timestamp()-transaction_timestamp())*1000000)::bigint::text delta`,
        )
      ).rows[0];
      if (Number(time.delta) >= 20_000) break;
      await client.query("SELECT pg_sleep(0.01)");
    } while (performance.now() < deadline);
    assert.ok(
      Number(time.delta) >= 20_000,
      "real event follows transaction start by at least 20ms without changing any clock",
    );
    assertions++;
    const at = mode === "HISTORICAL" ? time.past : time.now;
    const ids = await seedSource(client, at);
    let rollbackOnly = false;
    const repo = createOutboxRepository(createPostgresQueryLayer(client), {
      markRollbackOnly: () => {
        rollbackOnly = true;
      },
      trackOperation: async (work) => work(),
    });
    const command = {
      schemaVersion: 1,
      operation: "APPEND_OUTBOX_EVENT",
      event: {
        schemaVersion: 1,
        eventId: ids.event,
        eventType: "FULFILLMENT_STATUS_CHANGED",
        aggregateId: ids.fulfillment,
        requestId: ids.request,
        correlationId: ids.correlation,
        occurredAt: mode === "WRONG_SOURCE_TIME" ? time.past : at,
        payload: {
          fulfillmentId: ids.fulfillment,
          orderId: ids.order,
          status: "PENDING",
        },
      },
      aggregateVersion: 1,
      primarySubjectId: ids.fulfillment,
      secondarySubjectId: ids.order,
      market: "TEST",
      currency: "USD",
      idempotencyKey: `test.outbox.event-time:${ids.event}`,
      availableAt: mode === "EARLY_AVAILABLE" ? time.past : at,
    };
    stage = `${mode}_ACTUAL_WRITER`;
    const result = await repo.append(command);
    if (mode === "EARLY_AVAILABLE") {
      assert.equal(result.outcome, "FAILURE");
      assert.equal(result.error.code, "INTEGRITY_VIOLATION");
      assert.deepEqual(lastDatabaseError, {
        code: "23514",
        constraint: "outbox_events_time_check",
      });
      assert.equal(rollbackOnly, true);
      await client.query("ROLLBACK");
      open = false;
      assertions += 4;
      return;
    }
    assert.equal(
      result.outcome,
      "SUCCESS",
      "the actual writer accepts a valid authoritative event after transaction start",
    );
    assertions++;
    stage = `${mode}_COMMIT`;
    if (mode === "WRONG_SOURCE_TIME") {
      await assert.rejects(
        client.query("COMMIT"),
        (error) =>
          error.code === "23514" &&
          error.message === "outbox event has no exact authoritative source",
      );
      open = false;
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::integer count FROM public.outbox_events WHERE id=$1",
            [ids.event],
          )
        ).rows[0].count,
        0,
      );
      assertions += 2;
      return;
    }
    await client.query("COMMIT");
    open = false;
    const row = (
      await client.query(
        `SELECT created_at>=occurred_at created_after_event,available_at>=occurred_at available_after_event,occurred_at=$2::timestamptz event_exact,locale='en' AND market='TEST' AND currency='USD' scope_exact,payload_status='PENDING' status_exact FROM public.outbox_events WHERE id=$1`,
        [ids.event, at],
      )
    ).rows[0];
    assert.deepEqual(row, {
      created_after_event: true,
      available_after_event: true,
      event_exact: true,
      scope_exact: true,
      status_exact: true,
    });
    assertions++;
  } finally {
    if (open) await client.query("ROLLBACK");
  }
}
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(clientConfig);
  await client.connect();
  const query = client.query.bind(client);
  client.query = async (...args) => {
    try {
      return await query(...args);
    } catch (error) {
      lastDatabaseError = {
        code: typeof error.code === "string" ? error.code : null,
        constraint:
          typeof error.constraint === "string" ? error.constraint : null,
      };
      throw error;
    }
  };
  try {
    for (const mode of [
      "AFTER_BEGIN",
      "HISTORICAL",
      "EARLY_AVAILABLE",
      "WRONG_SOURCE_TIME",
    ])
      await runCase(client, mode);
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "PASS",
        assertions,
        scope:
          "Actual outbox repository and original guards with controlled post-BEGIN event, historical event, early-available and mismatched source-time checks; isolated TEST source fixture is not a full checkout",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        stage,
        lastDatabaseError,
        sqlState: typeof error.code === "string" ? error.code : null,
      }) + "\n",
    );
    throw new Error("Outbox event-time probe failed", { cause: error });
  } finally {
    await client.end();
  }
});
