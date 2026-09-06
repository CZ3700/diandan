#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  runMigrations,
  loadMigrationManifest,
  withEphemeralPostgres,
} from "../dist/index.js";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import { createGiftCommercePricingRepository } from "../dist/gift-commerce-pricing-repository.js";
import { createGiftCommerceInventoryRepository } from "../dist/gift-commerce-inventory-repository.js";
import { createGiftCommerceAuthorizationRepository } from "../dist/gift-commerce-authorization-repository.js";
import {
  seedGiftCommerceLegacyPrices,
  verifyGiftCommercePriceSealing,
} from "./postgres-gift-commerce-price-sealing.mjs";
import { verifyGiftCommerceInventoryTime } from "./postgres-gift-commerce-time-cases.mjs";
import { verifyGiftCommerceContentTime } from "./postgres-gift-commerce-content-time.mjs";
import { verifyGiftCommerceAtomicity } from "./postgres-gift-commerce-atomicity.mjs";
import { verifyGiftCommerceConcurrency } from "./postgres-gift-commerce-concurrency.mjs";
import { verifyGiftCommerceCatalogCases } from "./postgres-gift-commerce-catalog-cases.mjs";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";
import { seedGiftCommerceAuthority } from "./postgres-gift-commerce-fixtures.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let stage = "migration",
  assertions = 0;
const check = (actual, expected, label) => {
  stage = label;
  assert.deepEqual(actual, expected, label);
  assertions++;
};
await withEphemeralPostgres(async (config) => {
  await runMigrations({
    clientConfig: config,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const client = new Client(config);
  await client.connect();
  try {
    const fixtures = await seedCatalogDirectoryFixtures(client, 2);
    const legacyPrices = await seedGiftCommerceLegacyPrices(client, {
      editor: fixtures.editor,
    });
    const credentials = await seedGiftCommerceAuthority(client, {
      actorId: fixtures.editor,
    });
    await runMigrationCommandOnSession(
      {
        query: async (sql, values) => {
          try {
            return await client.query(sql, values);
          } catch (e) {
            process.stderr.write(
              `${JSON.stringify({ phase: "MIGRATION", code: e.code, position: e.position, constraint: e.constraint })}\n`,
            );
            throw e;
          }
        },
      },
      await loadMigrationManifest({ workspaceRoot }),
      { direction: "up" },
    );
    const scope = {
      trackOperation: async (work) => work(),
      markRollbackOnly: () => undefined,
    };
    let authoringClockProbeQueries = 0;
    const sqlClient = {
      query: async (sql, values) => {
        const sqlText = typeof sql === "string" ? sql : sql.text;
        const earlierAuthoringClock =
          authoringClockProbeQueries === 0 &&
          sqlText.startsWith("SELECT to_char(GREATEST(") &&
          sqlText.includes("FROM public.gift_revisions p");
        const statementText = earlierAuthoringClock
          ? sqlText.replace(
              "GREATEST(clock_timestamp(),",
              "GREATEST((clock_timestamp()+interval '2 seconds'),",
            )
          : sqlText;
        if (earlierAuthoringClock) authoringClockProbeQueries++;
        try {
          return await client.query(
            statementText === sqlText
              ? sql
              : typeof sql === "string"
                ? statementText
                : { ...sql, text: statementText },
            values,
          );
        } catch (e) {
          process.stderr.write(
            `${JSON.stringify({
              stage,
              code: e.code,
              constraint: e.constraint,
              position: e.position,
              routine: e.routine,
              functionCode: [
                "gift_commerce_price_payload",
                "gift_commerce_price_hash",
                "to_char",
              ].find((name) => String(e.message).includes(name)),
              giftCommerceSessionGuard:
                String(e.message).includes("gift commerce") &&
                String(e.message).includes("session"),
              statementKind:
                typeof sql === "string"
                  ? sql
                      .split(/\s+/u)
                      .slice(0, 3)
                      .map((part) =>
                        /^[A-Za-z_.]+$/u.test(part) ? part : "EXPRESSION",
                      )
                      .join(" ")
                  : "QUERY_CONFIG",
            })}\n`,
          );
          throw e;
        }
      },
    };
    const pricing = createGiftCommercePricingRepository(sqlClient, scope),
      inventory = createGiftCommerceInventoryRepository(sqlClient, scope),
      auth = createGiftCommerceAuthorizationRepository(sqlClient, scope);
    async function tx(work) {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        const result = await work();
        if (result?.outcome === "FAILURE") await client.query("ROLLBACK");
        else {
          await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          await client.query("COMMIT");
        }
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    const write = async (repo, command) =>
      tx(async () => {
        const authority = await auth.authorize({
          schemaVersion: 1,
          sessionTokenDigest: credentials.sessionTokenDigest,
          csrfTokenDigest: credentials.csrfTokenDigest,
          permission: repo === pricing ? "pricing.manage" : "inventory.manage",
          locales: [],
        });
        check(authority.outcome, "SUCCESS", "canonical authorized mutation");
        return repo.write({
          schemaVersion: 1,
          principal: authority.principal,
          requestId: randomUUID(),
          command: {
            schemaVersion: 1,
            reasonCode: "COMMERCE_VERIFICATION",
            idempotencyKey: randomUUID(),
            ...command,
          },
        });
      });
    const read = (command) =>
      tx(() => pricing.read({ schemaVersion: 1, ...command }));
    const mutation = async (repo, command, label) => {
      stage = label;
      const r = await write(repo, command);
      check(r.outcome, "SUCCESS", label);
      return r;
    };
    await verifyGiftCommerceCatalogCases({
      client: sqlClient,
      scope,
      fixtures,
      credentials,
      check,
      tx,
    });
    check(
      authoringClockProbeQueries,
      1,
      "gift content bridge survives one earlier wall-clock observation with unchanged expiry guards",
    );
    await verifyGiftCommercePriceSealing({
      client: sqlClient,
      pricing,
      write,
      tx,
      legacy: legacyPrices,
      check,
    });
    const {
      rows: [market],
    } = await client.query(
      "SELECT market,currency,id,revision FROM price_books WHERE id=$1 AND revision=1",
      [fixtures.prices.bookId],
    );
    const priceRead = {
      action: "READ_PRICES",
      market: market.market,
      currency: market.currency,
      page: 1,
      pageSize: 50,
    };
    const initial = await read({ ...priceRead, revision: 1 });
    check(initial.kind, "PRICES", "prices read canonical whole source");
    const context = await read({ action: "CONTEXT" });
    check(context.kind, "COMMERCE_CONTEXT", "safe commerce context loads");
    check(
      "permissions" in context,
      false,
      "raw context cannot invent authorization",
    );
    check(
      (await read({ ...priceRead, currency: "ZZZ", revision: null })).code,
      "NOT_FOUND",
      "unconfigured currency cannot be read as a configured price context",
    );
    check(
      (
        await write(pricing, {
          action: "CREATE_PRICE_REVISION",
          market: market.market,
          currency: "ZZZ",
          expectedBookRevision: 0,
          expectedHeadVersion: 0,
          source: null,
          validFrom: initial.book.validFrom,
          validUntil: null,
          changes: [
            {
              giftVariantId: initial.items[0].giftVariantId,
              unitAmountMinor: 1,
            },
          ],
        })
      ).code,
      "NOT_FOUND",
      "unconfigured currency cannot be introduced through price authoring",
    );
    const create = (
      book,
      expectedBookRevision,
      expectedHeadVersion,
      changes,
    ) => ({
      action: "CREATE_PRICE_REVISION",
      market: market.market,
      currency: market.currency,
      expectedBookRevision,
      expectedHeadVersion,
      source: {
        priceBookId: book.priceBookId,
        revision: book.revision,
        contentHash: book.contentHash,
      },
      validFrom: book.validFrom,
      validUntil: book.validUntil,
      changes,
    });
    const first = await mutation(
      pricing,
      create(initial.book, 1, 1, [
        { giftVariantId: initial.items[0].giftVariantId, unitAmountMinor: 901 },
      ]),
      "copy complete source price book",
    );
    const copied = await read({ ...priceRead, revision: first.revision });
    check(
      copied.items.length,
      initial.items.length,
      "copy retains all unrelated variant prices",
    );
    check(
      copied.items.find(
        (p) => p.giftVariantId === initial.items[0].giftVariantId,
      ).unitAmountMinor,
      901,
      "copy applies explicit amount",
    );
    const copiedUntouched = copied.items
      .filter((p) => p.giftVariantId !== initial.items[0].giftVariantId)
      .map((p) => [p.giftVariantId, p.unitAmountMinor]);
    check(
      copiedUntouched,
      initial.items
        .filter((p) => p.giftVariantId !== initial.items[0].giftVariantId)
        .map((p) => [p.giftVariantId, p.unitAmountMinor]),
      "copy preserves untouched source amounts",
    );
    const publish = async (book, head) =>
      mutation(
        pricing,
        {
          action: "PUBLISH_PRICE_BOOK",
          market: market.market,
          currency: market.currency,
          priceBookId: book.priceBookId,
          revision: book.revision,
          expectedHeadVersion: head,
          expectedContentHash: book.contentHash,
        },
        "publish exact new price head",
      );
    const p2 = await publish(copied.book, 1);
    check(p2.headVersion, 2, "publication head advances independently");
    const third = await mutation(
      pricing,
      create(copied.book, 2, 2, [
        { giftVariantId: initial.items[0].giftVariantId, unitAmountMinor: 902 },
      ]),
      "second price authoring",
    );
    const thirdBook = (await read({ ...priceRead, revision: third.revision }))
      .book;
    await publish(thirdBook, 2);
    const rollback = await mutation(
      pricing,
      {
        action: "ROLLBACK_PRICE_BOOK",
        market: market.market,
        currency: market.currency,
        priceBookId: copied.book.priceBookId,
        revision: 2,
        expectedHeadVersion: 3,
        expectedContentHash: copied.book.contentHash,
      },
      "rollback creates immutable new publication event",
    );
    check(
      rollback.headVersion,
      4,
      "rollback version follows publication sequence",
    );
    const after = await read({ ...priceRead, revision: 2 });
    check(
      after.book.lifecycle.status,
      "SUPERSEDED",
      "rollback does not rewrite historical book lifecycle",
    );
    check(after.head.revision, 2, "rollback selects historical revision");
    check(
      after.authoringVersion,
      3,
      "authoring maximum does not follow rollback",
    );
    const fourth = await mutation(
      pricing,
      create(after.book, 3, 4, [
        { giftVariantId: initial.items[0].giftVariantId, unitAmountMinor: 903 },
      ]),
      "author after rollback copies explicit actual head",
    );
    check(fourth.revision, 4, "author after rollback advances maximum");
    const stale = await write(
      pricing,
      create(after.book, 2, 4, [
        { giftVariantId: initial.items[0].giftVariantId, unitAmountMinor: 9 },
      ]),
    );
    check(stale.code, "STALE_VERSION", "stale authoring maximum rejects");
    const wrongSource = await write(
      pricing,
      create({ ...after.book, contentHash: "f".repeat(64) }, 4, 4, [
        { giftVariantId: initial.items[0].giftVariantId, unitAmountMinor: 9 },
      ]),
    );
    check(wrongSource.code, "STALE_CONTENT", "wrong source hash rejects");
    const receipt = await tx(() =>
      pricing.readReceipt({
        schemaVersion: 1,
        resultId: first.resultId,
        actorId: fixtures.editor,
      }),
    );
    check(
      receipt,
      first,
      "immutable creation receipt replays after later heads",
    );
    const missingReceipt = await tx(() =>
      pricing.readReceipt({
        schemaVersion: 1,
        resultId: first.resultId,
        actorId: fixtures.reviewer,
      }),
    );
    check(missingReceipt.code, "NOT_FOUND", "receipt replay is actor bound");
    const location = await mutation(
      inventory,
      {
        action: "CREATE_INVENTORY_LOCATION",
        code: `WAREHOUSE_${randomUUID().replaceAll("-", "").toUpperCase()}`,
        expectedVersion: 0,
      },
      "audited inventory location registration",
    );
    const {
      rows: [tracked],
    } = await client.query(
      "SELECT id,version FROM gift_variants WHERE inventory_policy='TRACKED' ORDER BY id LIMIT 1",
    );
    const adjustment = {
      action: "ADJUST_INVENTORY",
      giftVariantId: tracked.id,
      inventoryLocationId: location.inventoryLocationId,
      expectedVariantVersion: Number(tracked.version),
      expectedBalanceVersion: 0,
      deltaOnHand: 10,
    };
    const added = await mutation(
      inventory,
      adjustment,
      "first positive balance and ledger are atomic",
    );
    const less = await mutation(
      inventory,
      { ...adjustment, expectedBalanceVersion: 1, deltaOnHand: -3 },
      "negative on-hand adjustment preserves reserved",
    );
    check(less.balanceVersion, 2, "balance version advances exactly once");
    const balance = await tx(() =>
      inventory.read({
        schemaVersion: 1,
        action: "READ_INVENTORY",
        giftVariantId: tracked.id,
        inventoryLocationId: location.inventoryLocationId,
        view: "BALANCES",
        page: 1,
        pageSize: 20,
      }),
    );
    check(
      balance.items.map((b) => [b.onHand, b.reserved, b.version]),
      [[7, 0, 2]],
      "ledger sums equal canonical balance",
    );
    const bad = await write(inventory, {
      ...adjustment,
      expectedBalanceVersion: 2,
      deltaOnHand: -8,
    });
    check(
      bad.code,
      "INSUFFICIENT_INVENTORY",
      "cannot reduce below reserved or zero",
    );
    const staleBalance = await write(inventory, {
      ...adjustment,
      expectedBalanceVersion: 1,
      deltaOnHand: 1,
    });
    check(
      staleBalance.code,
      "STALE_VERSION",
      "stale balance cannot overwrite later adjustment",
    );
    const history = await tx(() =>
      inventory.read({
        schemaVersion: 1,
        action: "READ_INVENTORY",
        giftVariantId: tracked.id,
        inventoryLocationId: location.inventoryLocationId,
        view: "LEDGER",
        page: 1,
        pageSize: 20,
      }),
    );
    check(history.items.length, 2, "ledger retains both adjustments");
    check(
      history.items.every(
        (e) => !("idempotencyKey" in e) && !("sourceId" in e),
      ),
      true,
      "ledger read omits replay and private linkage keys",
    );
    const {
      rows: [nontracked],
    } = await client.query(
      "SELECT id,version FROM gift_variants WHERE inventory_policy<>'TRACKED' ORDER BY id LIMIT 1",
    );
    check(
      (
        await write(inventory, {
          ...adjustment,
          giftVariantId: nontracked.id,
          expectedVariantVersion: Number(nontracked.version),
        })
      ).code,
      "INVENTORY_NOT_TRACKED",
      "stock-free variant cannot receive tracked adjustments",
    );
    check(
      (
        await tx(() =>
          inventory.readReceipt({
            schemaVersion: 1,
            resultId: added.resultId,
            actorId: fixtures.editor,
          }),
        )
      ).balanceVersion,
      1,
      "old adjustment receipt remains exact after new balance",
    );
    const fourthBook = (await read({ ...priceRead, revision: 4 })).book;
    await verifyGiftCommerceConcurrency({
      config,
      credentials,
      check,
      priceCommand: {
        action: "PUBLISH_PRICE_BOOK",
        market: market.market,
        currency: market.currency,
        priceBookId: fourthBook.priceBookId,
        revision: 4,
        expectedHeadVersion: 4,
        expectedContentHash: fourthBook.contentHash,
      },
      inventoryCommand: {
        ...adjustment,
        expectedBalanceVersion: 2,
        deltaOnHand: 1,
      },
    });
    const afterRace = await read({ ...priceRead, revision: 4 });
    check(
      afterRace.head.version,
      5,
      "concurrent price publication advances exactly once",
    );
    const {
      rows: [afterBalanceRace],
    } = await client.query(
      "SELECT version,on_hand FROM public.inventory_balances WHERE inventory_item_id=$1 AND location_id=$2",
      [added.inventoryItemId, location.inventoryLocationId],
    );
    check(
      [Number(afterBalanceRace.version), Number(afterBalanceRace.on_hand)],
      [3, 8],
      "concurrent adjustment creates one canonical ledger step",
    );
    await verifyGiftCommerceAtomicity({
      client: sqlClient,
      write,
      pricing,
      inventory,
      check,
      priceCommand: create(fourthBook, 4, 5, [
        { giftVariantId: initial.items[0].giftVariantId, unitAmountMinor: 904 },
      ]),
      inventoryCommand: {
        ...adjustment,
        expectedBalanceVersion: 3,
        deltaOnHand: 2,
      },
    });
    await verifyGiftCommerceInventoryTime({
      client: sqlClient,
      scope,
      credentials,
      check,
      command: { ...adjustment, expectedBalanceVersion: 4, deltaOnHand: 1 },
    });
    check(
      (
        await client.query(
          "SELECT public.gift_commerce_variant_policy_locked($1) AS locked",
          [tracked.id],
        )
      ).rows[0].locked,
      true,
      "inventory history freezes variant inventory policy",
    );
    await client.query("BEGIN");
    let downRejected = false;
    try {
      await client.query(
        (await loadMigrationManifest({ workspaceRoot })).at(-1).down.sql,
      );
    } catch (e) {
      downRejected = e.code === "55000";
    } finally {
      await client.query("ROLLBACK");
    }
    check(downRejected, true, "down migration preserves commerce history");
    await verifyGiftCommerceContentTime({
      client,
      config,
      actorId: fixtures.editor,
      check,
    });
    process.stdout.write(
      `gift commerce PostgreSQL: ${assertions} assertions PASS\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ stage, assertions, code: error.code ?? error.failure?.error?.code ?? "ASSERTION", constraint: error.constraint, type: error.name })}\n`,
    );
    throw error;
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}).catch(() => {
  process.exitCode = 1;
});
