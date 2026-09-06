#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  computeIdolAliasContentHash,
  validateGiftDetailTranslation,
} from "@fan-support/content";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0;
let step = "migrations";
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
function ok(value, label) {
  assert.ok(value, label);
  assertions++;
}
await withEphemeralPostgres(async (clientConfig) => {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const observer = new Client(clientConfig);
  await observer.connect();
  const persistence = createPostgresPersistence(clientConfig);
  const run = (work) =>
    persistence.contentDraftTransactionManager.runInContentDraftTransaction(
      ({ contentDrafts }) => work(contentDrafts),
    );
  try {
    const fixtures = await seedCatalogDirectoryFixtures(observer, 2);
    // The legacy extension repository operates on unsealed historical draft parents.
    // New gift revisions require authoring/profile evidence and include extensions before sealing.
    const legacyGiftDrafts = [];
    for (let index = 0; index < 4; index++) {
      const id = randomUUID();
      await observer.query(
        `INSERT INTO gift_revisions(id,gift_id,revision,lifecycle,category,delivery_minimum,delivery_maximum,delivery_unit,requires_safety_notice,shipping_mode,created_by)
        VALUES($1,$2,$3,'DRAFT','OTHER',1,2,'DAY',false,'internal_to_idol',$4)`,
        [id, fixtures.gifts[0].id, index + 2, fixtures.editor],
      );
      legacyGiftDrafts.push(id);
    }
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    equal(
      (
        await observer.query(
          "SELECT max(version) AS version FROM public.schema_migrations",
        )
      ).rows[0].version,
      "0020",
      "legacy extension repository runs against the current gift commerce schema",
    );
    equal(
      (
        await observer.query(
          "SELECT count(*)::integer AS count FROM public.gift_revisions WHERE id=ANY($1::uuid[]) AND profile_version=1 AND lifecycle='DRAFT'",
          [legacyGiftDrafts],
        )
      ).rows[0].count,
      4,
      "the four extension parents are explicit migrated legacy drafts",
    );
    const old = async () =>
      (
        await observer.query(`SELECT jsonb_build_object(
      'idolTranslations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM idol_revision_translations t),
      'giftTranslations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM gift_revision_translations t),
      'publications',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM content_publications t)) AS value`)
      ).rows[0].value;
    const before = await old();
    let revisionNumber = 1;
    async function draft(kind) {
      if (kind === "GIFT") {
        const legacyId = legacyGiftDrafts.shift();
        assert.ok(legacyId, "each detail case has its own historical draft");
        return legacyId;
      }
      const previousStep = step;
      step = `legacy parent insert ${kind}`;
      const id = randomUUID();
      const revision = ++revisionNumber;
      await observer.query(
        `INSERT INTO idol_revisions(id,idol_id,revision,lifecycle,theme_accent,hero_text_tone,display_order,created_by)
        VALUES($1,$2,$3,'DRAFT','#D4AF37','light',0,$4)`,
        [id, fixtures.idols[0].id, revision, fixtures.editor],
      );
      step = previousStep;
      return id;
    }
    const metadata = fixtures.media[0];
    const aliasCommand = (idolRevisionId) => ({
      schemaVersion: 1,
      id: randomUUID(),
      idolRevisionId,
      aliases: [
        { id: "stage-name", locale: null, text: "Étoile" },
        { id: "japanese-name", locale: "ja", text: "星の名前" },
      ],
      actorId: fixtures.editor,
      reasonCode: "CONTENT_CREATED",
      requestId: randomUUID(),
    });
    const detailCommand = (giftRevisionId) => ({
      schemaVersion: 1,
      actorId: fixtures.editor,
      reasonCode: "CONTENT_CREATED",
      requestId: randomUUID(),
      document: {
        schemaVersion: 1,
        id: randomUUID(),
        giftRevisionId,
        blocks: [
          { id: "title", kind: "HEADING", level: 2 },
          { id: "intro", kind: "PARAGRAPH" },
          {
            id: "included",
            kind: "LIST",
            style: "UNORDERED",
            itemIds: ["card", "wrap"],
          },
          { id: "specs", kind: "SPECIFICATIONS", itemIds: ["material"] },
          {
            id: "photo",
            kind: "MEDIA",
            mediaAssetId: metadata.assetId,
            mediaMetadataRevisionId: metadata.revisionId,
            captionEnabled: true,
          },
          {
            id: "photo-unlabelled",
            kind: "MEDIA",
            mediaAssetId: metadata.assetId,
            mediaMetadataRevisionId: metadata.revisionId,
            captionEnabled: false,
          },
        ],
      },
      translations: SUPPORTED_LOCALES.map((locale, index) => ({
        id: randomUUID(),
        locale,
        origin: index === 1 ? "MACHINE" : "HUMAN",
        blocks: [
          { blockId: "title", kind: "HEADING", text: `${locale} Gift details` },
          {
            blockId: "intro",
            kind: "PARAGRAPH",
            text: `${locale} A thoughtful gift.`,
          },
          {
            blockId: "included",
            kind: "LIST",
            items: [
              { itemId: "wrap", text: `${locale} Wrapping` },
              { itemId: "card", text: `${locale} Card` },
            ],
          },
          {
            blockId: "specs",
            kind: "SPECIFICATIONS",
            items: [
              {
                itemId: "material",
                label: `${locale} Material`,
                value: `${locale} Paper`,
              },
            ],
          },
          {
            blockId: "photo",
            kind: "MEDIA",
            mediaMetadataRevisionId: metadata.revisionId,
            caption: `${locale} Product photo`,
          },
          {
            blockId: "photo-unlabelled",
            kind: "MEDIA",
            mediaMetadataRevisionId: metadata.revisionId,
          },
        ],
      })),
    });
    step = "aliases round trip";
    const alias = aliasCommand(await draft("IDOL"));
    const createdAlias = await run((repository) =>
      repository.createIdolAliases(alias),
    );
    equal(createdAlias.outcome, "SUCCESS", "alias draft created");
    const readAlias = await run((repository) =>
      repository.read({
        schemaVersion: 1,
        kind: "IDOL_ALIASES",
        idolRevisionId: alias.idolRevisionId,
      }),
    );
    equal(
      readAlias,
      createdAlias,
      "alias read reconstructs normalized rows and review",
    );
    equal(
      readAlias.aliasSet.review,
      { status: "DRAFT" },
      "cannot infer approval",
    );
    equal(
      readAlias.aliasSet.contentHash,
      computeIdolAliasContentHash(alias.aliases),
      "server hash",
    );
    equal(
      (await run((repository) => repository.createIdolAliases(alias))).code,
      "ALREADY_EXISTS",
      "duplicate does not mutate",
    );
    const empty = { ...aliasCommand(await draft("IDOL")), aliases: [] };
    equal(
      (await run((repository) => repository.createIdolAliases(empty))).outcome,
      "SUCCESS",
      "empty explicit alias set",
    );
    step = "gift detail round trip";
    const gift = detailCommand(await draft("GIFT"));
    const createdGift = await run((repository) =>
      repository.createGiftDetails(gift),
    );
    equal(createdGift.outcome, "SUCCESS", "seven-language draft created");
    const readGift = await run((repository) =>
      repository.read({
        schemaVersion: 1,
        kind: "GIFT_DETAILS",
        giftRevisionId: gift.document.giftRevisionId,
      }),
    );
    equal(readGift.outcome, "SUCCESS", "seven-language draft read");
    equal(
      readGift.document,
      gift.document,
      "structural ordering and typed media survive",
    );
    equal(readGift.translations.length, 7, "seven dedicated locale rows");
    const english = readGift.translations.find(
      (translation) => translation.locale === "en",
    );
    for (const translation of readGift.translations) {
      equal(
        translation.review,
        { status: "DRAFT" },
        "translation begins independently in DRAFT",
      );
      equal(
        translation.translatedFromSourceHash,
        english.sourceHash,
        "real canonical English lineage",
      );
      equal(translation.editorId, fixtures.editor, "server editor");
      ok(
        validateGiftDetailTranslation({
          schemaVersion: 1,
          document: readGift.document,
          translation,
          currentEnglishSourceHash: english.sourceHash,
        }).valid,
        "readback hash and structure valid",
      );
      equal(
        translation.sourceHash,
        createdGift.translations.find(
          (entry) => entry.locale === translation.locale,
        ).sourceHash,
        "persisted semantic hash",
      );
    }
    equal(
      (await run((repository) => repository.createGiftDetails(gift))).code,
      "ALREADY_EXISTS",
      "cannot overwrite old document",
    );
    step = "canonical checks and atomic rollback";
    const unknownActor = {
      ...aliasCommand(await draft("IDOL")),
      actorId: randomUUID(),
    };
    equal(
      (await run((repository) => repository.createIdolAliases(unknownActor)))
        .code,
      "ACTOR_UNAVAILABLE",
      "unknown actor rejected",
    );
    equal(
      (
        await run((repository) =>
          repository.createIdolAliases(aliasCommand(randomUUID())),
        )
      ).code,
      "NOT_FOUND",
      "missing parent rejected",
    );
    equal(
      (
        await run((repository) =>
          repository.createIdolAliases(
            aliasCommand(fixtures.idols[0].revisionId),
          ),
        )
      ).code,
      "REVISION_NOT_DRAFT",
      "published parent untouched",
    );
    const invalid = detailCommand(await draft("GIFT"));
    invalid.translations[0].blocks[1].blockId = "unknown";
    equal(
      (await run((repository) => repository.createGiftDetails(invalid))).code,
      "INVALID_CONTENT",
      "structure mismatch rejected",
    );
    const mismatched = detailCommand(await draft("GIFT"));
    mismatched.document.blocks[4].mediaAssetId = fixtures.media[1].assetId;
    let rejected = false;
    try {
      await run((repository) => repository.createGiftDetails(mismatched));
    } catch (error) {
      rejected = error.name === "PersistenceTransactionFailureError";
      ok(!String(error).includes("INSERT"), "driver SQL does not leak");
    }
    ok(rejected, "foreign media ownership rejects transaction");
    for (const id of [invalid.document.id, mismatched.document.id]) {
      equal(
        (
          await observer.query(
            "SELECT count(*)::integer AS n FROM gift_detail_documents WHERE id=$1",
            [id],
          )
        ).rows[0].n,
        0,
        "no partial document",
      );
      equal(
        (
          await observer.query(
            "SELECT count(*)::integer AS n FROM audit_logs WHERE subject_id=$1",
            [id],
          )
        ).rows[0].n,
        0,
        "no partial success audit",
      );
    }
    const changed = detailCommand(await draft("GIFT"));
    changed.translations[0].blocks[1].text += " Updated source.";
    const changedResult = await run((repository) =>
      repository.createGiftDetails(changed),
    );
    equal(changedResult.outcome, "SUCCESS", "new revision can change source");
    ok(
      changedResult.translations.find((entry) => entry.locale === "en")
        .sourceHash !== english.sourceHash,
      "source changes hash",
    );
    equal(
      await run((repository) =>
        repository.read({
          schemaVersion: 1,
          kind: "GIFT_DETAILS",
          giftRevisionId: gift.document.giftRevisionId,
        }),
      ),
      readGift,
      "new source leaves old draft unchanged",
    );
    step = "concurrent immutable creation";
    const concurrent = aliasCommand(await draft("IDOL"));
    const results = await Promise.allSettled([
      run((repository) => repository.createIdolAliases(concurrent)),
      run((repository) =>
        repository.createIdolAliases({
          ...concurrent,
          id: randomUUID(),
          requestId: randomUUID(),
        }),
      ),
    ]);
    equal(
      results.filter(
        (result) =>
          result.status === "fulfilled" && result.value.outcome === "SUCCESS",
      ).length,
      1,
      "only one concurrent creator commits",
    );
    equal(
      (
        await observer.query(
          "SELECT count(*)::integer AS n FROM idol_revision_alias_sets WHERE idol_revision_id=$1",
          [concurrent.idolRevisionId],
        )
      ).rows[0].n,
      1,
      "one stored alias set",
    );
    equal(
      await old(),
      before,
      "legacy v1 translations and publications unchanged",
    );
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        suite: "content-draft-repositories",
        assertions,
        locales: SUPPORTED_LOCALES,
        tables: 10,
        result: "PASS",
      }),
    );
  } catch (error) {
    const guard = new Map([
      [
        "gift classification requires exact authored revision and hash",
        "GIFT_AUTHORED_PROFILE_REQUIRED",
      ],
      [
        "content draft requires exact creation audit evidence",
        "DRAFT_CREATION_AUDIT",
      ],
      [
        "detail translation must bind the canonical draft and English source",
        "DETAIL_ENGLISH_BINDING",
      ],
    ]).get(error?.message);
    console.error(
      `content draft repository integration: step=${step}; code=${error.code ?? error.name}; guard=${guard ?? "UNCLASSIFIED"}`,
    );
    if (error instanceof assert.AssertionError) console.error(error.message);
    throw error;
  } finally {
    await persistence.close();
    await observer.end();
  }
}).catch((error) => {
  console.error(
    `content draft repository failed at ${step}: ${error.code ?? error.name}`,
  );
  process.exitCode = 1;
});
