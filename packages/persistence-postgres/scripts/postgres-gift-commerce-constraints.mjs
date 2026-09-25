#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import {
  runMigrations,
  loadMigrationManifest,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let stage = "migration",
  assertions = 0;
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const client = new Client(clientConfig);
  await client.connect();
  try {
    const fixture = await seedCatalogDirectoryFixtures(client, 2);
    const extraVariant = randomUUID();
    await client.query(
      "INSERT INTO gift_variants(id,gift_id,sku,status,inventory_policy) VALUES($1,$2,$3,'draft','PROCURE_ON_DEMAND')",
      [
        extraVariant,
        fixture.gifts[0].id,
        `PRICE-${randomUUID().toUpperCase()}`,
      ],
    );
    await runMigrationCommandOnSession(
      {
        query: async (sql, values) => {
          try {
            return await client.query(sql, values);
          } catch (error) {
            process.stderr.write(
              `${JSON.stringify({ phase: "MIGRATION", code: error.code, position: error.position, constraint: error.constraint })}\n`,
            );
            throw error;
          }
        },
      },
      await loadMigrationManifest({ workspaceRoot }),
      { direction: "up" },
    );
    const failures = [];
    async function rejects(label, work) {
      stage = label;
      await client.query("BEGIN");
      let rejected = false;
      try {
        await work();
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      } catch (error) {
        if (!["23514", "55000"].includes(error.code)) throw error;
        rejected = true;
      } finally {
        await client.query("ROLLBACK");
      }
      if (!rejected) failures.push(label);
      else assertions++;
    }
    await rejects("new gift requires exact receipt", () =>
      client.query(
        "INSERT INTO gifts(id,handle,status) VALUES(gen_random_uuid(),$1,'draft')",
        [`unreceipted-${randomUUID()}`],
      ),
    );
    await rejects("new variant requires exact receipt", () =>
      client.query(
        "INSERT INTO gift_variants(id,gift_id,sku,status,inventory_policy) VALUES(gen_random_uuid(),$1,$2,'draft','PROCURE_ON_DEMAND')",
        [fixture.gifts[0].id, `UNRECEIPTED-${randomUUID().toUpperCase()}`],
      ),
    );
    await rejects("published price set is sealed against later rows", () =>
      client.query(
        "INSERT INTO prices(id,price_book_id,price_book_revision,market,currency,gift_variant_id,revision,amount_minor,valid_from,status) SELECT gen_random_uuid(),id,revision,market,currency,$2,revision,777,valid_from,'PUBLISHED' FROM price_books WHERE id=$1 AND revision=1",
        [fixture.prices.bookId, extraVariant],
      ),
    );
    await rejects(
      "administrative inventory adjustment requires exact current authority and receipt",
      async () => {
        const {
          rows: [balance],
        } = await client.query(
          "SELECT b.*,i.gift_variant_id FROM inventory_balances b JOIN inventory_items i ON i.id=b.inventory_item_id ORDER BY b.inventory_item_id,b.location_id LIMIT 1 FOR UPDATE OF b,i",
        );
        await client.query(
          "UPDATE inventory_balances SET on_hand=on_hand+1,version=version+1,updated_at=transaction_timestamp() WHERE inventory_item_id=$1 AND location_id=$2",
          [balance.inventory_item_id, balance.location_id],
        );
        await client.query(
          "INSERT INTO inventory_ledger(id,inventory_item_id,location_id,balance_version_before,balance_version_after,delta_on_hand,delta_reserved,reason_code,source_type,source_id,idempotency_key,actor_kind,admin_identity_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,1,0,'MANUAL_CORRECTION','ADJUSTMENT',gen_random_uuid(),$5,'ADMIN',$6)",
          [
            balance.inventory_item_id,
            balance.location_id,
            balance.version,
            Number(balance.version) + 1,
            randomUUID(),
            fixture.editor,
          ],
        );
      },
    );
    process.stdout.write(
      `${JSON.stringify({ stage: "constraint boundaries", assertions, missingGuards: failures })}\n`,
    );
    assert.deepEqual(
      failures,
      [],
      "new commerce operations must not bypass their immutable receipts",
    );
    process.stdout.write(
      `gift commerce constraint PostgreSQL: ${assertions} assertions PASS\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ stage, assertions, code: error.code ?? "ASSERTION", constraint: error.constraint })}\n`,
    );
    throw error;
  } finally {
    await client.end();
  }
}).catch(() => {
  process.exitCode = 1;
});
