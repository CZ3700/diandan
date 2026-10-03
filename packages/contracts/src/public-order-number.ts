import { publicOrderNoSchema, type PublicOrderNo } from "./identifiers.js";

/** Crockford base32: no I, L, O or U. The database generator uses the same 32 symbols. */
export const PUBLIC_ORDER_NO_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const readAlike: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" };

/**
 * Reads a public order number the way a fan types it or an operator hears it: case, spaces and
 * hyphens do not matter, the FS prefix is optional and O/I/L decode as 0/1. Six characters are
 * always the bare code. Returns null for anything that is not exactly one number.
 */
export function normalizePublicOrderNo(input: string): PublicOrderNo | null {
  if (input.length > 64) return null;
  let code = input.replace(/[\s-]/gu, "").toUpperCase();
  if (code.length === 8 && code.startsWith("FS")) code = code.slice(2);
  if (code.length !== 6) return null;
  code = [...code]
    .map((character) => readAlike[character] ?? character)
    .join("");
  const parsed = publicOrderNoSchema.safeParse(`FS-${code}`);
  return parsed.success ? parsed.data : null;
}
