import {
  contentReviewResponseSchema,
  type ContentDraftResponse,
  type ContentReviewContext,
  type ContentReviewResponse,
} from "@fan-support/contracts";
import {
  computeGiftDetailTranslationContentHash,
  computeIdolAliasContentHash,
} from "@fan-support/content";
import {
  aliasContentLocales,
  orderedContentLocales,
} from "./admin-content-review-validation.js";
import { rejectAdminContent } from "./admin-content-results.js";

/** An assigned reviewer sees the requested translation and its real English source. */
export function projectContentForReview(
  context: ContentReviewContext,
  draft: Extract<ContentDraftResponse, { outcome: "SUCCESS" }>,
): ContentReviewResponse {
  if (context.target.kind === "IDOL_ALIASES") {
    if (!("aliasSet" in draft)) rejectAdminContent("CONTENT_UNAVAILABLE");
    const set = draft.aliasSet;
    if (
      set.idolRevisionId.toLowerCase() !==
        context.target.revisionId.toLowerCase() ||
      set.id.toLowerCase() !== context.subjectId.toLowerCase() ||
      set.contentHash !== context.contentHash ||
      computeIdolAliasContentHash(set.aliases) !== context.contentHash ||
      set.editorId.toLowerCase() !== context.editorId.toLowerCase() ||
      set.editorId.toLowerCase() !== context.structureEditorId.toLowerCase() ||
      set.review.status !== context.status ||
      context.sourceHash !== null ||
      JSON.stringify(aliasContentLocales(set.aliases)) !==
        JSON.stringify(orderedContentLocales(context.locales))
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
    return contentReviewResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "REVIEW",
      context,
      content: { kind: "IDOL_ALIASES", aliases: set.aliases },
      source: null,
    });
  }
  if (
    !("document" in draft) ||
    draft.document.giftRevisionId.toLowerCase() !==
      context.target.revisionId.toLowerCase()
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  const locale = context.target.locale;
  const translation = draft.translations.find((row) => row.locale === locale);
  const english = draft.translations.find((row) => row.locale === "en");
  if (
    !translation ||
    !english ||
    translation.id.toLowerCase() !== context.subjectId.toLowerCase() ||
    translation.editorId.toLowerCase() !== context.editorId.toLowerCase() ||
    translation.review.status !== context.status ||
    translation.sourceHash !== context.contentHash ||
    translation.translatedFromSourceHash !== context.sourceHash ||
    english.sourceHash !== context.sourceHash ||
    computeGiftDetailTranslationContentHash(draft.document, {
      blocks: translation.blocks,
    }) !== context.contentHash ||
    computeGiftDetailTranslationContentHash(draft.document, {
      blocks: english.blocks,
    }) !== context.sourceHash
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return contentReviewResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "REVIEW",
    context,
    content: {
      kind: "GIFT_DETAILS",
      document: draft.document,
      translation: { blocks: translation.blocks },
    },
    source: { blocks: english.blocks },
  });
}
