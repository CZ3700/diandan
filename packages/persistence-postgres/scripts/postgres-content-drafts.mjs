#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { Client, Pool } from "pg";
import { computeGiftDetailTranslationContentHash } from "@fan-support/content";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withEphemeralPostgres } from "../dist/index.js";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import { loadMigrationManifest } from "../dist/migrations/manifest.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let assertions = 0;
let step = "migration";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
function ok(value, label) {
  assert.ok(value, label);
  assertions++;
}
async function insert(client, table, row) {
  const columns = Object.keys(row);
  await client.query(
    `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row),
  );
}
async function transaction(client, work) {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
async function rejects(
  client,
  label,
  work,
  codes = ["23514", "23503", "23505", "55000"],
) {
  step = label;
  let failure;
  try {
    await transaction(client, work);
  } catch (error) {
    failure = error;
  }
  ok(
    failure && codes.includes(failure.code),
    `${label}: expected database rejection, got ${failure?.code ?? "success"}`,
  );
}
async function cloneRevision(client, legacy, kind) {
  const id = randomUUID();
  if (kind === "IDOL") {
    await client.query(
      `INSERT INTO public.idol_revisions(id,idol_id,revision,lifecycle,theme_accent,hero_text_tone,display_order,created_by)
      SELECT $1,idol_id,(SELECT max(revision)+1 FROM public.idol_revisions WHERE idol_id=r.idol_id),'DRAFT',theme_accent,hero_text_tone,display_order,$3 FROM public.idol_revisions r WHERE id=$2`,
      [id, legacy.idols[0].revisionId, legacy.editor],
    );
  } else {
    await client.query(
      `INSERT INTO public.gift_revisions(id,gift_id,revision,lifecycle,category,delivery_minimum,delivery_maximum,delivery_unit,requires_safety_notice,created_by)
      SELECT $1,gift_id,(SELECT max(revision)+1 FROM public.gift_revisions WHERE gift_id=r.gift_id),'DRAFT',category,delivery_minimum,delivery_maximum,delivery_unit,requires_safety_notice,$3 FROM public.gift_revisions r WHERE id=$2`,
      [id, legacy.gifts[0].revisionId, legacy.editor],
    );
  }
  return id;
}
async function createAudit(client, legacy, id, kind, editedAt, options) {
  const auditId = randomUUID(),
    requestId = randomUUID();
  const row = {
    id: auditId,
    actor_type: "ADMIN",
    actor_id: legacy.editor,
    action: `${kind}_DRAFT_CREATE`,
    subject_type:
      kind === "IDOL_ALIAS" ? "IDOL_ALIAS_SET" : "GIFT_DETAIL_DOCUMENT",
    subject_id: id,
    reason_code: "FIXTURE_CREATE",
    request_id: requestId,
    correlation_id: requestId,
    outcome: "SUCCEEDED",
    created_at: editedAt,
    ...options.audit,
  };
  await insert(client, "audit_logs", row);
  return { auditId, requestId };
}
async function timestamp(client) {
  return (
    await client.query(
      "SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS now",
    )
  ).rows[0].now;
}
async function aliasDraft(client, legacy, options = {}) {
  const id = randomUUID(),
    revisionId =
      options.revisionId ?? (await cloneRevision(client, legacy, "IDOL"));
  const editedAt = await timestamp(client);
  const { auditId, requestId } = await createAudit(
    client,
    legacy,
    id,
    "IDOL_ALIAS",
    editedAt,
    options,
  );
  const aliases = options.aliases ?? [
    { id: "native-name", locale: "ja", text: "架空アーティスト" },
    { id: "stage-name", locale: null, text: "Fictional Stage" },
  ];
  await insert(client, "idol_revision_alias_sets", {
    id,
    idol_revision_id: revisionId,
    content_hash: hash(JSON.stringify(aliases)),
    command_hash: hash(id),
    alias_count: options.aliasCount ?? aliases.length,
    editor_id: legacy.editor,
    edited_at: editedAt,
    audit_log_id: auditId,
    request_id: requestId,
  });
  for (const [position, alias] of aliases.entries())
    await insert(client, "idol_revision_aliases", {
      alias_set_id: id,
      alias_id: alias.id,
      position: options.positionOffset
        ? position + options.positionOffset
        : position,
      locale: alias.locale,
      text: alias.text,
    });
  const reviewId = randomUUID();
  if (!options.noReview)
    await insert(client, "idol_revision_alias_reviews", {
      id: reviewId,
      alias_set_id: id,
      sequence: 1,
      status: "DRAFT",
      audit_log_id: auditId,
    });
  return { id, revisionId, reviewId, auditId, requestId };
}
async function detailDraft(client, legacy, options = {}) {
  const id = randomUUID(),
    revisionId =
      options.revisionId ?? (await cloneRevision(client, legacy, "GIFT"));
  const editedAt = await timestamp(client);
  const { auditId, requestId } = await createAudit(
    client,
    legacy,
    id,
    "GIFT_DETAIL",
    editedAt,
    options,
  );
  const media = legacy.media[0];
  const document = {
    schemaVersion: 1,
    id,
    giftRevisionId: revisionId,
    blocks: [
      { id: "heading", kind: "HEADING", level: 2 },
      { id: "paragraph", kind: "PARAGRAPH" },
      {
        id: "contents",
        kind: "LIST",
        style: "UNORDERED",
        itemIds: ["first", "second"],
      },
      { id: "specifications", kind: "SPECIFICATIONS", itemIds: ["size"] },
      {
        id: "image",
        kind: "MEDIA",
        mediaAssetId: media.assetId,
        mediaMetadataRevisionId: media.revisionId,
        captionEnabled: true,
      },
    ],
  };
  const locales = options.locales ?? SUPPORTED_LOCALES;
  const copy = (locale) => ({
    blocks: [
      {
        blockId: "heading",
        kind: "HEADING",
        text: `Fictional detail ${locale}`,
      },
      {
        blockId: "paragraph",
        kind: "PARAGRAPH",
        text: `Description ${locale}`,
      },
      {
        blockId: "contents",
        kind: "LIST",
        items: [
          { itemId: "first", text: `First ${locale}` },
          { itemId: "second", text: `Second ${locale}` },
        ],
      },
      {
        blockId: "specifications",
        kind: "SPECIFICATIONS",
        items: [{ itemId: "size", label: `Size ${locale}`, value: "Medium" }],
      },
      {
        blockId: "image",
        kind: "MEDIA",
        mediaMetadataRevisionId: media.revisionId,
        caption: `Image ${locale}`,
      },
    ],
  });
  const englishHash = computeGiftDetailTranslationContentHash(
    document,
    copy("en"),
  );
  await insert(client, "gift_detail_documents", {
    id,
    gift_revision_id: revisionId,
    command_hash: hash(id),
    block_count: 5,
    translation_count: locales.length,
    editor_id: legacy.editor,
    edited_at: editedAt,
    audit_log_id: auditId,
    request_id: requestId,
  });
  for (const [position, block] of document.blocks.entries()) {
    const items = block.itemIds ?? [];
    const row = {
      document_id: id,
      block_id: block.id,
      position,
      kind: block.kind,
      heading_level: block.level ?? null,
      list_style: block.style ?? null,
      item_count: items.length,
      media_asset_id: block.mediaAssetId ?? null,
      media_metadata_revision_id: block.mediaMetadataRevisionId ?? null,
      caption_enabled: block.captionEnabled ?? null,
    };
    if (block.kind === "MEDIA" && options.wrongMediaOwner)
      row.media_asset_id = legacy.media[1].assetId;
    await insert(client, "gift_detail_blocks", row);
    for (const [itemPosition, itemId] of items.entries())
      await insert(client, "gift_detail_block_items", {
        document_id: id,
        block_id: block.id,
        item_id: itemId,
        position: itemPosition,
      });
  }
  const translations = [];
  for (const locale of locales) {
    const translationId = randomUUID();
    const fields = copy(locale);
    await insert(client, "gift_detail_translations", {
      id: translationId,
      document_id: id,
      gift_revision_id: options.wrongRevision ?? revisionId,
      locale,
      source_hash: computeGiftDetailTranslationContentHash(document, fields),
      translated_from_source_hash:
        options.stale && locale !== "en" ? hash("stale") : englishHash,
      origin: options.origin ?? "HUMAN",
      import_batch_id: options.importBatchId ?? null,
      editor_id: legacy.editor,
      edited_at: editedAt,
    });
    for (const block of fields.blocks) {
      if (options.missingBlock && block.blockId === "paragraph") continue;
      const row = {
        translation_id: translationId,
        document_id: id,
        block_id: block.blockId,
        kind: block.kind,
        text: block.text ?? null,
        media_metadata_revision_id: block.mediaMetadataRevisionId ?? null,
        caption: block.caption ?? null,
      };
      if (options.html && block.blockId === "paragraph")
        row.text = "<script>invalid</script>";
      if (options.wrongKind && block.blockId === "paragraph")
        row.kind = "HEADING";
      if (options.wrongMetadata && block.kind === "MEDIA")
        row.media_metadata_revision_id = legacy.media[1].revisionId;
      if (options.noCaption && block.kind === "MEDIA") row.caption = null;
      await insert(client, "gift_detail_translation_blocks", row);
      for (const item of block.items ?? []) {
        if (options.missingItem && item.itemId === "second") continue;
        const itemRow = {
          translation_id: translationId,
          document_id: id,
          block_id: block.blockId,
          item_id: options.unknownItem ? "unknown" : item.itemId,
          text: item.text ?? null,
          label: item.label ?? null,
          value: item.value ?? null,
        };
        if (options.wrongItemKind && block.kind === "LIST")
          Object.assign(itemRow, {
            text: null,
            label: "Not a list",
            value: "Mismatch",
          });
        await insert(client, "gift_detail_translation_items", itemRow);
      }
    }
    if (!options.noReview)
      await insert(client, "gift_detail_translation_reviews", {
        id: randomUUID(),
        gift_detail_translation_id: translationId,
        sequence: 1,
        status: "DRAFT",
        audit_log_id: auditId,
      });
    translations.push(translationId);
  }
  return { id, revisionId, translations, auditId };
}
async function verifyMaximumDraft(clientConfig, client, legacy) {
  step = "maximum supported detail draft";
  const revisionId = await transaction(client, () =>
    cloneRevision(client, legacy, "GIFT"),
  );
  const blocks = Array.from({ length: 32 }, (_, i) => ({
    id: `block-${i}`,
    kind: "LIST",
    style: "UNORDERED",
    itemIds: Array.from({ length: 24 }, (_, j) => `item-${j}`),
  }));
  const command = {
    schemaVersion: 1,
    actorId: legacy.editor,
    reasonCode: "MAXIMUM_DRAFT_FIXTURE",
    requestId: randomUUID(),
    document: {
      schemaVersion: 1,
      id: randomUUID(),
      giftRevisionId: revisionId,
      blocks,
    },
    translations: SUPPORTED_LOCALES.map((locale) => ({
      id: randomUUID(),
      locale,
      origin: "HUMAN",
      blocks: blocks.map((block) => ({
        blockId: block.id,
        kind: "LIST",
        items: block.itemIds.map((itemId) => ({
          itemId,
          text: `${locale} ${itemId} ${"a".repeat(580)}`,
        })),
      })),
    })),
  };
  let commitMs = 0;
  const persistence = createPostgresPersistenceWithPoolFactory(
    { ...clientConfig, statement_timeout: 5000 },
    {},
    (config) => {
      const pool = new Pool(config);
      return {
        connect: async () => {
          const connection = await pool.connect();
          await connection.query("SET transaction_timeout='20s'");
          return {
            query: async (sql, values) => {
              const started = performance.now();
              try {
                return await connection.query(sql, values);
              } finally {
                if (sql === "COMMIT") commitMs = performance.now() - started;
              }
            },
            release: (destroy) => connection.release(destroy),
          };
        },
        end: () => pool.end(),
        on: (event, listener) => pool.on(event, listener),
        off: (event, listener) => pool.off(event, listener),
      };
    },
  );
  try {
    const started = performance.now();
    const result =
      await persistence.contentDraftTransactionManager.runInContentDraftTransaction(
        ({ contentDrafts }) => contentDrafts.createGiftDetails(command),
      );
    const elapsedMs = performance.now() - started;
    equal(
      result.outcome,
      "SUCCESS",
      "maximum supported draft saves through the production repository",
    );
    equal(
      (
        await client.query(
          "SELECT count(*)::integer n FROM public.gift_detail_translation_items WHERE document_id=$1",
          [command.document.id],
        )
      ).rows[0].n,
      5376,
      "all maximum-size translated items persist",
    );
    console.log(
      JSON.stringify({
        probe: "maximum-detail-draft",
        blocks: 32,
        itemsPerBlock: 24,
        locales: 7,
        elapsedMs: Math.round(elapsedMs),
        commitMs: Math.round(commitMs),
      }),
    );
    ok(
      elapsedMs < 5000,
      "maximum supported local fixture completes below five seconds",
    );
  } finally {
    await persistence.close();
  }
}
async function verify(clientConfig) {
  const client = new Client(clientConfig);
  await client.connect();
  const migrations = await loadMigrationManifest({ workspaceRoot });
  const migrate = (command) =>
    runMigrationCommandOnSession(
      {
        query: async (sql, values) => {
          try {
            return await client.query(sql, values);
          } catch (error) {
            console.error(
              `Migration diagnostic: code=${error.code}; position=${error.position ?? "none"}; constraint=${error.constraint ?? "none"}`,
            );
            throw error;
          }
        },
      },
      migrations,
      command,
    );
  try {
    await migrate({ direction: "up", targetVersion: "0012" });
    step = "legacy published fixture";
    const legacy = await seedCatalogDirectoryFixtures(client, 2);
    const oldTables = [
      "idols",
      "idol_revisions",
      "idol_revision_translations",
      "idol_translation_reviews",
      "gifts",
      "gift_revisions",
      "gift_revision_translations",
      "gift_translation_reviews",
      "content_publications",
      "idol_publication_heads",
      "gift_publication_heads",
      "media_assets",
      "media_variants",
      "media_metadata_revisions",
    ];
    // Publication head tables use owner keys instead of an id column.
    const oldSnapshot = async () => {
      const result = {};
      for (const table of oldTables)
        result[table] = (
          await client.query(
            `SELECT to_jsonb(t.*) AS row FROM public.${table} t ORDER BY to_jsonb(t.*)::text`,
          )
        ).rows.map(({ row }) => row);
      return result;
    };
    const before = await oldSnapshot();
    step = "0013 old-data roundtrip";
    await migrate({ direction: "up", targetVersion: "0013" });
    equal(
      (
        await client.query(
          "SELECT to_regclass('public.gift_detail_documents') AS table_name",
        )
      ).rows[0].table_name,
      "gift_detail_documents",
      "typed detail draft storage exists after migration",
    );
    await migrate({ direction: "down", confirmVersion: "0013" });
    await migrate({ direction: "up", targetVersion: "0013" });
    equal(
      await oldSnapshot(),
      before,
      "legacy immutable hashes, publication heads and media survive up/down/up",
    );
    step = "complete alias draft";
    const alias = await transaction(client, () => aliasDraft(client, legacy));
    const empty = await transaction(client, () =>
      aliasDraft(client, legacy, { aliases: [] }),
    );
    equal(
      (
        await client.query(
          "SELECT alias_count FROM public.idol_revision_alias_sets WHERE id=$1",
          [empty.id],
        )
      ).rows[0].alias_count,
      0,
      "empty alias set is explicit and valid",
    );
    step = "complete seven-locale detail draft";
    const detail = await transaction(client, () => detailDraft(client, legacy));
    equal(
      (
        await client.query(
          "SELECT count(*)::integer n FROM public.gift_detail_translations WHERE document_id=$1",
          [detail.id],
        )
      ).rows[0].n,
      7,
      "all seven locale rows committed",
    );
    equal(
      (
        await client.query(
          "SELECT count(*)::integer n FROM public.gift_detail_translation_reviews WHERE gift_detail_translation_id=ANY($1::uuid[]) AND status='DRAFT'",
          [detail.translations],
        )
      ).rows[0].n,
      7,
      "all initial reviews remain DRAFT",
    );
    const draftCounts = async () =>
      (
        await client.query(`SELECT jsonb_build_object(
      'aliases',(SELECT count(*) FROM public.idol_revision_alias_sets),
      'documents',(SELECT count(*) FROM public.gift_detail_documents),
      'translations',(SELECT count(*) FROM public.gift_detail_translations),
      'audits',(SELECT count(*) FROM public.audit_logs),
      'idol_revisions',(SELECT count(*) FROM public.idol_revisions),
      'gift_revisions',(SELECT count(*) FROM public.gift_revisions)) AS counts`)
      ).rows[0].counts;
    const beforeFailures = await draftCounts();
    for (const [label, options] of [
      ["missing alias review", { noReview: true }],
      ["alias count mismatch", { aliasCount: 3 }],
      ["noncontiguous alias positions", { positionOffset: 1 }],
      [
        "duplicate alias stable IDs",
        {
          aliases: [
            { id: "same", locale: null, text: "One" },
            { id: "same", locale: "en", text: "Two" },
          ],
        },
      ],
      ["wrong creation audit actor", { audit: { actor_id: legacy.reviewer } }],
      [
        "wrong creation audit action",
        { audit: { action: "UNRELATED_ACTION" } },
      ],
      ["wrong creation audit subject", { audit: { subject_id: randomUUID() } }],
      ["wrong creation audit request", { audit: { request_id: randomUUID() } }],
      ["missing creation reason", { audit: { reason_code: null } }],
      [
        "cannot extend published idol",
        { revisionId: legacy.idols[0].revisionId },
      ],
    ])
      await rejects(client, label, () => aliasDraft(client, legacy, options));
    for (const [label, options] of [
      ["missing detail initial review", { noReview: true }],
      ["missing English source", { locales: ["ja"] }],
      ["stale detail English lineage", { stale: true }],
      ["missing translated block", { missingBlock: true }],
      ["missing translated item", { missingItem: true }],
      ["unknown translated item", { unknownItem: true }],
      ["wrong translated block kind", { wrongKind: true }],
      ["wrong translated item kind", { wrongItemKind: true }],
      ["HTML detail content", { html: true }],
      ["wrong media ownership", { wrongMediaOwner: true }],
      ["wrong translated metadata", { wrongMetadata: true }],
      ["missing required caption", { noCaption: true }],
      ["import without batch", { origin: "IMPORT" }],
      ["human with import batch", { importBatchId: randomUUID() }],
      [
        "wrong detail revision FK",
        { wrongRevision: legacy.gifts[1].revisionId },
      ],
      [
        "cannot extend published gift",
        { revisionId: legacy.gifts[0].revisionId },
      ],
    ])
      await rejects(client, label, () => detailDraft(client, legacy, options));
    equal(
      await draftCounts(),
      beforeFailures,
      "rejected drafts leave no revision, payload, review or audit fragments",
    );
    const writableTables = [
      ["idol_revision_alias_sets", "id", alias.id],
      ["idol_revision_aliases", "alias_set_id", alias.id],
      ["idol_revision_alias_reviews", "alias_set_id", alias.id],
      ["gift_detail_documents", "id", detail.id],
      ["gift_detail_blocks", "document_id", detail.id],
      ["gift_detail_block_items", "document_id", detail.id],
      ["gift_detail_translations", "document_id", detail.id],
      ["gift_detail_translation_blocks", "document_id", detail.id],
      ["gift_detail_translation_items", "document_id", detail.id],
      [
        "gift_detail_translation_reviews",
        "gift_detail_translation_id",
        detail.translations[0],
      ],
    ];
    for (const [table, key, id] of writableTables) {
      await rejects(
        client,
        `${table} update forbidden`,
        () =>
          client.query(
            `UPDATE public.${table} SET ${key}=${key} WHERE ${key}=$1`,
            [id],
          ),
        ["55000"],
      );
      await rejects(
        client,
        `${table} delete forbidden`,
        () => client.query(`DELETE FROM public.${table} WHERE ${key}=$1`, [id]),
        ["55000"],
      );
      await rejects(
        client,
        `${table} truncate forbidden`,
        () => client.query(`TRUNCATE public.${table} CASCADE`),
        ["55000"],
      );
    }
    await rejects(client, "cannot add aliases after initial sealed count", () =>
      insert(client, "idol_revision_aliases", {
        alias_set_id: alias.id,
        alias_id: "late",
        position: 2,
        locale: null,
        text: "Late content",
      }),
    );
    await rejects(client, "cannot add blocks after initial sealed count", () =>
      insert(client, "gift_detail_blocks", {
        document_id: detail.id,
        block_id: "late",
        position: 5,
        kind: "PARAGRAPH",
        item_count: 0,
      }),
    );
    await rejects(
      client,
      "cannot append structural items after sealing",
      () =>
        insert(client, "gift_detail_block_items", {
          document_id: detail.id,
          block_id: "contents",
          item_id: "late",
          position: 2,
        }),
      ["23514"],
    );
    const englishOnly = await transaction(client, () =>
      detailDraft(client, legacy, { locales: ["en"] }),
    );
    await rejects(
      client,
      "cannot append a previously absent locale after sealing",
      async () => {
        const source = (
          await client.query(
            "SELECT * FROM public.gift_detail_translations WHERE id=$1",
            [englishOnly.translations[0]],
          )
        ).rows[0];
        await insert(client, "gift_detail_translations", {
          ...source,
          id: randomUUID(),
          locale: "ja",
        });
      },
      ["23514"],
    );
    await rejects(
      client,
      "cannot append translated blocks after sealing",
      () =>
        insert(client, "gift_detail_translation_blocks", {
          translation_id: detail.translations[0],
          document_id: detail.id,
          block_id: "late",
          kind: "PARAGRAPH",
          text: "Late",
        }),
      ["23514"],
    );
    await rejects(
      client,
      "cannot append translated items after sealing",
      () =>
        insert(client, "gift_detail_translation_items", {
          translation_id: detail.translations[0],
          document_id: detail.id,
          block_id: "contents",
          item_id: "late",
          text: "Late",
        }),
      ["23514"],
    );
    await rejects(client, "alias approval cannot skip submission", () =>
      insert(client, "idol_revision_alias_reviews", {
        id: randomUUID(),
        alias_set_id: alias.id,
        sequence: 2,
        status: "APPROVED",
        reviewer_id: legacy.reviewer,
        reviewed_at: new Date().toISOString(),
        reviewed_content_hash: hash("forged"),
        audit_log_id: alias.auditId,
      }),
    );
    await rejects(client, "detail approval cannot skip submission", () =>
      insert(client, "gift_detail_translation_reviews", {
        id: randomUUID(),
        gift_detail_translation_id: detail.translations[0],
        sequence: 2,
        status: "APPROVED",
        reviewer_id: legacy.reviewer,
        reviewed_at: new Date().toISOString(),
        reviewed_source_hash: hash("forged"),
        reviewed_content_hash: hash("forged"),
        audit_log_id: detail.auditId,
      }),
    );
    await rejects(
      client,
      "alias submission requires dedicated review audit",
      () =>
        insert(client, "idol_revision_alias_reviews", {
          id: randomUUID(),
          alias_set_id: alias.id,
          sequence: 2,
          status: "IN_REVIEW",
          submitted_at: new Date().toISOString(),
          audit_log_id: alias.auditId,
        }),
    );
    await rejects(
      client,
      "detail submission requires dedicated review audit",
      () =>
        insert(client, "gift_detail_translation_reviews", {
          id: randomUUID(),
          gift_detail_translation_id: detail.translations[0],
          sequence: 2,
          status: "IN_REVIEW",
          submitted_at: new Date().toISOString(),
          audit_log_id: detail.auditId,
        }),
    );
    for (const [kind, id] of [
      ["idol", alias.revisionId],
      ["gift", detail.revisionId],
    ]) {
      await rejects(
        client,
        `${kind} extension validation blocked`,
        () =>
          client.query(
            `UPDATE public.${kind}_revisions SET lifecycle='VALIDATED',validated_at=transaction_timestamp() WHERE id=$1`,
            [id],
          ),
        ["55000"],
      );
      await rejects(
        client,
        `${kind} extension direct publication blocked`,
        () =>
          client.query(
            `UPDATE public.${kind}_revisions SET lifecycle='PUBLISHED',validated_at=transaction_timestamp(),published_at=transaction_timestamp() WHERE id=$1`,
            [id],
          ),
        ["55000"],
      );
    }
    for (const [kind, oldId, revisionId] of [
      ["IDOL", legacy.idols[0].publicationId, alias.revisionId],
      ["GIFT", legacy.gifts[0].publicationId, detail.revisionId],
    ]) {
      for (const action of ["PUBLISH", "ROLLBACK"])
        await rejects(
          client,
          `${kind} publication row ${action} blocked`,
          async () => {
            const source = (
              await client.query(
                "SELECT * FROM public.content_publications WHERE id=$1",
                [oldId],
              )
            ).rows[0];
            await insert(client, "content_publications", {
              ...source,
              id: randomUUID(),
              action,
              [kind === "IDOL" ? "idol_revision_id" : "gift_revision_id"]:
                revisionId,
              idempotency_key: randomUUID(),
              replaces_publication_id: oldId,
            });
          },
          ["55000"],
        );
    }
    step = "concurrent revision validation fences extension creation";
    const concurrentId = await transaction(client, () =>
      cloneRevision(client, legacy, "IDOL"),
    );
    const other = new Client(clientConfig);
    await other.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE public.idol_revisions SET lifecycle='VALIDATED',validated_at=transaction_timestamp() WHERE id=$1",
        [concurrentId],
      );
      await rejects(
        other,
        "draft insert waits for revision lifecycle lock",
        async () => {
          await other.query("SET LOCAL lock_timeout='100ms'");
          await aliasDraft(other, legacy, { revisionId: concurrentId });
        },
        ["55P03"],
      );
      await client.query("COMMIT");
      await rejects(
        other,
        "committed VALIDATED revision cannot accept extension",
        () => aliasDraft(other, legacy, { revisionId: concurrentId }),
        ["55000"],
      );
      const pendingId = await transaction(client, () =>
        cloneRevision(client, legacy, "IDOL"),
      );
      await client.query("BEGIN");
      await aliasDraft(client, legacy, { revisionId: pendingId });
      const backend = (await other.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const publication = other
        .query(
          "UPDATE public.idol_revisions SET lifecycle='VALIDATED',validated_at=transaction_timestamp() WHERE id=$1",
          [pendingId],
        )
        .then(
          () => null,
          (error) => error.code,
        );
      let waiting = false;
      for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
        waiting =
          (
            await client.query(
              "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
              [backend],
            )
          ).rows[0]?.waiting === true;
        if (!waiting) await delay(10);
      }
      ok(
        waiting,
        "lifecycle transition waits on in-progress extension creation",
      );
      await client.query("COMMIT");
      equal(
        await publication,
        "55000",
        "waiting publication rechecks the committed extension before advancing",
      );
    } finally {
      await client.query("ROLLBACK");
      await other.end();
    }
    await verifyMaximumDraft(clientConfig, client, legacy);
    const after = await oldSnapshot();
    for (const table of oldTables) {
      const historical = before[table];
      equal(
        after[table].filter((row) =>
          historical.some((old) => JSON.stringify(old) === JSON.stringify(row)),
        ),
        historical,
        `original ${table} rows remain byte-for-byte equivalent`,
      );
    }
    step = "history prevents downgrade";
    let refused = false;
    try {
      await migrate({ direction: "down", confirmVersion: "0013" });
    } catch {
      refused = true;
    }
    ok(refused, "extension/review history blocks destructive downgrade");
    equal(
      (
        await client.query(
          "SELECT count(*)::integer n FROM public.gift_detail_translations WHERE document_id=$1",
          [detail.id],
        )
      ).rows[0].n,
      7,
      "failed downgrade preserves all translations",
    );
  } finally {
    await client.end();
  }
}
try {
  await withEphemeralPostgres(async (config) => {
    try {
      await verify(config);
    } catch (error) {
      console.error(
        `Content draft diagnostic: step=${step}; code=${error.code ?? error.name}; constraint=${error.constraint ?? "none"}; column=${error.column ?? "none"}; context=${error.where?.split("\n")[0] ?? "none"}`,
      );
      if (error instanceof assert.AssertionError) console.error(error.message);
      throw error;
    }
  });
  console.log(`PostgreSQL content drafts: ${assertions} assertions passed`);
} catch (error) {
  console.error(
    `PostgreSQL content drafts failed: ${error.code ?? error.name ?? "UNAVAILABLE"}`,
  );
  process.exitCode = 1;
}
