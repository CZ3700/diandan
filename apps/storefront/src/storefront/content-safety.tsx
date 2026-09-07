import {
  idolTranslationFieldsSchema,
  type LocaleContext,
} from "@fan-support/contracts";
/** The shared schema accepts balanced attribute-free paragraph/list/emphasis tags only. */
export function ControlledBiography({ text }: Readonly<{ text: string }>) {
  const value = idolTranslationFieldsSchema.shape.fullBio.parse(text);
  return (
    <div
      className="storefront-biography"
      dangerouslySetInnerHTML={{ __html: value }}
    />
  );
}
export function hasFallback(contexts: readonly LocaleContext[]): boolean {
  return contexts.some((context) => context.fallbackUsed);
}
