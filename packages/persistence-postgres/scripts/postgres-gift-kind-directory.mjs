#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { createGiftDiscoveryPlan } from "@fan-support/catalog";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
// Revision profiles by fixture gift index (v2 classification); every other gift is an unclassified v1 revision.
const PROFILE_KINDS = new Map([
  [0, "VIRTUAL"],
  [1, "VIRTUAL"],
  [2, "VIRTUAL"],
  [3, "VIRTUAL"],
  [4, "VIRTUAL"],
  [5, "PHYSICAL"],
  [6, "PHYSICAL"],
  [7, "PHYSICAL"],
  [8, "MERCHANDISE"],
]);
// A daily publication document outranks the revision profile, as in order-line-gift-kind.ts.
const DOCUMENT_KIND = { index: 6, kind: "WISH" };
let stage = "MIGRATIONS",
  checks = 0;
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
const sorted = (values) => [...values].sort();

try {
  await withEphemeralPostgres(async (clientConfig) => {
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0017" },
    });
    const client = new Client(clientConfig);
    await client.connect();
    let persistence;
    try {
      stage = "SEED";
      const fixture = await seedCatalogDirectoryFixtures(client, 25);
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up" },
      });
      stage = "CLASSIFY";
      // Replica mode writes classification rows directly onto the already-published fixture revisions;
      // CHECK and UNIQUE constraints still apply. Real authoring paths are covered by their own suites.
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [index, kind] of PROFILE_KINDS) {
        const gift = fixture.gifts[index];
        await client.query(
          "INSERT INTO public.gift_revision_profiles(gift_revision_id,gift_id,gift_kind,created_by,created_at,profile_hash) VALUES($1,$2,$3,$4,clock_timestamp(),$5)",
          [gift.revisionId, gift.id, kind, fixture.editor, "b".repeat(64)],
        );
      }
      const documented = fixture.gifts[DOCUMENT_KIND.index];
      await client.query(
        "INSERT INTO public.daily_publication_revisions(revision_id,object_kind,object_id,source_locale,source_translation_id,document,document_hash,operation_id,actor_id,created_at,gift_revision_id) VALUES($1,'GIFT',$2,'en',$3,$4::jsonb,$5,$6,$7,clock_timestamp(),$1)",
        [
          documented.revisionId,
          documented.id,
          randomUUID(),
          JSON.stringify({ kind: "GIFT", giftKind: DOCUMENT_KIND.kind }),
          "c".repeat(64),
          randomUUID(),
          fixture.editor,
        ],
      );
      await client.query("COMMIT");
      const expected = new Map(
        fixture.gifts.map((gift, index) => [
          gift.id,
          index === DOCUMENT_KIND.index
            ? DOCUMENT_KIND.kind
            : (PROFILE_KINDS.get(index) ?? null),
        ]),
      );
      const idsOf = (kind) =>
        sorted(
          [...expected].filter(([, value]) => value === kind).map(([id]) => id),
        );
      persistence = createPostgresPersistence(clientConfig, {
        catalogPublicMediaBaseUrl: "https://media.example.invalid",
      });
      const read = (work) =>
        persistence.contentReadTransactionManager.runInContentReadTransaction(
          ({ catalogDirectory }) => work(catalogDirectory),
        );
      const browse = (query = {}) =>
        read((directory) =>
          directory.browseGifts({
            schemaVersion: 1,
            query: {
              schemaVersion: 1,
              locale: "en",
              page: 1,
              pageSize: 48,
              ...query,
            },
          }),
        );
      const priced = (query = {}) =>
        read((directory) =>
          directory.readGifts({
            schemaVersion: 1,
            plan: createGiftDiscoveryPlan({
              schemaVersion: 1,
              locale: "en",
              market: "CATALOG",
              currency: "USD",
              pageSize: 48,
              ...query,
            }),
          }),
        );
      const browseId = (record) =>
        record.schemaVersion === 3
          ? record.context.current.document.ownerId
          : record.source.base.id;

      stage = "BROWSE_CLASSIFICATION";
      const all = await browse();
      equal(all.outcome, "SUCCESS", "unfiltered browse succeeds");
      equal(all.totalItems, 25, "every published gift remains browsable");
      equal(
        all.items.map((record, index) => [
          browseId(record),
          all.giftKinds[index],
        ]),
        all.items.map((record) => [
          browseId(record),
          expected.get(browseId(record)),
        ]),
        "each item carries its published kind; unclassified legacy revisions are null",
      );

      stage = "BROWSE_FILTER";
      for (const kind of ["VIRTUAL", "PHYSICAL", "WISH", "MERCHANDISE"]) {
        const result = await browse({ kind });
        equal(result.totalItems, idsOf(kind).length, `${kind} total`);
        equal(
          sorted(result.items.map(browseId)),
          idsOf(kind),
          `${kind} contains exactly its classified gifts`,
        );
        equal(
          result.giftKinds.every((value) => value === kind),
          true,
          `${kind} page carries only its kind`,
        );
      }
      equal(
        sorted((await browse({ kind: "WISH" })).items.map(browseId)),
        [documented.id],
        "the daily document outranks the revision profile",
      );
      equal(
        (await browse({ kind: "OTHER" })).totalItems,
        0,
        "an unused kind is a real empty directory",
      );
      const pages = [];
      for (const page of [1, 2, 3]) {
        const result = await browse({ kind: "VIRTUAL", pageSize: 2, page });
        equal(result.totalItems, 5, "filtered total is counted once");
        equal(result.items.length, [2, 2, 1][page - 1], "filtered page size");
        pages.push(...result.items.map(browseId));
      }
      equal(
        sorted(pages),
        idsOf("VIRTUAL"),
        "kind filtering runs before pagination and visits every match once",
      );
      equal(
        sorted(
          (await browse({ kind: "VIRTUAL", category: "FLOWERS" })).items.map(
            browseId,
          ),
        ),
        sorted(
          fixture.gifts
            .filter((_, index) => index < 5 && index % 2 === 0)
            .map((gift) => gift.id),
        ),
        "kind and category filters compose",
      );

      stage = "PRICED_FILTER";
      const pricedAll = await priced();
      equal(pricedAll.outcome, "SUCCESS", "priced directory succeeds");
      equal(pricedAll.totalItems, 25, "priced directory counts every gift");
      equal(
        pricedAll.items.every(
          (item) =>
            item.giftKind === expected.get(browseId(item.record)) &&
            item.offer.market === "CATALOG",
        ),
        true,
        "priced items carry their published kind beside the offer",
      );
      for (const kind of ["VIRTUAL", "PHYSICAL", "WISH", "MERCHANDISE"]) {
        const result = await priced({ kind });
        equal(result.totalItems, idsOf(kind).length, `priced ${kind} total`);
        equal(
          sorted(result.items.map((item) => browseId(item.record))),
          idsOf(kind),
          `priced ${kind} contains exactly its classified gifts`,
        );
      }
      const ascending = await priced({ kind: "VIRTUAL", sort: "PRICE_ASC" });
      const prices = ascending.items.map((item) => item.offer.priceMinor);
      equal(
        prices,
        [
          ...prices.filter((price) => price !== null).sort((a, b) => a - b),
          ...prices.filter((price) => price === null),
        ],
        "price sorting applies within the kind, unpriced gifts last",
      );
      const pricedPages = [];
      for (const page of [1, 2]) {
        const result = await priced({ kind: "VIRTUAL", pageSize: 3, page });
        equal(result.totalItems, 5, "priced filtered total");
        pricedPages.push(...result.items.map((item) => browseId(item.record)));
      }
      equal(
        sorted(pricedPages),
        idsOf("VIRTUAL"),
        "priced kind filtering runs before pagination",
      );
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          diagnostic: "CALLBACK",
          stage,
          assertion:
            error instanceof assert.AssertionError ? error.message : null,
          errorType: error?.constructor?.name,
          code: /^[0-9A-Z]{5}$/u.test(error?.code ?? "") ? error.code : null,
          line:
            error?.stack?.match(
              /postgres-gift-kind-directory\.mjs:(\d+):/u,
            )?.[1] ?? null,
        }) + "\n",
      );
      throw error;
    } finally {
      await persistence?.close();
      await client.end();
    }
  });
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      result: "PASS",
      checks,
      scope:
        "isolated real PostgreSQL; gift kind classification and filtering on both public directories",
    }) + "\n",
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      schemaVersion: 1,
      result: "FAIL",
      stage,
      errorType: error?.constructor?.name,
      assertion:
        error instanceof assert.AssertionError
          ? error.message
          : "gift kind directory verification failed",
    }) + "\n",
  );
  process.exitCode = 1;
}
