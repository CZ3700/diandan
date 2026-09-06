import {
  baseContentTextSchema,
  translationWorkspaceContextSchema,
  translationWorkspaceResponseSchema,
  SUPPORTED_LOCALES,
  type TranslationWorkspaceContext,
  type TranslationWorkspaceResponse,
  type BaseContentTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  computeBaseContentTextHash,
  projectBaseContentReview,
} from "./base-content.js";
import {
  assertTranslationSnapshot,
  canonicalTranslationValue,
  translationCopyLocales,
} from "./translation-authoring.js";

function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (canonicalTranslationValue(before) === canonicalTranslationValue(after))
    return [];
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .flatMap((key) =>
        changedPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key),
      );
  }
  return [prefix];
}
export function projectTranslationWorkspace(
  input: TranslationWorkspaceContext,
  target: BaseContentTarget,
  permissions: {
    readableLocales: readonly SupportedLocale[];
    editableLocales: readonly SupportedLocale[];
  },
): TranslationWorkspaceResponse {
  try {
    const context = translationWorkspaceContextSchema.parse(input);
    const snapshot = assertTranslationSnapshot(context.snapshot, target);
    if (!permissions.readableLocales.includes(target.locale))
      return { schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" };
    const english = snapshot.content.translations.find(
      (row) => row.locale === "en",
    )!;
    const source = baseContentTextSchema.parse({
      kind: snapshot.content.kind,
      fields: english.fields,
    });
    const englishHash = computeBaseContentTextHash(source);
    const audit = snapshot.translationAudits.find(
      (row) => row.locale === target.locale,
    );
    const selected = audit ? projectBaseContentReview(snapshot, target) : null;
    if (selected?.outcome === "FAILURE") return selected;
    const stale =
      audit !== undefined && audit.translatedFromSourceHash !== englishHash;
    const previous = stale ? context.previousEnglish : null;
    if (
      previous !== null &&
      (previous.text.kind !== source.kind ||
        computeBaseContentTextHash(previous.text) !== previous.sourceHash ||
        previous.sourceHash !== audit?.translatedFromSourceHash)
    )
      throw new Error("invalid historical source");
    const requiredLocales = translationCopyLocales(snapshot, [target.locale]);
    const canSave =
      !context.ownerArchived &&
      requiredLocales.every((locale) =>
        permissions.editableLocales.includes(locale),
      );
    return translationWorkspaceResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "TRANSLATION_WORKSPACE",
      target,
      revisionNumber: snapshot.revisionNumber,
      authoringHeadVersion: snapshot.headVersion,
      contentHash: snapshot.contentHash,
      lifecycle: snapshot.lifecycle,
      cells: SUPPORTED_LOCALES.map((locale) => {
        if (!permissions.readableLocales.includes(locale))
          return { locale, access: "RESTRICTED" };
        const row = snapshot.translationAudits.find(
          (candidate) => candidate.locale === locale,
        );
        return {
          locale,
          access: "READABLE",
          status:
            row === undefined
              ? "MISSING"
              : row.translatedFromSourceHash !== englishHash
                ? "STALE"
                : row.review.status,
          reviewStatus: row?.review.status ?? null,
        };
      }),
      source,
      selected,
      sourceDiff: {
        status: !stale
          ? "CURRENT"
          : previous === null
            ? "UNAVAILABLE"
            : "AVAILABLE",
        previous,
        changedPaths:
          previous === null
            ? []
            : changedPaths(previous.text.fields, source.fields),
      },
      editability: {
        canSave,
        reason: canSave
          ? "ALLOWED"
          : context.ownerArchived
            ? "ARCHIVED"
            : permissions.editableLocales.includes(target.locale)
              ? "COPY_SCOPE_REQUIRED"
              : "FORBIDDEN",
        requiredLocales,
      },
    });
  } catch {
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    };
  }
}
