import "server-only";
import {
  publicHomeLayoutResponseSchema,
  type PublicHomeLayoutResponse,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";

const failure = (): PublicHomeLayoutResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
});

/** Absence is an explicit API response; an unavailable API is never a default layout. */
export async function fetchPublicHomeLayout(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicHomeLayoutResponse> {
  try {
    const response = await fetcher(`${origin}/api/v1/storefront/home-layout`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const value = publicHomeLayoutResponseSchema.safeParse(
      await response.json(),
    );
    if (
      !value.success ||
      response.status !== (value.data.outcome === "SUCCESS" ? 200 : 503)
    )
      return failure();
    return value.data;
  } catch {
    return failure();
  }
}

export async function readPublicHomeLayout(): Promise<PublicHomeLayoutResponse> {
  try {
    return await fetchPublicHomeLayout(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
    );
  } catch {
    return failure();
  }
}
