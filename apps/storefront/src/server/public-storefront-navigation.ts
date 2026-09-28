import "server-only";
import {
  publicStorefrontNavigationResponseSchema,
  type PublicStorefrontNavigationResponse,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";

const failure = (): PublicStorefrontNavigationResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
});

/** An optional appearance read must not hold up payment returns or order access. */
export async function fetchPublicStorefrontNavigation(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicStorefrontNavigationResponse> {
  try {
    const response = await fetcher(
      `${origin}/api/v1/storefront/storefront-navigation`,
      {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(1_000),
      },
    );
    const parsed = publicStorefrontNavigationResponseSchema.safeParse(
      await response.json(),
    );
    if (
      !parsed.success ||
      response.status !== (parsed.data.outcome === "SUCCESS" ? 200 : 503)
    )
      return failure();
    return parsed.data;
  } catch {
    return failure();
  }
}

export async function readPublicStorefrontNavigation(): Promise<PublicStorefrontNavigationResponse> {
  try {
    return await fetchPublicStorefrontNavigation(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
    );
  } catch {
    return failure();
  }
}
