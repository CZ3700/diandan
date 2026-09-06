import { createHash } from "node:crypto";
import {
  adminIdentityIdSchema,
  contentAuthoringCommandSchema,
  contentAuthoringContentSchema,
  contentAuthoringPlanSchema,
  contentAuthoringSnapshotSchema,
  contentTimestampSchema,
  DEFAULT_LOCALE,
  type ContentAuthoringCommand,
  type ContentAuthoringContent,
  type ContentAuthoringPlan,
  type ContentAuthoringSnapshot,
} from "@fan-support/contracts";
import {
  computeGiftTranslationContentHash,
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";
import { computeIdolAliasContentHash } from "./content-drafts.js";
import {
  computeGiftDetailTranslationContentHash,
  validateGiftDetailFields,
} from "./gift-details.js";
import { validateTranslationFieldPair } from "./translation-validation.js";

export type ContentAuthoringMutation = Extract<
  ContentAuthoringCommand,
  { action: "CREATE" | "COPY" }
>;
export type ContentAuthoringContext = Readonly<{
  actorId: string;
  createdAt: string;
}>;

function invalid(): never {
  throw new TypeError("invalid content authoring input");
}

function canonical(value: unknown, normalizeStrings = true): unknown {
  if (typeof value === "string")
    return normalizeStrings ? value.normalize("NFC") : value;
  if (Array.isArray(value))
    return value.map((item) => canonical(item, normalizeStrings));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item, normalizeStrings)]),
    );
  return value;
}
function same(left: unknown, right: unknown, normalizeStrings = true): boolean {
  return (
    JSON.stringify(canonical(left, normalizeStrings)) ===
    JSON.stringify(canonical(right, normalizeStrings))
  );
}

function textHash(content: ContentAuthoringContent, locale: string): string {
  switch (content.kind) {
    case "IDOL":
      return computeIdolTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "GIFT":
      return computeGiftTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "HOMEPAGE":
      return computeHomepageTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "POLICY":
      return computePolicyTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
    case "MEDIA_METADATA":
      return computeMediaTranslationContentHash(
        content.translations.find((row) => row.locale === locale)!.fields,
      );
  }
}

/** Shape checks apply even to old drafts; ICU source matching is only required for newly supplied text. */
function validateContent(
  content: ContentAuthoringContent,
  editedLocales: ReadonlySet<string>,
): void {
  const english = content.translations.find(
    (row) => row.locale === DEFAULT_LOCALE,
  )!;
  for (const row of content.translations) {
    if (
      editedLocales.has(row.locale) &&
      validateTranslationFieldPair(english.fields, row.fields).length > 0
    )
      invalid();
  }
  if (content.kind === "MEDIA_METADATA") {
    for (const row of content.translations) {
      const visible = row.fields.alt.replace(/[\s\p{Cf}]/gu, "").length > 0;
      if (
        content.structure.presentationKind === "INFORMATIVE"
          ? !visible
          : row.fields.alt !== ""
      )
        invalid();
    }
  }
  if (content.kind === "HOMEPAGE") {
    const keys = content.structure.slots.map((slot) => slot.slotKey).sort();
    if (new Set(keys).size !== keys.length) invalid();
    for (const row of content.translations)
      if (
        !same(keys, row.fields.slotLabels.map((label) => label.slotKey).sort())
      )
        invalid();
  }
  if (content.kind === "GIFT" && content.details !== undefined) {
    for (const row of content.details.translations) {
      if (
        validateGiftDetailFields(content.details.blocks, { blocks: row.blocks })
          .length > 0
      )
        invalid();
    }
  }
}

function validateExtensions(snapshot: ContentAuthoringSnapshot): void {
  const { content, extensions } = snapshot;
  if (content.kind === "IDOL") {
    if ((content.aliases !== undefined) !== (extensions.aliases !== undefined))
      invalid();
    if (
      extensions.aliases !== undefined &&
      (!same(content.aliases, extensions.aliases.aliases) ||
        computeIdolAliasContentHash(extensions.aliases.aliases) !==
          extensions.aliases.contentHash)
    )
      invalid();
  }
  if (content.kind === "GIFT") {
    const details = extensions.details;
    if ((content.details !== undefined) !== (details !== undefined)) invalid();
    if (details !== undefined) {
      const fields = {
        blocks: details.document.blocks,
        translations: details.translations.map((row) => ({
          locale: row.locale,
          origin: row.origin,
          ...(row.importBatchId === undefined
            ? {}
            : { importBatchId: row.importBatchId }),
          blocks: row.blocks,
        })),
      };
      if (!same(content.details, fields)) invalid();
      const english = details.translations.find(
        (row) => row.locale === DEFAULT_LOCALE,
      );
      if (english === undefined) invalid();
      for (const row of details.translations) {
        if (
          computeGiftDetailTranslationContentHash(details.document, {
            blocks: row.blocks,
          }) !== row.sourceHash
        )
          invalid();
      }
      if (english.translatedFromSourceHash !== english.sourceHash) invalid();
    }
  }
}

function parseSnapshot(
  input: ContentAuthoringSnapshot,
): ContentAuthoringSnapshot {
  const result = contentAuthoringSnapshotSchema.safeParse(input);
  if (!result.success) invalid();
  const snapshot = result.data;
  validateContent(snapshot.content, new Set());
  for (const row of snapshot.content.translations) {
    const audit = snapshot.translationAudits.find(
      (item) => item.locale === row.locale,
    )!;
    if (
      textHash(snapshot.content, row.locale) !== audit.sourceHash ||
      row.origin !== audit.origin ||
      row.importBatchId !== audit.importBatchId
    )
      invalid();
    const expectedSequence =
      audit.review.status === "DRAFT"
        ? 1
        : audit.review.status === "IN_REVIEW"
          ? 2
          : 3;
    if (audit.reviewSequence !== expectedSequence) invalid();
  }
  validateExtensions(snapshot);
  return snapshot;
}

/** Includes complete typed content and persisted review evidence, excluding only the moving head and this digest. */
export function computeContentAuthoringSnapshotHash(
  input: ContentAuthoringSnapshot,
): string {
  const snapshot = parseSnapshot(input);
  const payload = {
    schemaVersion: snapshot.schemaVersion,
    target: snapshot.target,
    revisionId: snapshot.revisionId,
    revisionNumber: snapshot.revisionNumber,
    lifecycle: snapshot.lifecycle,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
    content: snapshot.content,
    translationAudits: snapshot.translationAudits,
    extensions: snapshot.extensions,
  };
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          purpose: "content-authoring-snapshot-v1",
          snapshot: payload,
        }),
      ),
      "utf8",
    )
    .digest("hex");
}

export function prepareContentAuthoring(
  input: ContentAuthoringMutation,
  sourceInput: ContentAuthoringSnapshot | null,
  context: ContentAuthoringContext,
): ContentAuthoringPlan {
  const parsed = contentAuthoringCommandSchema.safeParse(input);
  const actor = adminIdentityIdSchema.safeParse(context?.actorId);
  const time = contentTimestampSchema.safeParse(context?.createdAt);
  if (
    !parsed.success ||
    parsed.data.action === "READ" ||
    !actor.success ||
    !time.success
  )
    invalid();
  const command = parsed.data;
  let source: ContentAuthoringSnapshot | null = null;
  let content: ContentAuthoringContent;
  let overrides: ReadonlySet<string>;
  if (command.action === "CREATE") {
    if (sourceInput !== null) invalid();
    content = command.content;
    overrides = new Set(content.translations.map((row) => row.locale));
  } else {
    if (sourceInput === null) invalid();
    source = parseSnapshot(sourceInput);
    // UUID identity is case insensitive; policy keys and content remain case sensitive.
    const sourceTarget = JSON.stringify(source.target);
    const requestedTarget = JSON.stringify(command.target);
    if (
      (source.target.kind === "POLICY"
        ? sourceTarget !== requestedTarget
        : sourceTarget.toLowerCase() !== requestedTarget.toLowerCase()) ||
      source.revisionId.toLowerCase() !==
        command.sourceRevisionId.toLowerCase() ||
      computeContentAuthoringSnapshotHash(source) !== source.contentHash ||
      source.contentHash !== command.expectedSourceHash
    )
      invalid();
    const replacements = command.changes.translations ?? [];
    const translated = new Map(
      source.content.translations.map((row) => [row.locale, row]),
    );
    for (const row of replacements) translated.set(row.locale, row);
    const merged = contentAuthoringContentSchema.safeParse({
      ...source.content,
      ...command.changes,
      translations: [...translated.values()],
    });
    if (!merged.success) invalid();
    content = merged.data;
    overrides = new Set(replacements.map((row) => row.locale));
  }
  validateContent(content, overrides);
  const englishHash = textHash(content, DEFAULT_LOCALE);
  const translationAudits = content.translations.map((row) => {
    const previous = source?.translationAudits.find(
      (audit) => audit.locale === row.locale,
    );
    const sourceHash = textHash(content, row.locale);
    const explicit = overrides.has(row.locale);
    const previousFields = source?.content.translations.find(
      (item) => item.locale === row.locale,
    )?.fields;
    const canInherit =
      previous !== undefined &&
      previous.review.status === "APPROVED" &&
      sourceHash === previous.sourceHash &&
      previous.translatedFromSourceHash === englishHash &&
      row.origin === previous.origin &&
      row.importBatchId === previous.importBatchId &&
      (!explicit ||
        (row.origin === "HUMAN" && same(row.fields, previousFields, false)));
    if (canInherit && source !== null) {
      return {
        locale: row.locale,
        sourceHash: previous.sourceHash,
        translatedFromSourceHash: previous.translatedFromSourceHash,
        origin: previous.origin,
        ...(previous.importBatchId === undefined
          ? {}
          : { importBatchId: previous.importBatchId }),
        editorId: previous.editorId,
        editedAt: previous.editedAt,
        review: previous.review,
        inheritedFrom: {
          revisionId: source.revisionId,
          translationId: previous.id,
          reviewId: previous.reviewId,
        },
      };
    }
    // An untouched foreign draft still describes its original English source.
    // The new version author is the copier; this does not claim a new human translation.
    const translatedFromSourceHash =
      row.locale !== DEFAULT_LOCALE && !explicit && previous !== undefined
        ? previous.translatedFromSourceHash
        : englishHash;
    return {
      locale: row.locale,
      sourceHash,
      translatedFromSourceHash,
      origin: row.origin,
      ...(row.importBatchId === undefined
        ? {}
        : { importBatchId: row.importBatchId }),
      editorId: actor.data,
      editedAt: time.data,
      review: { status: "DRAFT" as const },
    };
  });
  const plan = contentAuthoringPlanSchema.safeParse({
    schemaVersion: 1,
    content,
    translationAudits,
  });
  if (!plan.success) invalid();
  return plan.data;
}
