import {
  contentAuthoringChangesSchema,
  contentAuthoringResponseSchema,
  giftCommerceMutationSchema,
  type BaseContentText,
  type ContentAuthoringChanges,
  type SupportedLocale,
  type IdolAliasSet,
} from "@fan-support/contracts";
export function savedRevisionId(response: unknown): string {
  const commerce = giftCommerceMutationSchema.safeParse(response);
  if (commerce.success) {
    if (commerce.data.action !== "SAVE_GIFT_CONTENT")
      throw new Error("INVALID_RESPONSE");
    return commerce.data.giftRevisionId;
  }
  const content = contentAuthoringResponseSchema.parse(response);
  if (content.outcome !== "SUCCESS" || content.kind !== "MUTATION")
    throw new Error("INVALID_RESPONSE");
  return content.resultId;
}
export function reconcileVariantLabels(
  fields: Record<string, unknown>,
  variants: readonly { id: string }[],
): Record<string, unknown> {
  const labels = Array.isArray(fields["variantLabels"])
    ? (fields["variantLabels"] as { giftVariantId: string; label: string }[])
    : [];
  return {
    ...fields,
    variantLabels: variants.map(({ id }) => ({
      giftVariantId: id,
      label: labels.find((row) => row.giftVariantId === id)?.label ?? "",
    })),
  };
}
export function emptyFields(source: BaseContentText): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source.fields).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((row: Record<string, unknown>) => ({
            ...row,
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
  if (source.kind === "GIFT") {
    const labels = Array.isArray(selected?.["variantLabels"])
      ? (selected["variantLabels"] as {
          giftVariantId: string;
          label: string;
        }[])
      : [];
    return {
      subtitle: "",
      safetyNotice: "",
      ...fields,
      variantLabels: source.fields.variantLabels.map(({ giftVariantId }) => ({
        giftVariantId,
        label:
          labels.find((row) => row.giftVariantId === giftVariantId)?.label ??
          "",
      })),
    };
  }
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
