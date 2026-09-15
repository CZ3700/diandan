import {
  orderAccessRawTokenSchema,
  publicOrderIdSchema,
} from "@fan-support/contracts";
/** Called only after the early entry script has removed the fragment from browser history. */
export function parseOrderFragment(
  fragment: string | null,
): { token: string; publicOrderId: string } | null {
  if (!fragment || fragment.length > 256 || !fragment.startsWith("#"))
    return null;
  const params = new URLSearchParams(fragment.slice(1));
  if (
    [...params.keys()].length !== 2 ||
    params.getAll("token").length !== 1 ||
    params.getAll("order").length !== 1
  )
    return null;
  const token = orderAccessRawTokenSchema.safeParse(params.get("token"));
  const id = publicOrderIdSchema.safeParse(params.get("order"));
  return token.success && id.success
    ? { token: token.data, publicOrderId: id.data }
    : null;
}
