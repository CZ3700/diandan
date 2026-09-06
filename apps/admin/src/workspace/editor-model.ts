import {
  contentAuthoringChangesSchema,
  type BaseContentText,
  type ContentAuthoringChanges,
  type SupportedLocale,
  type IdolAliasSet,
} from "@fan-support/contracts";
export function emptyFields(source: BaseContentText): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source.fields).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((row: { slotKey: string }) => ({
            slotKey: row.slotKey,
            label: "",
          }))
        : "",
    ]),
  );
}
export function editableFields(
  source: BaseContentText,
  selected?: Record<string, unknown>,
): Record<string, unknown> {
  const fields = { ...emptyFields(source), ...selected };
  if (source.kind === "MEDIA_METADATA")
    return { title: "", caption: "", ...fields };
  if (source.kind !== "HOMEPAGE") return fields;
  const labels = Array.isArray(selected?.["slotLabels"])
    ? (selected["slotLabels"] as { slotKey: string; label: string }[])
    : [];
  return {
    announcement: "",
    ...fields,
    slotLabels: source.fields.slotLabels.map((slot) => ({
      slotKey: slot.slotKey,
      label: labels.find((row) => row.slotKey === slot.slotKey)?.label ?? "",
    })),
  };
}
export function translationChanges(
  kind: BaseContentText["kind"],
  locale: SupportedLocale,
  fields: Record<string, unknown>,
): ContentAuthoringChanges {
  return contentAuthoringChangesSchema.parse({
    kind,
    translations: [{ locale, origin: "HUMAN", fields }],
  });
}
export function replaceAliasLocale(
  aliases: IdolAliasSet["aliases"],
  locale: SupportedLocale,
  value: string,
): IdolAliasSet["aliases"] {
  const names = value
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean);
  return [
    ...aliases.filter((row) => row.locale !== locale),
    ...names.map(
      (text) =>
        aliases.find((row) => row.locale === locale && row.text === text) ?? {
          id: `alias-${crypto.randomUUID()}`,
          locale,
          text,
        },
    ),
  ];
}
