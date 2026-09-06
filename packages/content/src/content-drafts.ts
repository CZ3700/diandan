import {
  contentTimestampSchema,
  createGiftDetailDraftCommandSchema,
  createIdolAliasDraftCommandSchema,
  giftDetailDraftResponseSchema,
  idolAliasDraftResponseSchema,
  idolAliasSetSchema,
} from "@fan-support/contracts";
import type {
  ContentDraftFailure,
  GiftDetailDraftResponse,
  IdolAliasDraftResponse,
} from "@fan-support/contracts";

import { computeGiftDetailTranslationContentHash } from "./gift-details.js";
import { computeTranslationContentHash } from "./hashing.js";

function failure(code: ContentDraftFailure["code"]): ContentDraftFailure {
  return { schemaVersion: 1, outcome: "FAILURE", code };
}

/** Set order is not semantic. Identity, locale and NFC copy all bind approval. */
export function computeIdolAliasContentHash(aliasesInput: unknown): string {
  const aliases = idolAliasSetSchema.shape.aliases.parse(aliasesInput);
  return computeTranslationContentHash("idol-alias-set-v1", {
    aliases: aliases.toSorted((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  });
}

/** Prepares content only; persistence must authorize the actor and DRAFT parent. */
export function prepareIdolAliasDraft(
  commandInput: unknown,
  editedAt: string,
): IdolAliasDraftResponse {
  const command = createIdolAliasDraftCommandSchema.safeParse(commandInput);
  if (!command.success) return failure("INVALID_COMMAND");
  if (!contentTimestampSchema.safeParse(editedAt).success) {
    return failure("CONTENT_UNAVAILABLE");
  }
  const { id, idolRevisionId, aliases, actorId } = command.data;
  const response = idolAliasDraftResponseSchema.safeParse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    aliasSet: {
      schemaVersion: 1,
      id,
      idolRevisionId,
      aliases,
      contentHash: computeIdolAliasContentHash(aliases),
      editorId: actorId,
      editedAt,
      review: { status: "DRAFT" },
    },
  });
  return response.success ? response.data : failure("INVALID_CONTENT");
}

/** Draft creation never borrows old description approvals or trusts client hashes. */
export function prepareGiftDetailDraft(
  commandInput: unknown,
  editedAt: string,
): GiftDetailDraftResponse {
  const command = createGiftDetailDraftCommandSchema.safeParse(commandInput);
  if (!command.success) return failure("INVALID_COMMAND");
  if (!contentTimestampSchema.safeParse(editedAt).success) {
    return failure("CONTENT_UNAVAILABLE");
  }
  const { document, translations, actorId } = command.data;
  const english = translations.find((row) => row.locale === "en");
  if (english === undefined) return failure("INVALID_COMMAND");

  try {
    const englishHash = computeGiftDetailTranslationContentHash(document, {
      blocks: english.blocks,
    });
    return giftDetailDraftResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      document,
      translations: translations.map((row) => ({
        schemaVersion: 1,
        id: row.id,
        documentId: document.id,
        giftRevisionId: document.giftRevisionId,
        locale: row.locale,
        origin: row.origin,
        ...(row.importBatchId === undefined
          ? {}
          : { importBatchId: row.importBatchId }),
        blocks: row.blocks.map((block) => {
          if (block.kind !== "MEDIA") return block;
          return {
            blockId: block.blockId,
            kind: block.kind,
            mediaMetadataRevisionId: block.mediaMetadataRevisionId,
            ...(block.caption === undefined ? {} : { caption: block.caption }),
          };
        }),
        sourceHash: computeGiftDetailTranslationContentHash(document, {
          blocks: row.blocks,
        }),
        translatedFromSourceHash: englishHash,
        editorId: actorId,
        editedAt,
        review: { status: "DRAFT" },
      })),
    });
  } catch {
    return failure("INVALID_CONTENT");
  }
}
