import "server-only";
import {
  wishGalleryReadCommandSchema,
  wishGalleryReadResponseSchema,
  type WishGalleryReadResponse,
} from "@fan-support/contracts";
import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";
import {
  orderAbortable,
  readOrderBody,
} from "../storefront/order-transport-io";
const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "TEMPORARY_UNAVAILABLE",
} as const;

export async function fetchWishGallery(
  origin: string,
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<WishGalleryReadResponse> {
  const parsed = wishGalleryReadCommandSchema.safeParse(input);
  if (!parsed.success)
    return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_REQUEST" };
  const command = parsed.data;
  const query = new URLSearchParams({ locale: command.locale });
  if (command.idolId) query.set("idol", command.idolId);
  if (command.limit) query.set("limit", String(command.limit));
  if (command.cursor) query.set("cursor", command.cursor);
  try {
    const url = new URL("/api/v1/storefront/wish-gallery", origin);
    url.search = query.toString();
    const signal = AbortSignal.timeout(8_000);
    const response = await orderAbortable(
      fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal,
      }),
      signal,
    );
    if (
      response.headers.get("cache-control") !== "no-store" ||
      response.headers.has("set-cookie") ||
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      void response.body?.cancel().catch(() => {});
      return unavailable;
    }
    const result = wishGalleryReadResponseSchema.safeParse(
      JSON.parse(await readOrderBody(response.body, 2 * 1024 * 1024, signal)),
    );
    if (!result.success) return unavailable;
    if (result.data.outcome === "FAILURE") {
      const statuses = {
        INVALID_REQUEST: 400,
        ACCESS_DENIED: 403,
        RATE_LIMITED: 429,
        TEMPORARY_UNAVAILABLE: 503,
      };
      const expected = statuses[result.data.code];
      return response.status === expected ? result.data : unavailable;
    }
    const entries = result.data.page.entries;
    if (
      response.status !== 200 ||
      entries.length > (command.limit ?? 20) ||
      new Set(entries.map((entry) => entry.entryId.toLowerCase())).size !==
        entries.length
    )
      return unavailable;
    return result.data;
  } catch {
    return unavailable;
  }
}
export async function readWishGallery(
  input: unknown,
): Promise<WishGalleryReadResponse> {
  try {
    return await fetchWishGallery(
      resolveInternalApiRuntimeConfig({ environment: process.env }).origin,
      input,
    );
  } catch {
    return unavailable;
  }
}
