import type {
  ContentAuthoringPlan,
  ContentAuthoringSnapshot,
} from "@fan-support/contracts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
const same = (left: unknown, right: unknown) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const record = (value: object) => value as Readonly<Record<string, unknown>>;

/** Only schema-owned paths enter audit storage; no content values are recorded. */
export function contentAuthoringChangedPaths(
  plan: ContentAuthoringPlan,
  source: ContentAuthoringSnapshot | null,
): string[] {
  const paths = new Set<string>(),
    content = plan.content,
    previous = source?.content;
  const structure = record(content.structure),
    oldStructure = previous ? record(previous.structure) : {};
  for (const key of Object.keys(structure))
    if (!same(structure[key], oldStructure[key])) paths.add(`structure.${key}`);
  for (const key of ["media", "aliases", "details"]) {
    const next = record(content)[key],
      old = previous ? record(previous)[key] : undefined;
    if (!same(next, old)) paths.add(key);
  }
  for (const text of content.translations) {
    const old = previous?.translations.find(
        (row) => row.locale === text.locale,
      ),
      fields = record(text.fields),
      oldFields = old ? record(old.fields) : {};
    for (const key of new Set([
      ...Object.keys(fields),
      ...Object.keys(oldFields),
    ]))
      if (!same(fields[key], oldFields[key]))
        paths.add(`translations.${text.locale}.${key}`);
    for (const key of ["origin", "importBatchId"])
      if (!same(record(text)[key], old ? record(old)[key] : undefined))
        paths.add(`translations.${text.locale}.${key}`);
    const audit = plan.translationAudits.find(
        (row) => row.locale === text.locale,
      ),
      oldAudit = source?.translationAudits.find(
        (row) => row.locale === text.locale,
      );
    if (audit)
      for (const key of [
        "editorId",
        "editedAt",
        "translatedFromSourceHash",
        "review",
      ])
        if (
          !same(
            record(audit)[key],
            oldAudit ? record(oldAudit)[key] : undefined,
          )
        )
          paths.add(`translations.${text.locale}.${key}`);
  }
  if (content.kind === "IDOL" && content.aliases !== undefined)
    paths.add("aliases");
  if (content.kind === "GIFT" && content.details !== undefined)
    paths.add("details");
  return [...paths].sort();
}
