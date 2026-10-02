import {
  SUPPORTED_LOCALES,
  contentAuthoringChangesSchema,
  policyKindSchema,
  policyTranslationFieldsSchema,
  supportedLocaleSchema,
  type ContentAuthoringContent,
  type PolicyTranslationFields,
  type SupportedLocale,
  type TranslationWorkspaceResponse,
} from "@fan-support/contracts";

export type PolicyContent = Extract<
  ContentAuthoringContent,
  { kind: "POLICY" }
>;
export type PolicyTranslation = PolicyContent["translations"][number];
export type PolicyKind = PolicyContent["structure"]["kind"];
export type PolicyWorkspaceData = Extract<
  TranslationWorkspaceResponse,
  { outcome: "SUCCESS" }
>;
export type PolicyDraft = {
  /** Unknown only for a scoped editor adding a missing locale without structure access. */
  kind: PolicyKind | null;
  effectiveAt: string;
  translations: PolicyTranslation[];
  refreshLocales?: SupportedLocale[];
};
export type PolicyPackageDocument = {
  kind: PolicyKind;
  translations: (PolicyTranslation & { origin: "MACHINE" | "HUMAN" })[];
};
export type PolicyPackage = {
  schemaVersion: 1;
  documents: PolicyPackageDocument[];
};

function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new Error("INVALID_PACKAGE");
  return value as Record<string, unknown>;
}
/** This is a local draft template, never an approval or translation-transfer receipt. */
export function parsePolicyPackage(text: string): PolicyPackage {
  if (text.length > 2_000_000) throw new Error("INVALID_PACKAGE");
  const root = object(JSON.parse(text) as unknown, [
    "schemaVersion",
    "documents",
  ]);
  if (
    root["schemaVersion"] !== 1 ||
    !Array.isArray(root["documents"]) ||
    !root["documents"].length ||
    root["documents"].length > 4
  )
    throw new Error("INVALID_PACKAGE");
  const documents = root["documents"].map(
    (value: unknown): PolicyPackageDocument => {
      const doc = object(value, ["kind", "translations"]);
      const kind = policyKindSchema.parse(doc["kind"]);
      if (
        !Array.isArray(doc["translations"]) ||
        doc["translations"].length !== SUPPORTED_LOCALES.length
      )
        throw new Error("INVALID_PACKAGE");
      const translations = doc["translations"].map(
        (value: unknown): PolicyPackageDocument["translations"][number] => {
          const row = object(value, ["locale", "origin", "fields"]);
          const origin = row["origin"];
          if (origin !== "MACHINE" && origin !== "HUMAN")
            throw new Error("INVALID_PACKAGE");
          return {
            locale: supportedLocaleSchema.parse(row["locale"]),
            origin,
            fields: policyTranslationFieldsSchema.parse(row["fields"]),
          };
        },
      );
      if (
        new Set(translations.map((row) => row.locale)).size !==
        SUPPORTED_LOCALES.length
      )
        throw new Error("INVALID_PACKAGE");
      return { kind, translations };
    },
  );
  if (new Set(documents.map((doc) => doc.kind)).size !== documents.length)
    throw new Error("INVALID_PACKAGE");
  return { schemaVersion: 1, documents };
}
export const emptyPolicyFields = (): PolicyTranslationFields => ({
  title: "",
  summary: "",
  body: "",
});
export function validPolicyEffectiveTime(
  previous: string | null,
  next: string,
  now: number,
) {
  if (previous !== null && previous === next) return true;
  return Number.isFinite(Date.parse(next)) && Date.parse(next) > now;
}
export function samePolicyFields(
  a: PolicyTranslationFields,
  b: PolicyTranslationFields,
) {
  return a.title === b.title && a.summary === b.summary && a.body === b.body;
}
export function policyChanges(baseline: PolicyDraft, draft: PolicyDraft) {
  if (baseline.kind !== draft.kind) throw new Error("INVALID_COMMAND");
  const translations = draft.translations.filter((row) => {
    const old = baseline.translations.find(
      (value) => value.locale === row.locale,
    );
    return (
      draft.refreshLocales?.includes(row.locale) ||
      !old ||
      !samePolicyFields(old.fields, row.fields) ||
      old.origin !== row.origin ||
      old.importBatchId !== row.importBatchId
    );
  });
  return contentAuthoringChangesSchema.parse({
    kind: "POLICY",
    ...(baseline.effectiveAt !== draft.effectiveAt
      ? { structure: { kind: draft.kind, effectiveAt: draft.effectiveAt } }
      : {}),
    ...(translations.length ? { translations } : {}),
  });
}
export function samePolicyDraft(a: PolicyDraft, b: PolicyDraft) {
  return (
    [...(a.refreshLocales ?? [])].sort().join() ===
      [...(b.refreshLocales ?? [])].sort().join() &&
    a.kind === b.kind &&
    a.effectiveAt === b.effectiveAt &&
    a.translations.length === b.translations.length &&
    a.translations.every((row) => {
      const other = b.translations.find(
        (candidate) => candidate.locale === row.locale,
      );
      return (
        other &&
        samePolicyFields(row.fields, other.fields) &&
        row.origin === other.origin &&
        row.importBatchId === other.importBatchId
      );
    })
  );
}
export function replacePolicyTranslation(
  draft: PolicyDraft,
  locale: SupportedLocale,
  patch: Partial<Pick<PolicyTranslation, "fields" | "origin">>,
): PolicyDraft {
  const prior = draft.translations.find((row) => row.locale === locale) ?? {
    locale,
    origin: "MACHINE" as const,
    fields: emptyPolicyFields(),
  };
  const next = { ...prior, ...patch };
  if (next.origin !== "IMPORT") delete next.importBatchId;
  return {
    ...draft,
    translations: [
      ...draft.translations.filter((row) => row.locale !== locale),
      next,
    ],
  };
}
