import {
  idolTranslationFieldsSchema,
  type ContentLocaleContext,
} from "@fan-support/contracts";
/** The shared schema accepts balanced attribute-free paragraph/list/emphasis tags only. */
export function ControlledBiography({
  text,
  plain = false,
}: Readonly<{ text: string; plain?: boolean }>) {
  if (plain)
    return (
      <div className="storefront-biography">
        <p>{text}</p>
      </div>
    );
  const value = idolTranslationFieldsSchema.shape.fullBio.parse(text);
  return (
    <div
      className="storefront-biography"
      dangerouslySetInnerHTML={{ __html: value }}
    />
  );
}
export function hasFallback(
  contexts: readonly ContentLocaleContext[],
): boolean {
  return contexts.some((context) => context.fallbackUsed);
}
