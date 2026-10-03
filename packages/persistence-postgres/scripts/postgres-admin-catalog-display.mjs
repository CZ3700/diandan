#!/usr/bin/env node
// Isolate the actual catalog read SQL with synthetic rows. Authorization and full
// schema/publication guards remain covered by postgres-admin-catalog.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withEphemeralPostgres } from "../dist/testing/ephemeral-postgres.js";
import { readAdminCatalog } from "../dist/admin-catalog-read.js";

let assertions = 0;
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
};
await withEphemeralPostgres(async (configuration) => {
  const client = new Client(configuration);
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE idols(id uuid PRIMARY KEY, handle text, status text, version int, draft_revision_id uuid, published_revision_id uuid, accepting_gifts boolean, created_at timestamptz);
      CREATE TABLE idol_revisions(id uuid PRIMARY KEY, idol_id uuid, revision int, lifecycle text);
      CREATE TABLE idol_publication_heads(idol_id uuid, idol_revision_id uuid, publication_id uuid, version int);
      CREATE TABLE idol_revision_translations(idol_revision_id uuid,locale text,display_name text);
      CREATE TABLE daily_publication_revisions(revision_id uuid,object_kind text,object_id uuid,document jsonb);
      CREATE TABLE content_publications(id uuid,content_type text,idol_id uuid,idol_revision_id uuid,action text);
      CREATE TABLE idol_revision_media(idol_revision_id uuid,media_asset_id uuid,role text,sort_order int);
      CREATE TABLE media_assets(id uuid,identity_kind text,processing_status text,rights_status text);
      CREATE TABLE media_variants(id uuid,media_asset_id uuid,status text,object_key text,width int);
      CREATE TABLE media_processing_jobs(id uuid,source_asset_id uuid,output_asset_id uuid,status text);
      CREATE TABLE media_processing_outputs(job_id uuid,kind text,media_asset_id uuid);
    `);
    const ids = Array.from({ length: 3 }, () => ({
      idol: randomUUID(),
      revision: randomUUID(),
      publication: randomUUID(),
    }));
    for (const [index, id] of ids.entries()) {
      await client.query(
        "INSERT INTO idols VALUES($1,$2,'active',1,NULL,$3,true,clock_timestamp())",
        [id.idol, `idol-generated-${index}`, id.revision],
      );
      await client.query(
        "INSERT INTO idol_revisions VALUES($1,$2,1,'PUBLISHED')",
        [id.revision, id.idol],
      );
      await client.query(
        "INSERT INTO idol_publication_heads VALUES($1,$2,$3,1)",
        [id.idol, id.revision, id.publication],
      );
      await client.query(
        "INSERT INTO content_publications VALUES($1,'IDOL',$2,$3,'PUBLISH')",
        [id.publication, id.idol, id.revision],
      );
    }
    const original = "ศิลปินต้นฉบับ";
    await client.query(
      "INSERT INTO daily_publication_revisions VALUES($1,'IDOL',$2,$3)",
      [
        ids[0].revision,
        ids[0].idol,
        { source: { fields: { displayName: original } } },
      ],
    );
    await client.query(
      "INSERT INTO idol_revision_translations VALUES($1,'th',$2),($1,'en','English translation'),($3,'en','English only'),($4,'ja','日本語の名前'),($4,'en','Fallback name')",
      [ids[0].revision, original, ids[1].revision, ids[2].revision],
    );
    const source = randomUUID(),
      master = randomUUID(),
      job = randomUUID();
    await client.query(
      "INSERT INTO media_assets VALUES($1,'SOURCE','READY','APPROVED'),($2,'PROCESSED_MASTER','READY','APPROVED')",
      [source, master],
    );
    await client.query(
      "INSERT INTO media_processing_jobs VALUES($1,$2,$3,'SUCCEEDED')",
      [job, source, master],
    );
    await client.query(
      "INSERT INTO media_processing_outputs VALUES($1,'MASTER',$2)",
      [job, master],
    );
    await client.query(
      "INSERT INTO idol_revision_media VALUES($1,$2,'PORTRAIT',0)",
      [ids[0].revision, master],
    );
    await client.query(
      "INSERT INTO media_variants VALUES($1,$2,'READY','public/portrait.webp',960)",
      [randomUUID(), master],
    );
    let queries = 0;
    const adapter = {
      query: (...args) => {
        queries++;
        return client.query(...args);
      },
      release: () => {},
    };
    const read = async (changes = {}) => {
      queries = 0;
      const result = await readAdminCatalog(
        adapter,
        {
          schemaVersion: 1,
          action: "LIST_OWNERS",
          kind: "IDOL",
          locale: "zh-CN",
          status: "active",
          page: 1,
          pageSize: 10,
          ...changes,
        },
        "https://media.example.test/assets",
      );
      equal(
        queries,
        2,
        "bounded read uses one SET and one set-based catalog query",
      );
      equal(result.outcome, "SUCCESS", "catalog read succeeds");
      return result;
    };
    await client.query("BEGIN");
    for (const locale of SUPPORTED_LOCALES) {
      const page = await read({ locale });
      const item = page.items.find(
        (entry) => entry.target.idolId === ids[0].idol,
      );
      const expectedName = locale === "en" ? "English translation" : original;
      equal(
        item.label,
        expectedName,
        "requested translation precedes daily original source",
      );
      equal(
        item.image,
        {
          url: "https://media.example.test/assets/public/portrait.webp",
          alt: expectedName,
        },
        "safe published portrait and resolved label remain available in every UI locale",
      );
      equal(
        JSON.stringify(item).includes("portrait_object_key"),
        false,
        "storage key field never leaves adapter",
      );
    }
    equal(
      (await read({ q: original })).totalItems,
      1,
      "original name remains searchable from another interface language",
    );
    await client.query(
      "INSERT INTO idol_revision_translations VALUES($1,'zh-CN','   ')",
      [ids[0].revision],
    );
    equal(
      (await read({ q: original })).items[0].label,
      original,
      "blank requested translation cannot hide the original name",
    );
    const owner = await readAdminCatalog(
      adapter,
      {
        schemaVersion: 1,
        action: "READ_OWNER",
        target: { kind: "IDOL", idolId: ids[0].idol },
        locale: "zh-CN",
      },
      "https://media.example.test/assets",
    );
    equal(
      owner.owner.image?.url,
      "https://media.example.test/assets/public/portrait.webp",
      "read-owner shares the same safe public thumbnail",
    );
    equal(
      (await read({ q: "English only" })).items[0].label,
      "English only",
      "strict revisions fall back to the default language",
    );
    equal(
      (await read({ locale: "ja", q: "日本語" })).items[0].label,
      "日本語の名前",
      "requested translation stays preferred",
    );
    const page = await read({ page: 2, pageSize: 1 });
    equal(
      [page.totalItems, page.items.length, page.page],
      [3, 1, 2],
      "pagination and totals survive hydration",
    );
    equal(
      (await read({ page: 1000 })).items,
      [],
      "out-of-range page remains empty",
    );
    for (const change of [
      [
        "UPDATE media_variants SET status='FAILED'",
        "UPDATE media_variants SET status='READY'",
      ],
      [
        "UPDATE media_assets SET rights_status='REJECTED' WHERE id=$1",
        "UPDATE media_assets SET rights_status='APPROVED' WHERE id=$1",
        master,
      ],
      [
        "UPDATE media_assets SET rights_status='EXPIRED' WHERE id=$1",
        "UPDATE media_assets SET rights_status='APPROVED' WHERE id=$1",
        source,
      ],
      [
        "UPDATE idol_revisions SET lifecycle='DRAFT' WHERE id=$1",
        "UPDATE idol_revisions SET lifecycle='PUBLISHED' WHERE id=$1",
        ids[0].revision,
      ],
      [
        "UPDATE media_variants SET object_key='../private/source.webp'",
        "UPDATE media_variants SET object_key='public/portrait.webp'",
      ],
    ]) {
      await client.query(change[0], change[2] ? [change[2]] : []);
      equal(
        (await read({ q: original })).items[0].image,
        null,
        "unavailable or unsafe media produces a selectable text item without exposing an image",
      );
      await client.query(change[1], change[2] ? [change[2]] : []);
    }
    await client.query("ROLLBACK");
    console.log(
      JSON.stringify({
        result: "PASS",
        assertions,
        database: "isolated real PostgreSQL",
        scope: "catalog read projection; full authority suite is separate",
      }),
    );
  } finally {
    await client.end();
  }
});
