import {
  cartRuntimeCurrentResponseSchema,
  cartEditResponseSchema,
  cartEditorResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";

/** Loaded with cart interaction; the ordinary path cannot accept private editor content. */
export function validateCartReply(
  value: unknown,
  kind: "cart" | "edit" | "editor",
  locale: SupportedLocale,
) {
  const parsed =
    kind === "editor"
      ? cartEditorResponseSchema.parse(value)
      : kind === "edit"
        ? cartEditResponseSchema.parse(value)
        : cartRuntimeCurrentResponseSchema.parse(value);
  if (
    parsed.outcome === "SUCCESS" &&
    "cart" in parsed &&
    parsed.cart.presentationLocale !== locale
  )
    throw new Error("CART_LOCALE_MISMATCH");
  return parsed;
}
