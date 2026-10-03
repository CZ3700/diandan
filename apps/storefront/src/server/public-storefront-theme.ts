import "server-only";
import {
  publicStorefrontThemeResponseSchema,
  type PublicStorefrontThemeResponse,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";

const failure = (): PublicStorefrontThemeResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
});

/** An optional appearance read must not hold up payment returns or order access. */
export async function fetchPublicStorefrontTheme(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicStorefrontThemeResponse> {
  try {
    const response = await fetcher(
      `${origin}/api/v1/storefront/storefront-theme`,
      {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(1_000),
      },
    );
    const parsed = publicStorefrontThemeResponseSchema.safeParse(
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

export async function readPublicStorefrontTheme(): Promise<PublicStorefrontThemeResponse> {
  try {
    return await fetchPublicStorefrontTheme(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
    );
  } catch {
    return failure();
  }
}
