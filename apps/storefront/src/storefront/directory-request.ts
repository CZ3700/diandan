import type {
  IdolDirectoryResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import type { ArtistDirectoryQuery } from "./directory-validation";
export type { ArtistDirectoryQuery } from "./directory-validation";

function unavailable(): IdolDirectoryResponse {
  return { schemaVersion: 1, outcome: "FAILURE", code: "CATALOG_UNAVAILABLE" };
}

export async function requestArtistDirectory(
  query: ArtistDirectoryQuery,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<IdolDirectoryResponse> {
  try {
    if (signal.aborted) return unavailable();
    const validation = await import("./directory-validation");
    if (signal.aborted) return unavailable();
    const response = await validation.requestArtistDirectory(
      query,
      signal,
      request,
    );
    return signal.aborted ? unavailable() : response;
  } catch {
    return unavailable();
  }
}

export async function requestArtistSearch(
  raw: string,
  locale: SupportedLocale,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "response"; response: IdolDirectoryResponse }>
> {
  try {
    if (signal.aborted) return { kind: "response", response: unavailable() };
    const validation = await import("./directory-validation");
    if (signal.aborted) return { kind: "response", response: unavailable() };
    const prepared = validation.prepareArtistSearch(raw, false);
    if (prepared.kind !== "query") return { kind: "invalid" };
    const response = await validation.requestArtistDirectory(
      { schemaVersion: 1, locale, limit: 6, q: prepared.q },
      signal,
      request,
    );
    return {
      kind: "response",
      response: signal.aborted ? unavailable() : response,
    };
  } catch {
    return { kind: "response", response: unavailable() };
  }
}
