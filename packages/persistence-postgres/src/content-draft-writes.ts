import { randomUUID } from "node:crypto";
import type {
  CreateIdolAliasDraftCommand,
  CreateGiftDetailDraftCommand,
  IdolAliasDraftResponse,
  GiftDetailDraftResponse,
} from "@fan-support/contracts";
import { computeTranslationContentHash } from "@fan-support/content";
import type { TransactionClient } from "./transaction-runner.js";

type AliasSnapshot = Extract<IdolAliasDraftResponse, { outcome: "SUCCESS" }>;
type DetailSnapshot = Extract<GiftDetailDraftResponse, { outcome: "SUCCESS" }>;

async function createAudit(
  client: TransactionClient,
  command: CreateIdolAliasDraftCommand | CreateGiftDetailDraftCommand,
  kind: "IDOL_ALIAS" | "GIFT_DETAIL",
  subjectId: string,
  editedAt: string,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, subject_type, subject_id, reason_code, request_id, correlation_id, outcome, created_at)
    VALUES ($1, 'ADMIN', $2, $3, $4, $5, $6, $7, $7, 'SUCCEEDED', $8)`,
    [
      id,
      command.actorId,
      `${kind}_DRAFT_CREATE`,
      kind === "IDOL_ALIAS" ? "IDOL_ALIAS_SET" : "GIFT_DETAIL_DOCUMENT",
      subjectId,
      command.reasonCode,
      command.requestId,
      editedAt,
    ],
  );
  return id;
}

export async function persistIdolAliasDraft(
  client: TransactionClient,
  command: CreateIdolAliasDraftCommand,
  snapshot: AliasSnapshot,
): Promise<void> {
  const { aliasSet: set } = snapshot;
  const auditId = await createAudit(
    client,
    command,
    "IDOL_ALIAS",
    set.id,
    set.editedAt,
  );
  await client.query(
    `INSERT INTO idol_revision_alias_sets
    (id, idol_revision_id, content_hash, command_hash, alias_count, editor_id, edited_at, audit_log_id, request_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      set.id,
      set.idolRevisionId,
      set.contentHash,
      computeTranslationContentHash("content-draft-command-v1", command),
      set.aliases.length,
      set.editorId,
      set.editedAt,
      auditId,
      command.requestId,
    ],
  );
  for (const [position, alias] of set.aliases.entries()) {
    await client.query(
      `INSERT INTO idol_revision_aliases (alias_set_id, alias_id, position, locale, text) VALUES ($1,$2,$3,$4,$5)`,
      [set.id, alias.id, position, alias.locale, alias.text],
    );
  }
  await client.query(
    `INSERT INTO idol_revision_alias_reviews (id, alias_set_id, sequence, status, audit_log_id) VALUES ($1,$2,1,'DRAFT',$3)`,
    [randomUUID(), set.id, auditId],
  );
}

export async function persistGiftDetailDraft(
  client: TransactionClient,
  command: CreateGiftDetailDraftCommand,
  snapshot: DetailSnapshot,
  editedAt: string,
): Promise<void> {
  const { document, translations } = snapshot;
  const auditId = await createAudit(
    client,
    command,
    "GIFT_DETAIL",
    document.id,
    editedAt,
  );
  await client.query(
    `INSERT INTO gift_detail_documents
    (id, gift_revision_id, command_hash, block_count, translation_count, editor_id, edited_at, audit_log_id, request_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      document.id,
      document.giftRevisionId,
      computeTranslationContentHash("content-draft-command-v1", command),
      document.blocks.length,
      translations.length,
      command.actorId,
      editedAt,
      auditId,
      command.requestId,
    ],
  );
  for (const [position, block] of document.blocks.entries()) {
    const itemIds = "itemIds" in block ? block.itemIds : [];
    await client.query(
      `INSERT INTO gift_detail_blocks
      (document_id, block_id, position, kind, heading_level, list_style, item_count, media_asset_id, media_metadata_revision_id, caption_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        document.id,
        block.id,
        position,
        block.kind,
        block.kind === "HEADING" ? block.level : null,
        block.kind === "LIST" ? block.style : null,
        itemIds.length,
        block.kind === "MEDIA" ? block.mediaAssetId : null,
        block.kind === "MEDIA" ? block.mediaMetadataRevisionId : null,
        block.kind === "MEDIA" ? block.captionEnabled : null,
      ],
    );
    for (const [itemPosition, itemId] of itemIds.entries()) {
      await client.query(
        "INSERT INTO gift_detail_block_items (document_id, block_id, item_id, position) VALUES ($1,$2,$3,$4)",
        [document.id, block.id, itemId, itemPosition],
      );
    }
  }
  for (const translation of translations) {
    await client.query(
      `INSERT INTO gift_detail_translations
      (id, document_id, gift_revision_id, locale, source_hash, translated_from_source_hash, origin, import_batch_id, editor_id, edited_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        translation.id,
        document.id,
        document.giftRevisionId,
        translation.locale,
        translation.sourceHash,
        translation.translatedFromSourceHash,
        translation.origin,
        translation.importBatchId ?? null,
        translation.editorId,
        translation.editedAt,
      ],
    );
    for (const block of translation.blocks) {
      await client.query(
        `INSERT INTO gift_detail_translation_blocks
        (translation_id, document_id, block_id, kind, text, media_metadata_revision_id, caption)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          translation.id,
          document.id,
          block.blockId,
          block.kind,
          "text" in block ? block.text : null,
          block.kind === "MEDIA" ? block.mediaMetadataRevisionId : null,
          block.kind === "MEDIA" ? (block.caption ?? null) : null,
        ],
      );
      if (block.kind === "LIST" || block.kind === "SPECIFICATIONS") {
        for (const item of block.items) {
          await client.query(
            `INSERT INTO gift_detail_translation_items
            (translation_id, document_id, block_id, item_id, text, label, value) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              translation.id,
              document.id,
              block.blockId,
              item.itemId,
              "text" in item ? item.text : null,
              "label" in item ? item.label : null,
              "value" in item ? item.value : null,
            ],
          );
        }
      }
    }
    await client.query(
      `INSERT INTO gift_detail_translation_reviews (id, gift_detail_translation_id, sequence, status, audit_log_id) VALUES ($1,$2,1,'DRAFT',$3)`,
      [randomUUID(), translation.id, auditId],
    );
  }
}
