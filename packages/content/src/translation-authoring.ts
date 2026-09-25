import {
  contentAuthoringSnapshotSchema,
  SUPPORTED_LOCALES,
  type ContentAuthoringSnapshot,
  type ContentAuthoringTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { sameBaseContentTarget } from "./base-content.js";

export function assertTranslationSnapshot(
  input: ContentAuthoringSnapshot,
  target: { owner: ContentAuthoringTarget; revisionId: string },
): ContentAuthoringSnapshot {
  const snapshot = contentAuthoringSnapshotSchema.parse(input);
  if (
    !sameBaseContentTarget(
      { ...target, locale: "en" },
      { owner: snapshot.target, revisionId: snapshot.revisionId, locale: "en" },
    ) ||
    computeContentAuthoringSnapshotHash(snapshot) !== snapshot.contentHash
  )
    throw new Error("CONTENT_UNAVAILABLE");
  return snapshot;
}
export function orderedTranslationLocales(
  locales: readonly SupportedLocale[],
): SupportedLocale[] {
  return SUPPORTED_LOCALES.filter((locale) => locales.includes(locale));
}
export function translationCopyLocales(
  snapshot: ContentAuthoringSnapshot,
  locales: readonly SupportedLocale[],
): SupportedLocale[] {
  const content = snapshot.content;
  const aliases = content.kind === "IDOL" ? content.aliases : undefined;
  let extensionLocales: SupportedLocale[] = [];
  if (aliases !== undefined) {
    extensionLocales =
      aliases.length === 0 || aliases.some((alias) => alias.locale === null)
        ? [...SUPPORTED_LOCALES]
        : aliases.flatMap((alias) =>
            alias.locale === null ? [] : [alias.locale],
          );
  } else if (content.kind === "GIFT") {
    extensionLocales =
      content.details?.translations.map((row) => row.locale) ?? [];
  }
  return orderedTranslationLocales([
    ...locales,
    ...(locales.includes("en")
      ? content.translations.map((row) => row.locale)
      : []),
    ...extensionLocales,
  ]);
}
export function canonicalTranslationValue(value: unknown): string {
  function stable(child: unknown): unknown {
    if (Array.isArray(child)) return child.map(stable);
    if (child === null || typeof child !== "object") return child;
    return Object.fromEntries(
      Object.entries(child)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return JSON.stringify(stable(value));
}
