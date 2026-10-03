import "server-only";
import type { StorefrontContextResponse } from "@fan-support/contracts";
import { soleCommerceScope, type CommerceScope } from "./commerce-scope";
import { readCommerceContext } from "./storefront-page-reads";

/** The sole published market and currency, or none when the context is unavailable. */
export async function readSoleCommerceScope(
  context?: StorefrontContextResponse | Promise<StorefrontContextResponse>,
): Promise<CommerceScope | undefined> {
  try {
    const resolved = await (context ?? readCommerceContext());
    return resolved ? soleCommerceScope(resolved) : undefined;
  } catch {
    return undefined;
  }
}
