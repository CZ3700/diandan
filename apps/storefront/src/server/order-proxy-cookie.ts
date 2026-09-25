import {
  orderAccessRawTokenSchema,
  type OrderAccessResponse,
} from "@fan-support/contracts";

/** No Domain, duplicate attributes, extra cookies, alternate scope, or expiry rewriting. */
export function validatedOrderCookie(
  headers: Headers,
  result: OrderAccessResponse,
): string | undefined {
  const cookies = headers.getSetCookie();
  const expectsCookie =
    result.outcome === "SUCCESS" &&
    (result.action === "GRANTED" || result.action === "REVOKED");
  if (!expectsCookie) {
    if (cookies.length !== 0) throw new Error("Unexpected order cookie");
    return undefined;
  }
  if (cookies.length !== 1)
    throw new Error("Missing or ambiguous order cookie");
  const cookie = cookies[0]!;
  const [pair, ...parts] = cookie.split(";").map((part) => part.trim());
  if (!pair?.startsWith("__Host-fan-order=") || parts.length !== 5)
    throw new Error("Invalid order cookie");
  const attributes = new Map<string, string>();
  for (const part of parts) {
    const offset = part.indexOf("=");
    const key = (offset < 0 ? part : part.slice(0, offset)).toLowerCase();
    if (attributes.has(key))
      throw new Error("Duplicate order cookie attribute");
    attributes.set(key, offset < 0 ? "" : part.slice(offset + 1));
  }
  if (
    attributes.get("path") !== "/" ||
    attributes.get("httponly") !== "" ||
    attributes.get("secure") !== "" ||
    attributes.get("samesite")?.toLowerCase() !== "strict"
  )
    throw new Error("Invalid order cookie scope");
  const token = pair.slice("__Host-fan-order=".length);
  if (result.action === "GRANTED") {
    orderAccessRawTokenSchema.parse(token);
    if (
      attributes.get("expires") !==
      new Date(result.grant.expiresAt).toUTCString()
    )
      throw new Error("Invalid order cookie expiry");
  } else if (token !== "" || attributes.get("max-age") !== "0")
    throw new Error("Invalid order cookie revocation");
  return cookie;
}
