import {
  giftDetailDocumentSchema,
  giftDetailTranslationFieldsSchema,
  giftDetailValidationInputSchema,
  sourceHashSchema,
} from "@fan-support/contracts";
import type {
  GiftDetailDocument,
  GiftDetailTranslationFields,
  GiftDetailValidationIssue,
  GiftDetailValidationReport,
} from "@fan-support/contracts";

import { computeTranslationContentHash } from "./hashing.js";
import { sameUuid } from "./uuid-identity.js";

export function validateGiftDetailFields(
  blocks: unknown,
  fields: unknown,
): GiftDetailValidationIssue[] {
  const parsedBlocks = giftDetailDocumentSchema.shape.blocks.safeParse(blocks);
  const parsedFields = giftDetailTranslationFieldsSchema.safeParse(fields);
  if (!parsedBlocks.success)
    return [{ code: "SCHEMA_INVALID", path: ["document", "blocks"] }];
  if (!parsedFields.success)
    return [{ code: "SCHEMA_INVALID", path: ["translation"] }];
  return structuralIssues({ blocks: parsedBlocks.data }, parsedFields.data);
}

function structuralIssues(
  document: Pick<GiftDetailDocument, "blocks">,
  fields: GiftDetailTranslationFields,
): GiftDetailValidationIssue[] {
  const issues: GiftDetailValidationIssue[] = [];
  const byId = new Map(
    fields.blocks.map((block, index) => [block.blockId, { block, index }]),
  );
  const knownIds = new Set(document.blocks.map((block) => block.id));
  for (const [index, block] of fields.blocks.entries()) {
    if (!knownIds.has(block.blockId)) {
      issues.push({
        code: "BLOCK_UNKNOWN",
        path: ["translation", "blocks", index, "blockId"],
      });
    }
  }
  for (const [index, expected] of document.blocks.entries()) {
    const found = byId.get(expected.id);
    if (found === undefined) {
      issues.push({
        code: "BLOCK_MISSING",
        path: ["document", "blocks", index, "id"],
      });
      continue;
    }
    const actual = found.block;
    const path = ["translation", "blocks", found.index];
    if (expected.kind !== actual.kind) {
      issues.push({ code: "BLOCK_KIND_MISMATCH", path: [...path, "kind"] });
      continue;
    }
    if (
      (expected.kind === "LIST" || expected.kind === "SPECIFICATIONS") &&
      (actual.kind === "LIST" || actual.kind === "SPECIFICATIONS")
    ) {
      const expectedItems = new Set(expected.itemIds);
      const actualItems = new Set(actual.items.map((item) => item.itemId));
      for (const [itemIndex, item] of actual.items.entries()) {
        if (!expectedItems.has(item.itemId)) {
          issues.push({
            code: "ITEM_UNKNOWN",
            path: [...path, "items", itemIndex, "itemId"],
          });
        }
      }
      for (const [itemIndex, itemId] of expected.itemIds.entries()) {
        if (!actualItems.has(itemId)) {
          issues.push({
            code: "ITEM_MISSING",
            path: ["document", "blocks", index, "itemIds", itemIndex],
          });
        }
      }
    }
    if (expected.kind === "MEDIA" && actual.kind === "MEDIA") {
      if (
        !sameUuid(
          expected.mediaMetadataRevisionId,
          actual.mediaMetadataRevisionId,
        )
      ) {
        issues.push({
          code: "MEDIA_REFERENCE_MISMATCH",
          path: [...path, "mediaMetadataRevisionId"],
        });
      }
      if (expected.captionEnabled && actual.caption === undefined) {
        issues.push({ code: "CAPTION_REQUIRED", path: [...path, "caption"] });
      }
      if (!expected.captionEnabled && actual.caption !== undefined) {
        issues.push({ code: "CAPTION_UNEXPECTED", path: [...path, "caption"] });
      }
    }
  }
  return issues;
}

function compareKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashParsedFields(
  document: GiftDetailDocument,
  fields: GiftDetailTranslationFields,
): string {
  const blocks = document.blocks.map((block) =>
    block.kind === "MEDIA"
      ? {
          ...block,
          mediaAssetId: block.mediaAssetId.toLowerCase(),
          mediaMetadataRevisionId: block.mediaMetadataRevisionId.toLowerCase(),
        }
      : block,
  );
  const translatedBlocks = fields.blocks
    .map((block) => {
      if (block.kind === "MEDIA") {
        return {
          ...block,
          mediaMetadataRevisionId: block.mediaMetadataRevisionId.toLowerCase(),
        };
      }
      if (block.kind === "LIST" || block.kind === "SPECIFICATIONS") {
        return {
          ...block,
          items: block.items.toSorted((left, right) =>
            compareKey(left.itemId, right.itemId),
          ),
        };
      }
      return block;
    })
    .toSorted((left, right) => compareKey(left.blockId, right.blockId));
  // Structure and copy are semantic; revision identities and audit timestamps
  // are checked separately so unchanged content can retain its hash.
  return computeTranslationContentHash("gift-detail-translation-v1", {
    blocks,
    translatedBlocks,
  });
}

/** Server-side content hash. The English fields produce the current source hash. */
export function computeGiftDetailTranslationContentHash(
  documentInput: unknown,
  fieldsInput: unknown,
): string {
  const document = giftDetailDocumentSchema.parse(documentInput);
  const fields = giftDetailTranslationFieldsSchema.parse(fieldsInput);
  if (structuralIssues(document, fields).length > 0) {
    throw new Error("gift detail fields do not match the declared document");
  }
  return hashParsedFields(document, fields);
}

/**
 * Checks structure and hashes, including a trusted server-derived current
 * English hash. A valid DRAFT remains a draft: this does not grant review
 * permission, verify persisted approval evidence, or authorize publication.
 */
export function validateGiftDetailTranslation(
  input: unknown,
): GiftDetailValidationReport {
  const parsed = giftDetailValidationInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      schemaVersion: 1,
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "SCHEMA_INVALID",
        path: issue.path.map((segment) =>
          typeof segment === "number" ? segment : String(segment),
        ),
      })),
    };
  }
  const { document, translation, currentEnglishSourceHash } = parsed.data;
  const issues = structuralIssues(document, translation);
  if (!sameUuid(document.id, translation.documentId)) {
    issues.push({
      code: "DOCUMENT_TARGET_MISMATCH",
      path: ["translation", "documentId"],
    });
  }
  if (!sameUuid(document.giftRevisionId, translation.giftRevisionId)) {
    issues.push({
      code: "GIFT_REVISION_TARGET_MISMATCH",
      path: ["translation", "giftRevisionId"],
    });
  }
  if (issues.length > 0) {
    return { schemaVersion: 1, valid: false, issues };
  }
  const contentHash = sourceHashSchema.parse(
    hashParsedFields(document, translation),
  );
  if (translation.sourceHash !== contentHash) {
    issues.push({
      code: "CONTENT_HASH_MISMATCH",
      path: ["translation", "sourceHash"],
    });
  }
  if (translation.translatedFromSourceHash !== currentEnglishSourceHash) {
    issues.push({
      code: "STALE_ENGLISH_SOURCE",
      path: ["translation", "translatedFromSourceHash"],
    });
  }
  return issues.length > 0
    ? { schemaVersion: 1, valid: false, issues }
    : { schemaVersion: 1, valid: true, contentHash, issues: [] };
}
