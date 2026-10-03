import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { withEphemeralPostgres } from "../dist/index.js";

// Targeted real-PG concurrency test of the exact migration trigger. The minimal tables
// deliberately isolate lock ordering; normal publication/payment evidence is separate.
const migration = await readFile(
  new URL(
    "../../../database/migrations/0060_wish-bindings.up.sql",
    import.meta.url,
  ),
  "utf8",
);
const definition = migration.match(
  /CREATE FUNCTION guard_wish_restock\(\)[\s\S]+?END \$\$;/u,
)?.[0];
assert.ok(definition);
await withEphemeralPostgres(async (configuration) => {
  const writer = new Client(configuration),
    holder = new Client(configuration);
  await writer.connect();
  await holder.connect();
  const ids = Array.from({ length: 8 }, () => randomUUID());
  try {
    await writer.query(`CREATE TABLE wish_bindings(wish_id uuid PRIMARY KEY,gift_variant_id uuid,inventory_location_id uuid,gift_id uuid,idol_id uuid);
      CREATE TABLE inventory_items(id uuid PRIMARY KEY,gift_variant_id uuid);
      CREATE TABLE inventory_ledger(inventory_item_id uuid,location_id uuid,delta_on_hand bigint);
      CREATE TABLE wish_supports(wish_id uuid);
      CREATE TABLE gifts(id uuid,published_revision_id uuid);
      CREATE TABLE gift_variants(id uuid,gift_id uuid);
      CREATE TABLE daily_publication_revisions(gift_revision_id uuid,document jsonb);
      CREATE TABLE gift_revision_profiles(gift_revision_id uuid,gift_id uuid,gift_kind text);
      CREATE TABLE support_intents(cart_item_id uuid,idol_id uuid);
      CREATE TABLE inventory_reservations(gift_variant_id uuid,location_id uuid,quantity bigint,cart_item_id uuid);
      CREATE TABLE inventory_balances(id int PRIMARY KEY);
      INSERT INTO inventory_balances VALUES(1);`);
    await writer.query("INSERT INTO wish_bindings VALUES($1,$2,$3,$4,$5)", [
      ids[0],
      ids[1],
      ids[2],
      ids[4],
      ids[7],
    ]);
    await writer.query("INSERT INTO inventory_items VALUES($1,$2)", [
      ids[3],
      ids[1],
    ]);
    await writer.query("INSERT INTO gifts VALUES($1,$2)", [ids[4], ids[5]]);
    await writer.query("INSERT INTO gift_variants VALUES($1,$2)", [
      ids[1],
      ids[4],
    ]);
    await writer.query(
      "INSERT INTO daily_publication_revisions VALUES($1,$2)",
      [ids[5], { giftKind: "WISH" }],
    );
    await writer.query("INSERT INTO support_intents VALUES($1,$2)", [
      ids[6],
      ids[7],
    ]);
    for (const name of [
      "current_gift_kind",
      "wish_recipient_matches",
      "wish_recipient_allowed",
      "guard_wish_reservation",
    ]) {
      const statement = migration.match(
        new RegExp("CREATE FUNCTION " + name + "\\([\\s\\S]+?\\$\\$;", "u"),
      )?.[0];
      assert.ok(statement, name);
      await writer.query(statement);
    }
    await writer.query(
      "CREATE TRIGGER wish_reservation_guard BEFORE INSERT ON inventory_reservations FOR EACH ROW EXECUTE FUNCTION guard_wish_reservation()",
    );
    await writer.query(definition);
    await writer.query(
      "CREATE TRIGGER wish_restock_guard BEFORE INSERT ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION guard_wish_restock()",
    );
    await holder.query("BEGIN");
    await holder.query("SELECT wish_id FROM wish_bindings FOR UPDATE");
    for (const delta of [0, -1]) {
      await writer.query("BEGIN");
      await writer.query("SET LOCAL statement_timeout='200ms'");
      try {
        try {
          await writer.query("INSERT INTO inventory_ledger VALUES($1,$2,$3)", [
            ids[3],
            ids[2],
            delta,
          ]);
        } catch (error) {
          console.error(
            JSON.stringify({
              result: "FAIL",
              stage: "nonpositive delta must not wait for wish lock",
              delta,
              code: error.code,
            }),
          );
          throw error;
        }
      } finally {
        await writer.query("ROLLBACK");
      }
    }
    await writer.query("BEGIN");
    await writer.query("SET LOCAL statement_timeout='200ms'");
    await assert.rejects(
      writer.query("INSERT INTO inventory_ledger VALUES($1,$2,1)", [
        ids[3],
        ids[2],
      ]),
      { code: "57014" },
    );
    await writer.query("ROLLBACK");
    await writer.query("BEGIN");
    await writer.query("SELECT id FROM inventory_balances FOR UPDATE");
    await writer.query("SET LOCAL statement_timeout='200ms'");
    try {
      await writer.query(
        "INSERT INTO inventory_reservations VALUES($1,$2,1,$3)",
        [ids[1], ids[2], ids[6]],
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          result: "FAIL",
          stage: "reservation holding balance must not wait for wish lock",
          code: error.code,
        }),
      );
      throw error;
    } finally {
      await writer.query("ROLLBACK");
    }
    await holder.query("ROLLBACK");
    for (const [location, quantity, cartItem] of [
      [ids[2], 2, ids[6]],
      [randomUUID(), 1, ids[6]],
      [ids[2], 1, randomUUID()],
    ]) {
      await assert.rejects(
        writer.query("INSERT INTO inventory_reservations VALUES($1,$2,$3,$4)", [
          ids[1],
          location,
          quantity,
          cartItem,
        ]),
        /wish reservation requires its sole available gift and artist/u,
      );
    }
    await writer.query("INSERT INTO wish_supports VALUES($1)", [ids[0]]);
    await assert.rejects(
      writer.query("INSERT INTO inventory_reservations VALUES($1,$2,1,$3)", [
        ids[1],
        ids[2],
        ids[6],
      ]),
      /wish reservation requires its sole available gift and artist/u,
    );
    console.log(
      JSON.stringify({
        result: "PASS",
        checks: 8,
        scope:
          "real PostgreSQL exact guards: zero/negative ledger and reservation avoid reverse wish locks; positive restock serializes; wrong quantity/location/recipient and supported wish reject",
      }),
    );
  } finally {
    await holder.end();
    await writer.end();
  }
});
