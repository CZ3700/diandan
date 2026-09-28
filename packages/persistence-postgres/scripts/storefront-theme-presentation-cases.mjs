import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
  storefrontThemeSchema,
} from "@fan-support/contracts";
import { createGiftCommerceCatalogRepository } from "../dist/gift-commerce-gift-repository.js";
import { createGiftCommerceAuthorizationRepository } from "../dist/gift-commerce-authorization-repository.js";
import { writeCommerceInventory } from "../dist/gift-commerce-inventory-data.js";
import { publishDailyGiftInventory } from "../dist/daily-publication-inventory.js";
import { publishDailyGiftPrice } from "../dist/daily-publication-price.js";
import {
  seedGiftCommerceAuthority,
  seedGiftCommerceMarket,
} from "./postgres-gift-commerce-fixtures.mjs";

/** Nonempty protected business state is created through normal audited writers, not replica inserts. */
async function seedCommerceBaseline(client, actorId) {
  const credentials = await seedGiftCommerceAuthority(client, { actorId });
  const market = "DISPLAY_TEST",
    currency = "USD";
  await seedGiftCommerceMarket(client, { market, currency });
  const scope = {
    trackOperation: async (work) => work(),
    markRollbackOnly: () => {},
  };
  const authorization = createGiftCommerceAuthorizationRepository(
    client,
    scope,
  );
  const catalog = createGiftCommerceCatalogRepository(client, scope);
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
  async function principal(permission) {
    const result = await authorization.authorize({
      schemaVersion: 1,
      sessionTokenDigest: credentials.sessionTokenDigest,
      csrfTokenDigest: credentials.csrfTokenDigest,
      permission,
      locales: [],
    });
    assert.equal(result.outcome, "SUCCESS");
    return result.principal;
  }
  const write = (command) =>
    tx(async () => {
      const result = await catalog.write({
        schemaVersion: 1,
        principal: await principal("gift.manage"),
        requestId: randomUUID(),
        command: {
          schemaVersion: 1,
          reasonCode: "PRESENTATION_FIXTURE",
          idempotencyKey: randomUUID(),
          ...command,
        },
      });
      assert.equal(result.outcome, "SUCCESS");
      return result;
    });
  const suffix = randomUUID().replaceAll("-", "");
  const gift = await write({
    action: "CREATE_GIFT",
    handle: `presentation-${suffix}`,
    expectedBaseVersion: 0,
  });
  const variant = await write({
    action: "SAVE_VARIANT",
    giftId: gift.giftId,
    giftVariantId: null,
    expectedBaseVersion: 1,
    expectedVariantVersion: 0,
    sku: `PRESENTATION-${suffix.toUpperCase()}`,
    status: "draft",
    inventoryPolicy: "TRACKED",
    eligibleIdolIds: [],
  });
  const location = await tx(async () =>
    writeCommerceInventory(client, {
      schemaVersion: 1,
      principal: await principal("inventory.manage"),
      requestId: randomUUID(),
      command: {
        schemaVersion: 1,
        action: "CREATE_INVENTORY_LOCATION",
        code: `PRESENTATION_${suffix.toUpperCase()}`,
        reasonCode: "PRESENTATION_FIXTURE",
        idempotencyKey: randomUUID(),
      },
    }),
  );
  assert.equal(location.outcome, "SUCCESS");
  await tx(async () => {
    const authorized = await principal("pricing.manage");
    await principal("inventory.manage");
    const claim = {
      actorId,
      sessionId: credentials.sessionId,
      requestId: randomUUID(),
      authorizedUntil: authorized.expiresAt,
      operation: { operationId: randomUUID() },
      intent: {
        kind: "SAVE_GIFT",
        id: gift.giftId,
        price: { market, currency, amountMinor: 2500 },
        inventory: {
          policy: "TRACKED",
          locationId: location.inventoryLocationId,
          quantity: 7,
        },
      },
    };
    await publishDailyGiftInventory(
      client,
      claim,
      variant.giftVariantId,
      authorized.authorizedAt,
    );
    await publishDailyGiftPrice(
      client,
      claim,
      variant.giftVariantId,
      authorized.authorizedAt,
    );
  });
}

/** Extends the existing real PostgreSQL theme history; never rewrites its old receipts. */
export async function verifyStorefrontPresentation({
  client,
  migrate,
  execute,
  publicApp,
  publicLayout,
  priorLayout,
  saveCommand,
  published,
  check,
  actorId,
}) {
  const theme = createDefaultStorefrontTheme();
  const presentation = {
    heroLayout: "SPLIT",
    giftLayout: "SHOWCASE",
    motion: "SUBTLE",
    motionSpeed: "QUICK",
  };
  const configured = { ...theme, presentation };
  const historySnapshot = async () =>
    (
      await client.query(
        `SELECT 'revision' kind,id,to_jsonb(r) value FROM storefront_theme_revisions r UNION ALL SELECT 'publication',id,to_jsonb(p) FROM storefront_theme_publications p UNION ALL SELECT 'receipt',id,to_jsonb(c) FROM storefront_theme_receipts c ORDER BY kind,id`,
      )
    ).rows;
  const legacy = await historySnapshot();
  const businessSnapshot = async () => {
    const tables = [
      "gifts",
      "gift_variants",
      "prices",
      "price_books",
      "price_book_publications",
      "price_book_publication_heads",
      "inventory_items",
      "inventory_balances",
      "inventory_ledger",
      "orders",
      "order_items",
    ];
    const rows = [];
    for (const table of tables)
      rows.push({
        table,
        rows: (
          await client.query(
            `SELECT to_jsonb(t) value FROM public.${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
      });
    return rows;
  };
  await seedCommerceBaseline(client, actorId);
  const commerceBefore = await businessSnapshot();
  check(
    commerceBefore
      .filter((value) =>
        ["gifts", "gift_variants", "prices", "inventory_balances"].includes(
          value.table,
        ),
      )
      .every((value) => value.rows.length > 0),
    "protected commerce fixture has real gift, variant, price and stock rows",
  );
  await migrate({ direction: "up" });
  check(
    (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(configured),
      ])
    ).rows[0].valid === true,
    "SQL accepts the deployed presentation after upgrade",
  );
  assert.deepEqual(await historySnapshot(), legacy);
  check(true, "upgrade preserves all legacy theme histories and receipt bytes");
  await migrate({ direction: "down", confirmVersion: "0046" });
  check(
    (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(configured),
      ])
    ).rows[0].valid === false,
    "legacy-only history permits downgrade and restores the old validator",
  );
  assert.deepEqual(await historySnapshot(), legacy);
  await migrate({ direction: "up", targetVersion: "0046" });

  const cases = [theme];
  for (const heroLayout of ["IMMERSIVE", "SPLIT"])
    for (const giftLayout of ["GRID", "SHOWCASE"])
      for (const motion of ["STANDARD", "SUBTLE", "NONE"])
        for (const motionSpeed of ["STANDARD", "QUICK"])
          cases.push({
            ...theme,
            presentation: { heroLayout, giftLayout, motion, motionSpeed },
          });
  for (const bad of [
    null,
    {},
    [],
    "custom",
    { ...presentation, heroLayout: "CUSTOM" },
    { ...presentation, giftLayout: "MASONRY" },
    { ...presentation, motion: "BOUNCE" },
    { ...presentation, motionSpeed: 100 },
    { ...presentation, css: "body{}" },
    { ...presentation, price: 100 },
  ])
    cases.push({ ...theme, presentation: bad });
  for (const field of Object.keys(presentation)) {
    const partial = { ...presentation };
    delete partial[field];
    cases.push(
      { ...theme, presentation: partial },
      { ...theme, presentation: { ...presentation, [field]: null } },
    );
  }
  cases.push(
    { ...configured, css: "body{}" },
    { ...configured, schemaVersion: 2 },
    { ...configured, corners: "CUSTOM" },
    { ...configured, presentation: null, extra: "" },
  );
  for (const value of cases) {
    const valid = (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(value),
      ])
    ).rows[0].valid;
    check(
      valid === storefrontThemeSchema.safeParse(value).success,
      "PostgreSQL and Zod agree on exact presentation shape and enums",
    );
  }
  const replay = await execute(saveCommand);
  check(
    replay.replayed === true &&
      replay.state.version === 1 &&
      !("presentation" in replay.state.draft.theme),
    "pre-upgrade command still replays its exact old receipt without a default",
  );
  check(
    (
      await execute({
        ...saveCommand,
        theme: {
          ...saveCommand.theme,
          presentation: createDefaultStorefrontPresentation(),
        },
      })
    ).code === "IDEMPOTENCY_CONFLICT",
    "an explicit presentation cannot reuse the omitted-presentation command key",
  );

  const save = {
    schemaVersion: 1,
    action: "SAVE_DRAFT",
    expectedVersion: 5,
    idempotencyKey: randomUUID(),
    theme: configured,
  };
  const saved = await execute(save);
  check(
    saved.outcome === "SUCCESS" && saved.state.version === 6,
    "presentation draft uses the existing versioned command",
  );
  check(
    (await publicApp.execute()).version === 5 &&
      !("presentation" in (await publicApp.execute()).theme),
    "new presentation draft is private while old published theme stays exact",
  );
  check(
    (await execute(save)).replayed === true,
    "new presentation draft replays once",
  );
  check(
    (
      await execute({
        ...save,
        theme: {
          ...configured,
          presentation: { ...presentation, motion: "NONE" },
        },
      })
    ).code === "IDEMPOTENCY_CONFLICT",
    "new presentation intent participates in the receipt hash",
  );
  const publish = {
    schemaVersion: 1,
    action: "PUBLISH",
    expectedVersion: 6,
    draftRevisionId: saved.state.draft.revisionId,
    idempotencyKey: randomUUID(),
  };
  await client.query(
    "CREATE FUNCTION fail_presentation_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected presentation failure'; END $$; CREATE TRIGGER fail_presentation_test BEFORE INSERT ON storefront_theme_publications FOR EACH ROW EXECUTE FUNCTION fail_presentation_test()",
  );
  check(
    (await execute(publish)).outcome === "FAILURE",
    "new presentation publish failure is reported",
  );
  check(
    (await execute({ schemaVersion: 1, action: "READ" })).state.version === 6 &&
      (await publicApp.execute()).version === 5,
    "failed presentation publication preserves old head and exact draft",
  );
  await client.query(
    "DROP TRIGGER fail_presentation_test ON storefront_theme_publications; DROP FUNCTION fail_presentation_test()",
  );
  const newPublished = await execute(publish);
  check(
    newPublished.outcome === "SUCCESS" && newPublished.state.version === 7,
    "presentation publishes through the unchanged transaction",
  );
  assert.deepEqual((await publicApp.execute()).theme, configured);
  check(
    (await execute(publish)).replayed === true,
    "new publication replay adds no history",
  );
  const restore = (publicationId, expectedVersion) =>
    execute({
      schemaVersion: 1,
      action: "RESTORE",
      publicationId,
      expectedVersion,
      idempotencyKey: randomUUID(),
    });
  const oldRestored = await restore(published.state.published.publicationId, 7);
  check(
    oldRestored.outcome === "SUCCESS" &&
      oldRestored.state.version === 8 &&
      !("presentation" in oldRestored.state.published.theme),
    "restoring old history removes presentation without rewriting the new history",
  );
  assert.deepEqual(
    oldRestored.state.published.theme,
    published.state.published.theme,
  );
  const beforeRefusedDown = await historySnapshot();
  let refused = false;
  try {
    await migrate({ direction: "down", confirmVersion: "0046" });
  } catch {
    refused = true;
  }
  check(
    refused &&
      (await client.query("SELECT max(version) v FROM schema_migrations"))
        .rows[0].v === "0046",
    "downgrade refuses extended history even after an old theme becomes current",
  );
  assert.deepEqual(await historySnapshot(), beforeRefusedDown);
  const newRestored = await restore(
    newPublished.state.published.publicationId,
    8,
  );
  check(
    newRestored.outcome === "SUCCESS" &&
      newRestored.state.version === 9 &&
      newRestored.state.published.revisionId !==
        newPublished.state.published.revisionId,
    "restoring new presentation appends another revision",
  );
  assert.deepEqual(newRestored.state.published.theme, configured);
  const history = await execute({
    schemaVersion: 1,
    action: "HISTORY",
    page: 1,
    pageSize: 20,
  });
  check(
    history.entries.length === 6 &&
      history.entries.some((entry) => "presentation" in entry.theme) &&
      history.entries.some((entry) => !("presentation" in entry.theme)),
    "history serves both generations without injecting defaults",
  );
  const after = await historySnapshot();
  assert.deepEqual(
    after.filter((row) =>
      legacy.some((old) => old.kind === row.kind && old.id === row.id),
    ),
    legacy,
  );
  check(
    true,
    "all legacy revision, publication and receipt values remain immutable",
  );
  assert.deepEqual(await publicLayout.execute(), priorLayout);
  assert.deepEqual(await businessSnapshot(), commerceBefore);
  check(
    true,
    "theme presentation leaves independent layout and business tables unchanged",
  );
  return 9;
}
