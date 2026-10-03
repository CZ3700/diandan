#!/usr/bin/env node
// Independent L2-02 audit: real migrated PG + normal-trigger, audited commerce writers.
// Identity/market/session are synthetic test setup. This does not certify a normal daily
// publication, checkout deduction, object pipeline, production credentials or deployment.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createGiftCommerceCatalogRepository } from "../dist/gift-commerce-gift-repository.js";
import { createGiftCommerceAuthorizationRepository } from "../dist/gift-commerce-authorization-repository.js";
import { publishDailyGiftInventory } from "../dist/daily-publication-inventory.js";
import { publishDailyGiftPrice } from "../dist/daily-publication-price.js";
import { validateDailyGiftCommerceEdit } from "../dist/daily-publication-commerce.js";
import { writeCommerceInventory } from "../dist/gift-commerce-inventory-data.js";
import {
  seedGiftCommerceAuthority,
  seedGiftCommerceMarket,
} from "./postgres-gift-commerce-fixtures.mjs";
const root = new URL("../../../", import.meta.url);
let stage = "migrate",
  assertions = 0;
const check = (actual, expected, label) => {
  stage = label;
  assert.deepEqual(actual, expected, label);
  assertions++;
};
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot: fileURLToPath(root),
    command: { direction: "up" },
  });
  const client = new Client(configuration);
  await client.connect();
  try {
    const actorId = randomUUID();
    await client.query(
      "INSERT INTO public.admin_identities(id,issuer,external_subject_hash,status,mfa_required,created_at,updated_at) VALUES($1,'focal-commerce-audit',$2,'ACTIVE',true,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day')",
      [actorId, createHash("sha256").update(actorId).digest()],
    );
    const credentials = await seedGiftCommerceAuthority(client, { actorId });
    const market = "FOCAL_TEST",
      currency = "USD";
    await seedGiftCommerceMarket(client, { market, currency });
    const scope = {
      trackOperation: async (work) => work(),
      markRollbackOnly: () => {},
    };
    const auth = createGiftCommerceAuthorizationRepository(client, scope);
    const catalog = createGiftCommerceCatalogRepository(
      client,
      scope,
      "https://media.example.test",
    );
    async function tx(work) {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        const result = await work();
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    async function authority(permission) {
      const result = await auth.authorize({
        schemaVersion: 1,
        sessionTokenDigest: credentials.sessionTokenDigest,
        csrfTokenDigest: credentials.csrfTokenDigest,
        permission,
        locales: [],
      });
      check(
        result.outcome,
        "SUCCESS",
        `${permission} fresh real authorization`,
      );
      return result.principal;
    }
    const writeGift = (command) =>
      tx(async () =>
        catalog.write({
          schemaVersion: 1,
          principal: await authority("gift.manage"),
          requestId: randomUUID(),
          command: {
            schemaVersion: 1,
            reasonCode: "FOCAL_COMMERCE_AUDIT",
            idempotencyKey: randomUUID(),
            ...command,
          },
        }),
      );
    const suffix = randomUUID().replaceAll("-", "");
    const gift = await writeGift({
      action: "CREATE_GIFT",
      handle: `focal-commerce-${suffix}`,
      expectedBaseVersion: 0,
    });
    check(gift.outcome, "SUCCESS", "normal audited gift create");
    const variant = await writeGift({
      action: "SAVE_VARIANT",
      giftId: gift.giftId,
      giftVariantId: null,
      expectedBaseVersion: 1,
      expectedVariantVersion: 0,
      sku: `FOCAL-${suffix.toUpperCase()}`,
      status: "draft",
      inventoryPolicy: "TRACKED",
      eligibleIdolIds: [],
    });
    if (variant.outcome !== "SUCCESS")
      throw new Error(`variant fixture rejected: ${variant.code}`);
    check(variant.outcome, "SUCCESS", "normal audited tracked variant create");
    const variantId = variant.giftVariantId;
    const location = await tx(async () =>
      writeCommerceInventory(client, {
        schemaVersion: 1,
        principal: await authority("inventory.manage"),
        requestId: randomUUID(),
        command: {
          schemaVersion: 1,
          action: "CREATE_INVENTORY_LOCATION",
          code: `FOCAL_${suffix.toUpperCase()}`,
          reasonCode: "FOCAL_COMMERCE_AUDIT",
          idempotencyKey: randomUUID(),
        },
      }),
    );
    check(location.outcome, "SUCCESS", "normal audited location create");
    const locationId = location.inventoryLocationId;
    const stock = (quantity) => ({ policy: "TRACKED", locationId, quantity });
    const price = (amountMinor) => ({ market, currency, amountMinor });
    async function claim(amountMinor, quantity, commerceEdit) {
      const principal = await authority("pricing.manage");
      await authority("inventory.manage");
      return {
        schemaVersion: 1,
        actorId,
        sessionId: credentials.sessionId,
        requestId: randomUUID(),
        authorizedUntil: principal.expiresAt,
        operation: { operationId: randomUUID() },
        intent: {
          kind: "SAVE_GIFT",
          id: gift.giftId,
          expectedVersion: 2,
          sourceLocale: "en",
          name: "Focal audit",
          description: "Synthetic normal commerce fixture",
          image: null,
          giftKind: "PHYSICAL",
          category: "OTHER",
          price: price(amountMinor),
          inventory: stock(quantity),
          eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
          ...(commerceEdit ? { commerceEdit } : {}),
        },
        eventTime: principal.authorizedAt,
      };
    }
    async function writeDaily(
      amount,
      quantity,
      edit,
      parts = ["inventory", "price"],
    ) {
      return tx(async () => {
        const c = await claim(amount, quantity, edit);
        if (parts.includes("inventory"))
          await publishDailyGiftInventory(client, c, variantId, c.eventTime);
        if (parts.includes("price"))
          return publishDailyGiftPrice(client, c, variantId, c.eventTime);
      });
    }
    async function snapshot() {
      const {
        rows: [row],
      } = await client.query(
        `SELECT (SELECT b.on_hand::int FROM public.inventory_items i JOIN public.inventory_balances b ON b.inventory_item_id=i.id WHERE i.gift_variant_id=$1 AND b.location_id=$2) quantity,(SELECT count(*)::int FROM public.inventory_ledger l JOIN public.inventory_items i ON i.id=l.inventory_item_id WHERE i.gift_variant_id=$1) ledger_count,(SELECT p.amount_minor::int FROM public.price_book_publication_heads h JOIN public.prices p ON p.price_book_id=h.price_book_id AND p.price_book_revision=h.price_book_revision WHERE h.market=$3 AND h.currency=$4 AND p.gift_variant_id=$1) amount,(SELECT count(*)::int FROM public.price_books WHERE market=$3 AND currency=$4) book_count,(SELECT version::int FROM public.price_book_publication_heads WHERE market=$3 AND currency=$4) head_version`,
        [variantId, locationId, market, currency],
      );
      return row;
    }
    stage = "initial canonical stock and price";
    await writeDaily(1000, 10);
    const initial = await snapshot();
    check(
      [initial.quantity, initial.amount],
      [10, 1000],
      "baseline viewed before independent update",
    );
    stage = "independent audited adjustment and price update";
    await writeDaily(1500, 9);
    const concurrent = await snapshot();
    check(
      [concurrent.quantity, concurrent.amount],
      [9, 1500],
      "independent committed current commerce",
    );
    const preserve = {
      price: { mode: "PRESERVE" },
      inventory: { mode: "PRESERVE" },
    };
    stage = "PRESERVE after stock and price changed";
    await writeDaily(1000, 10, preserve);
    check(
      await snapshot(),
      concurrent,
      "PRESERVE never restores stale quantity/price or produces redundant ledger/book",
    );
    async function validate(amount, quantity, edit) {
      return tx(async () =>
        validateDailyGiftCommerceEdit(
          client,
          await claim(amount, quantity, edit),
          variantId,
        ),
      );
    }
    check(
      await validate(1000, 10, preserve),
      true,
      "PRESERVE accepts stale visible commerce without writing it",
    );
    check(
      await validate(1000, 11, {
        ...preserve,
        inventory: { mode: "SET", baseline: stock(10) },
      }),
      false,
      "SET stock rejects baseline predating independent deduction",
    );
    check(
      await validate(2000, 10, {
        ...preserve,
        price: { mode: "SET", baseline: price(1000) },
      }),
      false,
      "SET price rejects baseline predating independent update",
    );
    check(
      await snapshot(),
      concurrent,
      "stale validation writes no ledger/book",
    );
    const freshStock = {
      ...preserve,
      inventory: { mode: "SET", baseline: stock(9) },
    };
    check(
      await validate(1000, 11, freshStock),
      true,
      "fresh stock baseline accepts explicit quantity edit",
    );
    await tx(async () => {
      const c = await claim(1000, 11, freshStock);
      check(
        await validateDailyGiftCommerceEdit(client, c, variantId),
        true,
        "fresh stock rechecked within writer transaction",
      );
      await publishDailyGiftInventory(client, c, variantId, c.eventTime);
      await publishDailyGiftPrice(client, c, variantId, c.eventTime);
    });
    const changedStock = await snapshot();
    check(
      [
        changedStock.quantity,
        changedStock.amount,
        changedStock.ledger_count,
        changedStock.book_count,
      ],
      [11, 1500, concurrent.ledger_count + 1, concurrent.book_count],
      "SET stock writes intended delta and preserves price",
    );
    const freshPrice = {
      ...preserve,
      price: { mode: "SET", baseline: price(1500) },
    };
    check(
      await validate(2000, 10, freshPrice),
      true,
      "fresh price baseline accepts explicit amount edit with stale inventory",
    );
    await tx(async () => {
      const c = await claim(2000, 10, freshPrice);
      check(
        await validateDailyGiftCommerceEdit(client, c, variantId),
        true,
        "fresh price rechecked within writer transaction",
      );
      await publishDailyGiftInventory(client, c, variantId, c.eventTime);
      await publishDailyGiftPrice(client, c, variantId, c.eventTime);
    });
    const changedPrice = await snapshot();
    check(
      [
        changedPrice.quantity,
        changedPrice.amount,
        changedPrice.ledger_count,
        changedPrice.book_count,
      ],
      [11, 2000, changedStock.ledger_count, changedStock.book_count + 1],
      "SET price writes intended revision and preserves stock",
    );
    check(
      await validate(2100, 12, {
        price: { mode: "SET", baseline: price(2000) },
        inventory: { mode: "SET", baseline: stock(11) },
      }),
      true,
      "fresh independent baselines accept combined explicit edit",
    );
    check(
      await tx(async () => {
        const c = await claim(2100, 11, {
          ...preserve,
          price: { mode: "SET", baseline: price(2000) },
        });
        c.intent.price = { ...c.intent.price, market: "OTHER_SCOPE" };
        return validateDailyGiftCommerceEdit(client, c, variantId);
      }),
      false,
      "SET cannot validate one market then overwrite another",
    );
    check(
      await tx(async () => {
        const c = await claim(2000, 12, {
          ...preserve,
          inventory: { mode: "SET", baseline: stock(11) },
        });
        c.intent.inventory = {
          ...c.intent.inventory,
          locationId: randomUUID(),
        };
        return validateDailyGiftCommerceEdit(client, c, variantId);
      }),
      false,
      "SET cannot validate one location then overwrite another",
    );
    console.log(
      JSON.stringify({
        status: "PASS",
        suite: "independent-management-commerce-edit",
        assertions,
        evidence:
          "isolated fully migrated PostgreSQL; synthetic authority/config; all gift/stock/price mutations use normal triggers and audited writers; validates writer/guard boundary only, not daily publication or checkout",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "FAIL",
        suite: "independent-management-commerce-edit",
        stage,
        code: error.code ?? error.name,
        message: error.message,
      }),
    );
    throw error;
  } finally {
    await client.end();
  }
});
