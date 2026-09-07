import "server-only";
import { cache } from "react";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";
import {
  storefrontSeoReadCommandSchema,
  storefrontSeoResponseSchema,
  storefrontSeoCursorPayloadSchema,
  type StorefrontSeoReadCommand,
  type StorefrontSeoResponse,
  type StorefrontSeoLocator,
} from "@fan-support/contracts";

const unavailable = (): StorefrontSeoResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
});
const statuses = {
  INVALID_QUERY: 400,
  INVALID_CURSOR: 400,
  NOT_FOUND: 404,
  CATALOG_CHANGED: 409,
  CONTENT_UNAVAILABLE: 503,
} as const;
export async function fetchStorefrontSeo(
  origin: string,
  input: StorefrontSeoReadCommand,
  fetcher: typeof fetch = fetch,
): Promise<StorefrontSeoResponse> {
  try {
    const command = storefrontSeoReadCommandSchema.parse(input);
    const url = new URL(
      `/api/v1/storefront-seo/${command.operation.toLowerCase()}`,
      origin,
    );
    if (command.operation === "ENTITY") {
      for (const [key, value] of Object.entries(command.locator))
        url.searchParams.set(key, value);
    } else if (command.cursor) url.searchParams.set("cursor", command.cursor);
    const response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status >= 300 && response.status < 400) return unavailable();
    const result = storefrontSeoResponseSchema.parse(await response.json());
    if (result.outcome === "FAILURE")
      return response.status === statuses[result.code] ? result : unavailable();
    if (
      response.status !== 200 ||
      result.kind !== `STOREFRONT_SEO_${command.operation}`
    )
      return unavailable();
    if (
      command.operation === "ENTITY" &&
      result.kind === "STOREFRONT_SEO_ENTITY" &&
      JSON.stringify(result.entity.locator) !== JSON.stringify(command.locator)
    )
      return unavailable();
    if (result.kind !== "STOREFRONT_SEO_ENTITY") {
      const rows =
        result.kind === "STOREFRONT_SEO_CATALOG" ? result.shards : result.items;
      if (result.pageInfo.hasNextPage && rows.length === 0)
        return unavailable();
      if (command.operation !== "ENTITY" && command.cursor) {
        const payload = storefrontSeoCursorPayloadSchema.parse(
          JSON.parse(Buffer.from(command.cursor, "base64url").toString("utf8")),
        );
        if (
          payload.operation !== command.operation ||
          payload.catalogVersion !== result.catalogVersion ||
          Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") !==
            command.cursor
        )
          return unavailable();
      }
    }
    return result;
  } catch {
    return unavailable();
  }
}
export async function readStorefrontSeo(
  command: StorefrontSeoReadCommand,
): Promise<StorefrontSeoResponse> {
  try {
    return await fetchStorefrontSeo(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
      command,
    );
  } catch {
    return unavailable();
  }
}
const readEntity = cache(async (locatorJson: string) => {
  const response = await readStorefrontSeo({
    schemaVersion: 1,
    operation: "ENTITY",
    locator: JSON.parse(locatorJson) as StorefrontSeoLocator,
  });
  return response.outcome === "SUCCESS" &&
    response.kind === "STOREFRONT_SEO_ENTITY"
    ? response.entity
    : undefined;
});
export function readSeoEntity(locator: StorefrontSeoLocator) {
  return readEntity(JSON.stringify(locator));
}
