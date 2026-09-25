import {
  baseContentLocalizedSchema,
  baseContentPreviewResponseSchema,
  baseContentReviewResponseSchema,
  baseContentTargetSchema,
  contentAuthoringSnapshotSchema,
  type AdminContentFailure,
  type AppendBaseContentReviewCommand,
  type BaseContentLocalized,
  type BaseContentPreviewResponse,
  type BaseContentReviewContext,
  type BaseContentReviewResponse,
  type BaseContentTarget,
  type BaseContentText,
  type ContentAuthoringSnapshot,
} from "@fan-support/contracts";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { validateTranslationFieldPair } from "./translation-validation.js";
import {
  computeGiftTranslationContentHash,
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";

function failure(code: AdminContentFailure["code"]): AdminContentFailure {
  return { schemaVersion: 1, outcome: "FAILURE", code };
}

export function sameBaseContentTarget(
  left: BaseContentTarget,
  right: BaseContentTarget,
): boolean {
  if (
    left.locale !== right.locale ||
    left.revisionId.toLowerCase() !== right.revisionId.toLowerCase()
  )
    return false;
  const a = left.owner;
  const b = right.owner;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "IDOL":
      return (
        b.kind === "IDOL" && a.idolId.toLowerCase() === b.idolId.toLowerCase()
      );
    case "GIFT":
      return (
        b.kind === "GIFT" && a.giftId.toLowerCase() === b.giftId.toLowerCase()
      );
    case "HOMEPAGE":
      return true;
    case "POLICY":
      return b.kind === "POLICY" && a.policyKey === b.policyKey;
    case "MEDIA_METADATA":
      return (
        b.kind === "MEDIA_METADATA" &&
        a.mediaAssetId.toLowerCase() === b.mediaAssetId.toLowerCase()
      );
  }
}

export function computeBaseContentTextHash(content: BaseContentText): string {
  switch (content.kind) {
    case "IDOL":
      return computeIdolTranslationContentHash(content.fields);
    case "GIFT":
      return computeGiftTranslationContentHash(content.fields);
    case "HOMEPAGE":
      return computeHomepageTranslationContentHash(content.fields);
    case "POLICY":
      return computePolicyTranslationContentHash(content.fields);
    case "MEDIA_METADATA":
      return computeMediaTranslationContentHash(content.fields);
  }
}

function validStructure(
  content: BaseContentLocalized,
  source: BaseContentText,
): boolean {
  if (content.kind === "MEDIA_METADATA" && source.kind === "MEDIA_METADATA") {
    return [content.fields, source.fields].every((fields) =>
      content.structure.presentationKind === "INFORMATIVE"
        ? fields.alt.replace(/[\s\p{Cf}]/gu, "").length > 0
        : fields.alt === "",
    );
  }
  if (content.kind === "HOMEPAGE" && source.kind === "HOMEPAGE") {
    const keys = content.structure.slots.map((slot) => slot.slotKey).sort();
    return (
      new Set(keys).size === keys.length &&
      [content.fields, source.fields].every(
        (fields) =>
          JSON.stringify(
            fields.slotLabels.map((label) => label.slotKey).sort(),
          ) === JSON.stringify(keys),
      )
    );
  }
  return true;
}

/** Validate narrow repository data against its actual text, without rejecting readable stale lineage. */
export function validateBaseContentReviewResponse(
  input: BaseContentReviewResponse,
  target: BaseContentTarget,
): AdminContentFailure | null {
  try {
    const response = baseContentReviewResponseSchema.parse(input);
    if (response.outcome === "FAILURE") return response;
    const { context, content, source } = response;
    const sequence =
      context.audit.review.status === "DRAFT"
        ? 1
        : context.audit.review.status === "IN_REVIEW"
          ? 2
          : 3;
    if (
      !sameBaseContentTarget(context.target, target) ||
      context.audit.reviewSequence !== sequence ||
      computeBaseContentTextHash(content) !== context.audit.sourceHash ||
      computeBaseContentTextHash(source) !== context.currentEnglishSourceHash ||
      (target.locale === "en" &&
        (context.stale ||
          context.audit.sourceHash !== context.currentEnglishSourceHash)) ||
      !validStructure(content, source)
    )
      return failure("CONTENT_UNAVAILABLE");
    return null;
  } catch {
    return failure("CONTENT_UNAVAILABLE");
  }
}

function parseProjection(
  snapshotInput: ContentAuthoringSnapshot,
  targetInput: BaseContentTarget,
) {
  const snapshot = contentAuthoringSnapshotSchema.parse(snapshotInput);
  const target = baseContentTargetSchema.parse(targetInput);
  if (computeContentAuthoringSnapshotHash(snapshot) !== snapshot.contentHash)
    throw new Error("invalid canonical content");
  if (
    !sameBaseContentTarget(
      {
        owner: snapshot.target,
        revisionId: snapshot.revisionId,
        locale: target.locale,
      },
      target,
    )
  )
    return null;
  const selected = snapshot.content.translations.find(
    (row) => row.locale === target.locale,
  );
  const english = snapshot.content.translations.find(
    (row) => row.locale === "en",
  );
  const audit = snapshot.translationAudits.find(
    (row) => row.locale === target.locale,
  );
  if (selected === undefined || english === undefined || audit === undefined)
    return null;
  const content = baseContentLocalizedSchema.parse({
    kind: snapshot.content.kind,
    structure: snapshot.content.structure,
    ...("media" in snapshot.content ? { media: snapshot.content.media } : {}),
    fields: selected.fields,
  });
  return {
    snapshot,
    target,
    audit,
    content,
    source: { kind: snapshot.content.kind, fields: english.fields },
  };
}

export function projectBaseContentReview(
  snapshotInput: ContentAuthoringSnapshot,
  targetInput: BaseContentTarget,
): BaseContentReviewResponse {
  try {
    const projection = parseProjection(snapshotInput, targetInput);
    if (projection === null) return failure("NOT_FOUND");
    const { snapshot, target, audit, content, source } = projection;
    const englishHash = snapshot.translationAudits.find(
      (row) => row.locale === "en",
    )!.sourceHash;
    const response = baseContentReviewResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "REVIEW",
      context: {
        schemaVersion: 1,
        target,
        structureEditorId: snapshot.createdBy,
        lifecycle: snapshot.lifecycle,
        audit,
        currentEnglishSourceHash: englishHash,
        stale: audit.translatedFromSourceHash !== englishHash,
      },
      content,
      source,
    });
    return validateBaseContentReviewResponse(response, target) ?? response;
  } catch {
    return failure("CONTENT_UNAVAILABLE");
  }
}

export function projectBaseContentPreview(
  snapshotInput: ContentAuthoringSnapshot,
  targetInput: BaseContentTarget,
): BaseContentPreviewResponse {
  try {
    const projection = parseProjection(snapshotInput, targetInput);
    if (projection === null) return failure("PREVIEW_UNAVAILABLE");
    const { snapshot, target, content } = projection;
    let extensions = {};
    if (content.kind === "IDOL" && snapshot.extensions.aliases !== undefined) {
      extensions = {
        aliases: snapshot.extensions.aliases.aliases.filter(
          (alias) => alias.locale === null || alias.locale === target.locale,
        ),
      };
    }
    if (content.kind === "GIFT" && snapshot.extensions.details !== undefined) {
      const details = snapshot.extensions.details;
      const translation = details.translations.find(
        (row) => row.locale === target.locale,
      );
      if (translation === undefined) return failure("PREVIEW_UNAVAILABLE");
      extensions = {
        details: {
          document: details.document,
          translation: { blocks: translation.blocks },
        },
      };
    }
    return baseContentPreviewResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target,
      content: { ...content, ...extensions },
    });
  } catch {
    return failure("PREVIEW_UNAVAILABLE");
  }
}

/** Apply only to a new command, after current authorization and the replay decision. */
export function validateBaseContentReviewAction(
  command: AppendBaseContentReviewCommand,
  context: BaseContentReviewContext,
  text: { content: BaseContentLocalized; source: BaseContentText },
): AdminContentFailure | null {
  if (!sameBaseContentTarget(command.target, context.target))
    return failure("CONTENT_UNAVAILABLE");
  if (command.expectedVersion !== context.audit.reviewSequence)
    return failure("STALE_VERSION");
  if (
    command.expectedContentHash !== context.audit.sourceHash ||
    command.expectedSourceHash !== context.currentEnglishSourceHash ||
    context.stale
  )
    return failure("STALE_CONTENT");
  if (context.lifecycle.status !== "DRAFT")
    return failure("REVISION_NOT_DRAFT");
  const status = command.action === "SUBMIT" ? "DRAFT" : "IN_REVIEW";
  if (context.audit.review.status !== status)
    return failure("INVALID_REVIEW_STATE");
  const actor = command.actorId.toLowerCase();
  if (
    command.action === "SUBMIT" &&
    actor !== context.audit.editorId.toLowerCase()
  )
    return failure("FORBIDDEN");
  if (
    command.action === "APPROVE" &&
    (actor === context.audit.editorId.toLowerCase() ||
      actor === context.structureEditorId.toLowerCase())
  )
    return failure("SELF_REVIEW");
  if (
    validateTranslationFieldPair(text.source.fields, text.content.fields)
      .length > 0
  )
    return failure("INVALID_CONTENT");
  return null;
}
