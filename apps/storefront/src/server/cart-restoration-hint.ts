import "server-only";
import { cookies } from "next/headers";
import { CART_COOKIE_NAME } from "./cart-cookie-name";

/** Presence only permits restoration; the private BFF still validates the cookie. */
export async function readCartRestorationHint(): Promise<boolean> {
  return (await cookies()).has(CART_COOKIE_NAME);
}
