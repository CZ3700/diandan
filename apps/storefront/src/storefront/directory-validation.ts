import {
  artistSearchTermSchema,
  idolDirectoryResponseSchema,
  idolDiscoveryQuerySchema,
  type IdolDirectoryResponse,
  type IdolDiscoveryQuery,
} from "@fan-support/contracts";

/** The original query schema supplies its canonical default window after loading. */
export type ArtistDirectoryQuery = Omit<IdolDiscoveryQuery, "limit"> &
  Readonly<{ limit?: number }>;

export function prepareArtistSearch(
  raw: string,
  composing: boolean,
):
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "query"; q: string }> {
  if (composing || raw.trim().length === 0) return { kind: "idle" };
  const query = artistSearchTermSchema.safeParse(raw.trim());
  return query.success ? { kind: "query", q: query.data } : { kind: "invalid" };
}

export async function requestArtistDirectory(
  query: ArtistDirectoryQuery,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<IdolDirectoryResponse> {
  const parsed = idolDiscoveryQuerySchema.safeParse(query);
  if (!parsed.success)
    return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" };
  const params = new URLSearchParams({
    locale: parsed.data.locale,
    limit: String(parsed.data.limit),
  });
  if (parsed.data.q !== undefined) params.set("q", parsed.data.q);
  if (parsed.data.after !== undefined) params.set("after", parsed.data.after);
  if (parsed.data.anchorId !== undefined)
    params.set("anchorId", parsed.data.anchorId);
  try {
    const response = await request(
      `/api/storefront/idols?${params.toString()}`,
      { cache: "no-store", credentials: "same-origin", signal },
    );
    const result = idolDirectoryResponseSchema.parse(await response.json());
    if (result.outcome === "FAILURE") return result;
    if (
      !response.ok ||
      result.items.length > parsed.data.limit ||
      (result.pageInfo.hasNextPage &&
        result.items.length !== parsed.data.limit) ||
      result.items.some(
        (item) =>
          item.localeContext.requestedLocale !== parsed.data.locale ||
          item.localeContext.resolvedLocale !== parsed.data.locale ||
          item.localeContext.fallbackUsed,
      )
    )
      throw new Error("Invalid directory response");
    return result;
  } catch {
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_UNAVAILABLE",
    };
  }
}
