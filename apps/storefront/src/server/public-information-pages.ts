import "server-only";
import { cache } from "react";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";
import {
  publicInformationPageResponseSchema,
  publicInformationPageIndexResponseSchema,
  type InformationPageKey,
  type SupportedLocale,
  type PublicInformationPageResponse,
  type PublicInformationPageIndexResponse,
} from "@fan-support/contracts";

const unavailable = () =>
  ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  }) as const;
const status = {
  NOT_FOUND: 404,
  CONTENT_UNAVAILABLE: 503,
  INVALID_COMMAND: 400,
} as const;
async function request(url: URL, fetcher: typeof fetch) {
  const response = await fetcher(url.href, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(1_500),
  });
  return { response, data: (await response.json()) as unknown };
}
export async function fetchPublicInformationPage(
  origin: string,
  pageKey: InformationPageKey,
  locale: SupportedLocale,
  fetcher: typeof fetch = fetch,
): Promise<PublicInformationPageResponse> {
  try {
    const url = new URL(
      `/api/v1/storefront/information-pages/${pageKey}`,
      origin,
    );
    url.searchParams.set("locale", locale);
    const { response, data } = await request(url, fetcher);
    const parsed = publicInformationPageResponseSchema.parse(data);
    if (
      response.status !==
      (parsed.outcome === "SUCCESS" ? 200 : status[parsed.code])
    )
      return unavailable();
    if (
      parsed.outcome === "SUCCESS" &&
      (parsed.document.pageKey !== pageKey || parsed.requestedLocale !== locale)
    )
      return unavailable();
    return parsed;
  } catch {
    return unavailable();
  }
}
export async function fetchPublicInformationPageIndex(
  origin: string,
  locale: SupportedLocale,
  fetcher: typeof fetch = fetch,
): Promise<PublicInformationPageIndexResponse> {
  try {
    const url = new URL("/api/v1/storefront/information-pages", origin);
    url.searchParams.set("locale", locale);
    const { response, data } = await request(url, fetcher);
    const parsed = publicInformationPageIndexResponseSchema.parse(data);
    if (
      response.status !==
        (parsed.outcome === "SUCCESS" ? 200 : status[parsed.code]) ||
      (parsed.outcome === "SUCCESS" && parsed.locale !== locale)
    )
      return unavailable();
    return parsed;
  } catch {
    return unavailable();
  }
}
export const readPublicInformationPage = cache(
  async (
    pageKey: InformationPageKey,
    locale: SupportedLocale,
  ): Promise<PublicInformationPageResponse> => {
    try {
      return await fetchPublicInformationPage(
        resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
        pageKey,
        locale,
      );
    } catch {
      return unavailable();
    }
  },
);
export const readPublicInformationPageIndex = cache(
  async (
    locale: SupportedLocale,
  ): Promise<PublicInformationPageIndexResponse> => {
    try {
      return await fetchPublicInformationPageIndex(
        resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
        locale,
      );
    } catch {
      return unavailable();
    }
  },
);
