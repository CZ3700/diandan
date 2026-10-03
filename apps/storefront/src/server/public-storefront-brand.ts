import "server-only";
import {
  publicStorefrontBrandResponseSchema,
  type PublicStorefrontBrandResponse,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";
import {
  orderAbortable,
  readOrderBody,
} from "../storefront/order-transport-io";

const unavailable = (): PublicStorefrontBrandResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
});

/** Branding is optional: neither transport nor response streaming may hold up checkout. */
export async function fetchPublicStorefrontBrand(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicStorefrontBrandResponse> {
  try {
    const signal = AbortSignal.timeout(1_000);
    const response = await orderAbortable(
      fetcher(`${origin}/api/v1/storefront/storefront-brand`, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal,
      }),
      signal,
    );
    if (
      response.headers.has("set-cookie") ||
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      void response.body?.cancel().catch(() => {});
      return unavailable();
    }
    const parsed = publicStorefrontBrandResponseSchema.safeParse(
      JSON.parse(await readOrderBody(response.body, 64 * 1024, signal)),
    );
    if (
      !parsed.success ||
      response.status !== (parsed.data.outcome === "SUCCESS" ? 200 : 503)
    )
      return unavailable();
    return parsed.data;
  } catch {
    return unavailable();
  }
}

export async function readPublicStorefrontBrand(): Promise<PublicStorefrontBrandResponse> {
  try {
    return await fetchPublicStorefrontBrand(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
    );
  } catch {
    return unavailable();
  }
}
