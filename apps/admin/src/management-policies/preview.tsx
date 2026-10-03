import {
  policyTranslationFieldsSchema,
  type PolicyTranslationFields,
  type SupportedLocale,
} from "@fan-support/contracts";

export function PolicyPreview({
  locale,
  invalidLabel,
  ...fields
}: PolicyTranslationFields & {
  locale: SupportedLocale;
  invalidLabel: string;
}) {
  const parsed = policyTranslationFieldsSchema.safeParse(fields);
  if (!parsed.success) return <p role="status">{invalidLabel}</p>;
  return (
    <article className="policy-preview" lang={locale} data-policy-preview>
      <h3>{parsed.data.title}</h3>
      <p>{parsed.data.summary}</p>
      {/* Shared policy schema permits only balanced, attribute-free policy formatting. */}
      <div dangerouslySetInnerHTML={{ __html: parsed.data.body }} />
    </article>
  );
}
