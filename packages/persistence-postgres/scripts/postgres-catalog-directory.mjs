#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  createGiftDiscoveryPlan,
  createIdolDiscoveryPlan,
  createIdolDirectoryCursor,
  decodeIdolDirectoryCursor,
} from "@fan-support/catalog";
import { selectPublishedGift, selectPublishedIdol } from "@fan-support/content";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedAdminCatalogOperator } from "./postgres-admin-catalog-fixtures.mjs";
import { seedGiftCommerceAuthority } from "./postgres-gift-commerce-fixtures.mjs";
import { rebuildIdolSearchProjections } from "../dist/catalog-search-projection.js";
import {
  seedCatalogDirectoryFixtures,
  seedTemporalCatalogPrices,
  seedUnpublishedArtistSearchFixture,
} from "./postgres-catalog-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const publicMediaBaseUrl = "https://media.example.invalid";
let diagnosticStep = "migrations";

function success(value, label) {
  assert.equal(
    value.outcome,
    "SUCCESS",
    `${label}: ${value.code ?? "unexpected outcome"}`,
  );
  return value;
}

async function verify(clientConfig) {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const observer = new Client(clientConfig);
  await observer.connect();
  let persistence;
  try {
    diagnosticStep = "normal-trigger seed";
    const fixture = await seedCatalogDirectoryFixtures(observer);
    const unpublished = await seedUnpublishedArtistSearchFixture(
      observer,
      fixture.idols[0],
      fixture.editor,
    );
    await observer.query(
      "INSERT INTO public.idols(id,handle,status,accepting_gifts) VALUES ('62000000-0000-4000-8000-000000000001','unpublished-performer','draft',false)",
    );
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0019" },
    });
    // This historical book has a scheduled row inside a wider book window.
    // Seed it before commerce receipts become mandatory, then exercise current reads.
    const temporal = await seedTemporalCatalogPrices(
      observer,
      fixture.editor,
      fixture.gifts[2],
      10,
    );
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    diagnosticStep = "published price immutability";
    for (const assignment of [
      "amount_minor = amount_minor + 1",
      "valid_from = valid_from + interval '1 day'",
    ]) {
      await observer.query("BEGIN");
      let rejected = false;
      try {
        await observer.query(
          `UPDATE public.prices SET ${assignment} WHERE id=$1`,
          [fixture.prices.priceIds[0]],
        );
      } catch (error) {
        rejected = error.code === "55000";
      } finally {
        await observer.query("ROLLBACK");
      }
      assert.ok(
        rejected,
        "published price source fields remain immutable after generated-column fix",
      );
    }
    diagnosticStep = "repository configuration";
    persistence = createPostgresPersistence(clientConfig, {
      catalogPublicMediaBaseUrl: publicMediaBaseUrl,
    });
    const run = (work) => {
      diagnosticStep = "directory transaction";
      return persistence.contentReadTransactionManager.runInContentReadTransaction(
        work,
      );
    };
    const idols = (query = {}) =>
      run(({ catalogDirectory }) => {
        const plan = createIdolDiscoveryPlan({
          schemaVersion: 1,
          locale: "en",
          ...query,
        });
        const continuation =
          plan.query.after === undefined
            ? undefined
            : decodeIdolDirectoryCursor({
                schemaVersion: 1,
                query: plan.query,
                cursor: plan.query.after,
              });
        return catalogDirectory.readIdols({
          schemaVersion: 1,
          plan,
          ...(continuation === undefined ? {} : { continuation }),
        });
      });
    const gifts = (query = {}) =>
      run(({ catalogDirectory }) =>
        catalogDirectory.readGifts({
          schemaVersion: 1,
          plan: createGiftDiscoveryPlan({
            schemaVersion: 1,
            locale: "en",
            market: "CATALOG",
            currency: "USD",
            ...query,
          }),
        }),
      );
    let assertions = 0;
    const check = (condition, message) => {
      assert.ok(condition, message);
      assertions++;
    };

    const beforePrice = success(
      await gifts({ market: "CATALOG_TIME", availability: "PURCHASABLE" }),
      "scheduled price before activation",
    );
    check(
      beforePrice.totalItems === 0,
      "future price is not purchasable early",
    );
    const activationWaitStarted = performance.now();
    while (true) {
      const now = await observer.query(
        "SELECT clock_timestamp() >= $1::timestamptz AS active",
        [temporal.effectiveAt],
      );
      if (now.rows[0].active) break;
      assert.ok(
        performance.now() - activationWaitStarted < 15000,
        "the historical price reaches its fixed activation time within a bounded wait",
      );
      await delay(10);
    }
    const afterPrice = success(
      await gifts({ market: "CATALOG_TIME", availability: "PURCHASABLE" }),
      "scheduled price after activation",
    );
    check(
      afterPrice.totalItems === 1 &&
        afterPrice.catalogVersion !== beforePrice.catalogVersion,
      "effective price boundary changes the catalog version without a database write",
    );

    const collected = [],
      first = success(await idols(), "first artist window");
    let current = first;
    for (;;) {
      for (const item of current.items) {
        check(
          selectPublishedIdol(item.selection, item.source).success,
          "artist has strong publish evidence",
        );
        collected.push(item.source.base.id);
      }
      if (!current.hasNextPage) break;
      const cursor = createIdolDirectoryCursor({
        schemaVersion: 1,
        query: { schemaVersion: 1, locale: "en" },
        catalogVersion: current.catalogVersion,
        afterId: collected.at(-1),
      });
      current = success(await idols({ after: cursor }), "next artist window");
    }
    assert.deepEqual(
      collected,
      fixture.idols.map((idol) => idol.id),
    );
    assertions++;
    check(
      new Set(collected).size === 120,
      "120 artists returned once across windows",
    );
    const collectedGifts = [];
    for (let page = 1; page <= 10; page++) {
      const window = success(await gifts({ page }), "recommended gift page");
      for (const item of window.items) {
        check(
          selectPublishedGift(item.record.selection, item.record.source)
            .success,
          "gift has strong publish evidence",
        );
        collectedGifts.push(item.record.source.base.id);
      }
    }
    assert.deepEqual(
      collectedGifts,
      fixture.gifts.map((gift) => gift.id),
    );
    assertions++;
    const anchor = success(
      await idols({ anchorId: fixture.idols[99].id }),
      "anchor window",
    );
    check(
      anchor.items[0].source.base.id === fixture.idols[99].id,
      "directly locate the 100th artist",
    );
    for (const [query, expected] of [
      ["i̇ris ýến", 99],
      ["aria", 100],
      ["น้ำดาว", 101],
      ["100%_", 102],
      ["performer-120", 119],
    ]) {
      const found = success(await idols({ q: query }), "Unicode artist search");
      check(
        found.items[0]?.source.base.id === fixture.idols[expected].id,
        "search normalization and literal matching",
      );
    }
    const crossLanguageArtist = fixture.idols[110];
    for (const nameLocale of SUPPORTED_LOCALES) {
      const requestedLocale = nameLocale === "en" ? "ja" : "en";
      const page = success(
        await idols({
          locale: requestedLocale,
          q: crossLanguageArtist.names[nameLocale],
        }),
        "cross-language name search",
      );
      check(
        page.items.length === 1 &&
          page.items[0].source.base.id === crossLanguageArtist.id,
        "all seven published names are searchable from another locale",
      );
      const projected = selectPublishedIdol(
        page.items[0].selection,
        page.items[0].source,
      );
      check(
        projected.success &&
          projected.value.localeContext.resolvedLocale === requestedLocale &&
          projected.value.displayName ===
            crossLanguageArtist.names[requestedLocale],
        "cross-language matching preserves requested output language",
      );
    }
    const rankedIds = [];
    let rankedAfter;
    for (let page = 0; page < 3; page++) {
      const query = { schemaVersion: 1, locale: "en", q: "luna", limit: 1 };
      const result = success(
        await idols({
          ...query,
          ...(rankedAfter === undefined ? {} : { after: rankedAfter }),
        }),
        "cross-language ranked continuation",
      );
      check(
        result.items.length === 1 && result.hasNextPage === page < 2,
        "one artist per rank page without duplicate locale matches",
      );
      const artistId = result.items[0].source.base.id;
      rankedIds.push(artistId);
      rankedAfter = createIdolDirectoryCursor({
        schemaVersion: 1,
        query,
        catalogVersion: result.catalogVersion,
        afterId: artistId,
      });
    }
    check(
      JSON.stringify(rankedIds) ===
        JSON.stringify([107, 105, 106].map((index) => fixture.idols[index].id)),
      "best exact then prefix then substring rank overrides display order without duplicate artists",
    );
    check(
      success(
        await idols({ locale: "en", q: unpublished.query }),
        "unpublished foreign name",
      ).items.length === 0 &&
        success(
          await idols({ locale: "ja", q: unpublished.query }),
          "unpublished local name",
        ).items.length === 0,
      "a newer draft revision with a search projection cannot leak into matching",
    );
    check(
      success(await idols({ q: "' OR 1=1 --" }), "parameterized search").items
        .length === 0,
      "SQL-shaped input does not expand search",
    );

    for (const locale of SUPPORTED_LOCALES) {
      const artistPage = success(
        await idols({ locale, limit: 1 }),
        "localized artist",
      );
      const giftPage = success(
        await gifts({ locale, pageSize: 1 }),
        "localized gift",
      );
      check(
        artistPage.items[0].source.localeContext.resolvedLocale === locale &&
          selectPublishedIdol(
            artistPage.items[0].selection,
            artistPage.items[0].source,
          ).success,
        "artist locale publish bindings",
      );
      check(
        giftPage.items[0].record.source.localeContext.resolvedLocale ===
          locale &&
          selectPublishedGift(
            giftPage.items[0].record.selection,
            giftPage.items[0].record.source,
          ).success,
        "gift locale publish bindings",
      );
    }
    const ascending = success(
      await gifts({ sort: "PRICE_ASC", pageSize: 48 }),
      "price ascending",
    );
    check(
      ascending.totalItems === 120 && ascending.items.length === 48,
      "real count and bounded gift page",
    );
    check(
      ascending.items[0].record.source.base.id === fixture.gifts[1].id &&
        ascending.items[0].offer.priceMinor === 1000,
      "minimum purchasable variant excludes sold-out cheap gift",
    );
    const recipient = success(
      await gifts({ sort: "PRICE_ASC", idolId: fixture.idols[1].id }),
      "recipient prices",
    );
    check(
      recipient.items[0].offer.priceMinor === 11000,
      "minimum price uses the selected recipient's eligible variants",
    );
    const descending = success(
      await gifts({ sort: "PRICE_DESC", pageSize: 48 }),
      "price descending",
    );
    check(
      descending.items[0].record.source.base.id === fixture.gifts[118].id &&
        descending.items[0].offer.priceMinor === 6900,
      "equal descending prices use stable ID tiebreaker",
    );
    const finalPage = success(
      await gifts({ sort: "PRICE_DESC", page: 3, pageSize: 48 }),
      "last gift page",
    );
    check(
      finalPage.items.at(-1).record.source.base.id === fixture.gifts[0].id &&
        finalPage.items.at(-1).offer.priceMinor === null,
      "unavailable no-price gift remains last even descending",
    );
    const category = success(
      await gifts({
        category: "FLOWERS",
        availability: "PURCHASABLE",
        priceMinMinor: 1100,
        priceMaxMinor: 1200,
      }),
      "combined filters",
    );
    check(
      category.totalItems === 2 &&
        category.items.every(
          (item) =>
            item.offer.priceMinor >= 1100 && item.offer.priceMinor <= 1200,
        ),
      "category, availability and price bounds use one offer scope",
    );
    check(
      success(await gifts({ page: 1000 }), "page out of range").items.length ===
        0,
      "out of range page is not clamped",
    );
    check(
      success(
        await gifts({
          market: "CATALOG_OTHER",
          currency: "JPY",
          sort: "PRICE_ASC",
        }),
        "other currency",
      ).items[0].offer.priceMinor === 3000,
      "market and currency remain separate from locale",
    );
    check(
      success(
        await gifts({
          market: "CATALOG",
          currency: "JPY",
          availability: "PURCHASABLE",
        }),
        "missing price book",
      ).totalItems === 0,
      "missing market currency price never falls back to another book",
    );

    const preorder = fixture.gifts[2].variants[0];
    const beforePause = success(
      await gifts({
        idolId: fixture.idols[0].id,
        priceMinMinor: 1100,
        priceMaxMinor: 1100,
      }),
      "nontracked offers before pause",
    );
    await observer.query(
      "INSERT INTO public.inventory_items (id,gift_variant_id,sku,policy,status) VALUES ($1,$2,$3,'PREORDER','PAUSED')",
      [preorder.inventoryItemId, preorder.id, preorder.sku],
    );
    const itemPaused = success(
      await gifts({
        idolId: fixture.idols[0].id,
        priceMinMinor: 1100,
        priceMaxMinor: 1100,
      }),
      "existing preorder item paused",
    );
    check(
      itemPaused.items.every(
        (item) => item.record.source.base.id !== fixture.gifts[2].id,
      ) && itemPaused.catalogVersion !== beforePause.catalogVersion,
      "an existing paused nontracked item is not disguised as a missing item",
    );
    await observer.query(
      "UPDATE public.inventory_items SET status='ACTIVE' WHERE id=$1",
      [preorder.inventoryItemId],
    );
    check(
      success(
        await gifts({
          idolId: fixture.idols[0].id,
          priceMinMinor: 1100,
          priceMaxMinor: 1100,
        }),
        "preorder inventory resumed",
      ).items.some(
        (item) => item.record.source.base.id === fixture.gifts[2].id,
      ),
      "active nontracked item requires no fabricated stock balance",
    );

    const immutableBefore = await observer.query(
      "SELECT jsonb_agg(jsonb_build_array(id,source_hash,translated_from_source_hash,display_name) ORDER BY id) AS translations FROM public.idol_revision_translations",
    );
    const orderAccessDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0028" },
    });
    assert.deepEqual(
      [orderAccessDown.revertedVersions, orderAccessDown.currentVersion],
      [["0028"], "0027"],
      "empty order access rolls back before existing history probes",
    );
    assertions++;
    const orderPaymentDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0027" },
    });
    assert.deepEqual(
      [orderPaymentDown.revertedVersions, orderPaymentDown.currentVersion],
      [["0027"], "0026"],
      "empty order-payment application rolls back before existing history probes",
    );
    const paymentDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0026" },
    });
    assert.deepEqual(
      [paymentDown.revertedVersions, paymentDown.currentVersion],
      [["0026"], "0025"],
      "empty payment runtime rolls back before preserved checkout history probes",
    );
    const checkoutDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0025" },
    });
    assert.deepEqual(
      [checkoutDown.revertedVersions, checkoutDown.currentVersion],
      [["0025"], "0024"],
      "empty checkout migration rolls back before the existing directory sequence",
    );
    assertions++;
    const editDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0024" },
    });
    assert.deepEqual(
      [editDown.revertedVersions, editDown.currentVersion],
      [["0024"], "0023"],
      "empty edit migration rolls back before the existing directory sequence",
    );
    assertions++;
    const cartDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0023" },
    });
    assert.deepEqual(
      [cartDown.revertedVersions, cartDown.currentVersion],
      [["0023"], "0022"],
      "cart recipient migration rolls back before the existing directory downgrade sequence",
    );
    assertions++;
    const managementDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0022" },
    });
    assert.deepEqual(
      [managementDown.revertedVersions, managementDown.currentVersion],
      [["0022"], "0021"],
      "empty daily management migration rolls back before the existing directory downgrade sequence",
    );
    assertions++;
    const seoDown = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0021" },
    });
    assert.deepEqual(
      [seoDown.revertedVersions, seoDown.currentVersion],
      [["0021"], "0020"],
      "SEO purge migration rolls back before the existing directory downgrade sequence",
    );
    assertions++;
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0020" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0019" },
    });
    // This fixture has no review, authoring, alias/detail, or processing history; rewind their schemas first.
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0018" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0017" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0016" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0015" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0014" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0013" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0012" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0011" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0010" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    const migrationHead = await observer.query(
      "SELECT count(*)::integer AS count, max(version) AS version FROM public.schema_migrations",
    );
    check(
      migrationHead.rows[0].count === 28 &&
        migrationHead.rows[0].version === "0028",
      "data-bearing up/down/up restores all 28 migrations through order access",
    );
    check(
      (await idols()).code === "CATALOG_UNAVAILABLE",
      "reapplied projection migration requires backfill",
    );
    await observer.query("BEGIN");
    await rebuildIdolSearchProjections(observer);
    await observer.query("COMMIT");
    check(
      (await idols()).outcome === "SUCCESS",
      "data-bearing up/down/up recovers the real artist directory",
    );
    const immutableAfter = await observer.query(
      "SELECT jsonb_agg(jsonb_build_array(id,source_hash,translated_from_source_hash,display_name) ORDER BY id) AS translations FROM public.idol_revision_translations",
    );
    assert.deepEqual(immutableAfter.rows, immutableBefore.rows);
    assertions++;

    const commerceCredentials = await seedGiftCommerceAuthority(observer, {
      actorId: fixture.editor,
    });
    const createdGift =
      await persistence.giftCommerceTransactionManager.runInGiftCommerceTransaction(
        async ({ authorization, catalog }) => {
          const authorized = success(
            await authorization.authorize({
              schemaVersion: 1,
              sessionTokenDigest: commerceCredentials.sessionTokenDigest,
              csrfTokenDigest: commerceCredentials.csrfTokenDigest,
              permission: "gift.manage",
              locales: [],
            }),
            "draft gift current authority",
          );
          return catalog.write({
            schemaVersion: 1,
            requestId: randomUUID(),
            principal: authorized.principal,
            command: {
              schemaVersion: 1,
              action: "CREATE_GIFT",
              handle: "unpublished-gift",
              expectedBaseVersion: 0,
              reasonCode: "CATALOG_FIXTURE",
              idempotencyKey: randomUUID(),
            },
          });
        },
      );
    success(createdGift, "audited draft gift creation");
    check(
      success(
        await idols({ q: "unpublished-performer" }),
        "draft artist search",
      ).items.length === 0 &&
        success(await gifts(), "draft gift filter").totalItems === 120,
      "unpublished operational rows never enter the public directory",
    );

    const operateCatalog = await seedAdminCatalogOperator(
      observer,
      persistence,
      fixture.editor,
    );
    const initialCursor = createIdolDirectoryCursor({
      schemaVersion: 1,
      query: { schemaVersion: 1, locale: "en" },
      catalogVersion: first.catalogVersion,
      afterId: fixture.idols[11].id,
    });
    let heldVersion;
    await run(async ({ catalogDirectory }) => {
      const command = {
        schemaVersion: 1,
        plan: createIdolDiscoveryPlan({ schemaVersion: 1, locale: "en" }),
      };
      heldVersion = success(
        await catalogDirectory.readIdols(command),
        "snapshot before concurrent change",
      ).catalogVersion;
      const priorBase = (
        await observer.query("SELECT version FROM idols WHERE id=$1", [
          fixture.idols[0].id,
        ])
      ).rows[0];
      await operateCatalog({
        action: "SET_IDOL_STATUS",
        idolId: fixture.idols[0].id,
        expectedBaseVersion: Number(priorBase.version),
        status: "paused",
        acceptingGifts: false,
      });
      const held = success(
        await catalogDirectory.readIdols(command),
        "snapshot after concurrent change",
      );
      check(
        held.catalogVersion === heldVersion &&
          held.items[0].source.base.status === "active",
        "one transaction keeps metadata and hydration snapshot stable",
      );
      return { schemaVersion: 1, checked: true };
    });
    check(
      (await idols({ after: initialCursor })).code === "CATALOG_CHANGED",
      "published operational change invalidates an old cursor",
    );
    const paused = success(
      await idols({ anchorId: fixture.idols[0].id }),
      "paused artist",
    );
    check(
      paused.items[0].source.base.status === "paused" &&
        !paused.items[0].source.base.acceptingGifts,
      "paused artist stays visible without accepting gifts",
    );
    const pausedGifts = success(
      await gifts({ idolId: fixture.idols[0].id }),
      "paused recipient gifts",
    );
    check(
      pausedGifts.totalItems === 120 &&
        pausedGifts.items.every((item) => !item.offer.purchasable),
      "paused recipient retains related gifts but no purchasable offer",
    );

    await observer.query(
      "DELETE FROM public.idol_translation_search_projections WHERE idol_translation_id=(SELECT id FROM public.idol_revision_translations WHERE idol_revision_id=$1 AND locale='ja')",
      [fixture.idols[0].revisionId],
    );
    check(
      (await idols()).code === "CATALOG_UNAVAILABLE",
      "missing projection for another searchable language fails closed",
    );
    await observer.query("BEGIN");
    const rebuilt = await rebuildIdolSearchProjections(observer);
    await observer.query("COMMIT");
    check(
      rebuilt.processed === 841 && (await idols()).outcome === "SUCCESS",
      "search projection rebuild preserves all immutable seven-language rows",
    );

    return {
      artists: 120,
      gifts: 120,
      assertions,
      seeding: "normal triggers; no replica bypass",
      locales: SUPPORTED_LOCALES.length,
    };
  } finally {
    if (persistence !== undefined) await persistence.close();
    await observer.end();
  }
}

try {
  const result = await withEphemeralPostgres(async (config) => {
    try {
      return await verify(config);
    } catch (error) {
      console.error(
        `Catalog fixture assertion at ${diagnosticStep}: ${error instanceof Error ? error.message : "unknown error"}; code=${error.code ?? "none"}`,
      );
      throw error;
    }
  });
  console.log(
    `PostgreSQL catalog directory integration passed: ${JSON.stringify(result)}`,
  );
} catch (error) {
  // All data are fictional. Still keep adapter/provider messages out of this artifact.
  console.error(
    `PostgreSQL catalog directory integration failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
}
