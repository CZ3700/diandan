import { policyTranslationFieldsSchema } from "@fan-support/contracts";

export function PolicyBody({ body }: Readonly<{ body: string }>) {
  const safe = policyTranslationFieldsSchema.shape.body.parse(body);
  return (
    <div
      className="storefront-biography gift-policy-body"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
