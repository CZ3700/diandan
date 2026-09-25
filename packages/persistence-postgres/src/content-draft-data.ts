import {
  giftDetailDraftResponseSchema,
  idolAliasDraftResponseSchema,
  type GiftDetailDraftResponse,
  type IdolAliasDraftResponse,
} from "@fan-support/contracts";
import {
  computeIdolAliasContentHash,
  validateGiftDetailTranslation,
} from "@fan-support/content";
import type { TransactionClient } from "./transaction-runner.js";

export type DraftRow = Record<string, unknown>;
export async function draftRows(
  client: TransactionClient,
  sql: string,
  values: unknown[] = [],
): Promise<DraftRow[]> {
  const result = (await client.query(sql, values)) as { rows: unknown };
  if (
    !Array.isArray(result.rows) ||
    result.rows.some(
      (row) => row === null || typeof row !== "object" || Array.isArray(row),
    )
  )
    throw new Error("invalid content database rows");
  return result.rows as DraftRow[];
}
export function draftTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value)))
    return new Date(value).toISOString();
  throw new Error("invalid content database timestamp");
}
function review(
  row: DraftRow | null | undefined,
  translation: boolean,
): unknown {
  if (!row) return undefined;
  if (row["status"] === "DRAFT") return { status: "DRAFT" };
  if (row["status"] === "IN_REVIEW")
    return {
      status: "IN_REVIEW",
      submittedAt: draftTimestamp(row["submitted_at"]),
    };
  if (row["status"] !== "APPROVED") return undefined;
  return {
    status: "APPROVED",
    reviewerId: row["reviewer_id"],
    reviewedAt: draftTimestamp(row["reviewed_at"]),
    reviewedContentHash: row["reviewed_content_hash"],
    ...(translation ? { reviewedSourceHash: row["reviewed_source_hash"] } : {}),
  };
}
const missing = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "NOT_FOUND",
} as const;
const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
} as const;

export async function loadIdolAliasDraft(
  client: TransactionClient,
  revisionId: string,
): Promise<IdolAliasDraftResponse> {
  const [row] = await draftRows(
    client,
    `SELECT s.*, row_to_json(r) AS review,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.alias_id, 'locale', a.locale, 'text', a.text) ORDER BY a.position)
      FROM idol_revision_aliases a WHERE a.alias_set_id = s.id), '[]'::jsonb) AS aliases
    FROM idol_revision_alias_sets s
    LEFT JOIN LATERAL (SELECT * FROM idol_revision_alias_reviews WHERE alias_set_id = s.id ORDER BY sequence DESC LIMIT 1) r ON true
    WHERE s.idol_revision_id = $1`,
    [revisionId],
  );
  if (!row) return missing;
  const parsed = idolAliasDraftResponseSchema.safeParse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    aliasSet: {
      schemaVersion: 1,
      id: row["id"],
      idolRevisionId: row["idol_revision_id"],
      aliases: row["aliases"],
      contentHash: row["content_hash"],
      editorId: row["editor_id"],
      editedAt: draftTimestamp(row["edited_at"]),
      review: review(row["review"] as DraftRow, false),
    },
  });
  if (!parsed.success || parsed.data.outcome !== "SUCCESS") return unavailable;
  if (
    computeIdolAliasContentHash(parsed.data.aliasSet.aliases) !==
    parsed.data.aliasSet.contentHash
  )
    return unavailable;
  return parsed.data;
}

function structuralBlock(row: DraftRow, items: DraftRow[]): unknown {
  const base = { id: row["block_id"], kind: row["kind"] };
  switch (row["kind"]) {
    case "HEADING":
      return { ...base, level: row["heading_level"] };
    case "PARAGRAPH":
      return base;
    case "LIST":
      return {
        ...base,
        style: row["list_style"],
        itemIds: items.map((item) => item["item_id"]),
      };
    case "SPECIFICATIONS":
      return { ...base, itemIds: items.map((item) => item["item_id"]) };
    case "MEDIA":
      return {
        ...base,
        mediaAssetId: row["media_asset_id"],
        mediaMetadataRevisionId: row["media_metadata_revision_id"],
        captionEnabled: row["caption_enabled"],
      };
    default:
      return base;
  }
}
function translatedBlock(row: DraftRow, items: DraftRow[]): unknown {
  const base = { blockId: row["block_id"], kind: row["kind"] };
  switch (row["kind"]) {
    case "HEADING":
    case "PARAGRAPH":
      return { ...base, text: row["text"] };
    case "LIST":
      return {
        ...base,
        items: items.map((item) => ({
          itemId: item["item_id"],
          text: item["text"],
        })),
      };
    case "SPECIFICATIONS":
      return {
        ...base,
        items: items.map((item) => ({
          itemId: item["item_id"],
          label: item["label"],
          value: item["value"],
        })),
      };
    case "MEDIA":
      return {
        ...base,
        mediaMetadataRevisionId: row["media_metadata_revision_id"],
        ...(row["caption"] === null ? {} : { caption: row["caption"] }),
      };
    default:
      return base;
  }
}

export async function loadGiftDetailDraft(
  client: TransactionClient,
  revisionId: string,
): Promise<GiftDetailDraftResponse> {
  const [document] = await draftRows(
    client,
    "SELECT * FROM gift_detail_documents WHERE gift_revision_id = $1",
    [revisionId],
  );
  if (!document) return missing;
  const id = document["id"];
  const blocks = await draftRows(
    client,
    "SELECT * FROM gift_detail_blocks WHERE document_id = $1 ORDER BY position",
    [id],
  );
  const blockItems = await draftRows(
    client,
    "SELECT * FROM gift_detail_block_items WHERE document_id = $1 ORDER BY position",
    [id],
  );
  const translations = await draftRows(
    client,
    `SELECT t.*, row_to_json(r) AS review FROM gift_detail_translations t
    LEFT JOIN LATERAL (SELECT * FROM gift_detail_translation_reviews WHERE gift_detail_translation_id = t.id ORDER BY sequence DESC LIMIT 1) r ON true
    WHERE t.document_id = $1 ORDER BY t.locale`,
    [id],
  );
  const translatedBlocks = await draftRows(
    client,
    "SELECT * FROM gift_detail_translation_blocks WHERE document_id = $1 ORDER BY block_id",
    [id],
  );
  const translatedItems = await draftRows(
    client,
    "SELECT * FROM gift_detail_translation_items WHERE document_id = $1 ORDER BY item_id",
    [id],
  );
  const parsed = giftDetailDraftResponseSchema.safeParse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    document: {
      schemaVersion: 1,
      id,
      giftRevisionId: document["gift_revision_id"],
      blocks: blocks.map((row) =>
        structuralBlock(
          row,
          blockItems.filter((item) => item["block_id"] === row["block_id"]),
        ),
      ),
    },
    translations: translations.map((row) => ({
      schemaVersion: 1,
      id: row["id"],
      documentId: id,
      giftRevisionId: row["gift_revision_id"],
      locale: row["locale"],
      sourceHash: row["source_hash"],
      translatedFromSourceHash: row["translated_from_source_hash"],
      origin: row["origin"],
      ...(row["import_batch_id"] === null
        ? {}
        : { importBatchId: row["import_batch_id"] }),
      editorId: row["editor_id"],
      editedAt: draftTimestamp(row["edited_at"]),
      review: review(row["review"] as DraftRow, true),
      blocks: translatedBlocks
        .filter((block) => block["translation_id"] === row["id"])
        .map((block) =>
          translatedBlock(
            block,
            translatedItems.filter(
              (item) =>
                item["translation_id"] === row["id"] &&
                item["block_id"] === block["block_id"],
            ),
          ),
        ),
    })),
  });
  if (!parsed.success || parsed.data.outcome !== "SUCCESS") return unavailable;
  const snapshot = parsed.data;
  const english = snapshot.translations.find(
    (translation) => translation.locale === "en",
  );
  if (
    !english ||
    snapshot.translations.some(
      (translation) =>
        !validateGiftDetailTranslation({
          schemaVersion: 1,
          document: snapshot.document,
          translation,
          currentEnglishSourceHash: english.sourceHash,
        }).valid,
    )
  )
    return unavailable;
  return snapshot;
}
