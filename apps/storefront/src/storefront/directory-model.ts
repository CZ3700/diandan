import {
  artistSearchTermSchema,
  type CatalogDirectoryFailure,
  type IdolDirectoryResponse,
  type PublishedIdolView,
} from "@fan-support/contracts";

export type DirectoryState = Readonly<{
  items: readonly PublishedIdolView[];
  catalogVersion?: string;
  hasNextPage: boolean;
  endCursor: string | null;
  anchor?: string | undefined;
  request: number;
  loading: boolean;
  mode: "append" | "replace";
  pendingAnchor?: string | undefined;
  error?: CatalogDirectoryFailure["code"] | undefined;
}>;

export type DirectoryAction =
  | Readonly<{
      type: "begin";
      request: number;
      mode: "append" | "replace";
      anchor?: string;
    }>
  | Readonly<{
      type: "receive";
      request: number;
      response: IdolDirectoryResponse;
    }>;

export function createDirectoryState(
  response: IdolDirectoryResponse,
  anchor?: string,
): DirectoryState {
  const initial: DirectoryState = {
    items: [],
    hasNextPage: false,
    endCursor: null,
    request: 0,
    loading: true,
    mode: "replace",
    ...(anchor === undefined ? {} : { pendingAnchor: anchor }),
  };
  return directoryReducer(initial, { type: "receive", request: 0, response });
}

export function directoryReducer(
  state: DirectoryState,
  action: DirectoryAction,
): DirectoryState {
  if (action.type === "begin") {
    return {
      ...state,
      request: action.request,
      mode: action.mode,
      loading: true,
      error: undefined,
      pendingAnchor: action.anchor,
    };
  }
  if (action.request !== state.request) return state;
  const result = action.response;
  const fail = (error: CatalogDirectoryFailure["code"]): DirectoryState => ({
    ...state,
    loading: false,
    error,
  });
  if (result.outcome === "FAILURE") return fail(result.code);
  if (state.mode === "append" && result.catalogVersion !== state.catalogVersion)
    return fail("CATALOG_CHANGED");
  if (
    state.mode === "replace" &&
    state.pendingAnchor !== undefined &&
    !result.items.some((item) => item.id === state.pendingAnchor)
  )
    return fail("ANCHOR_NOT_FOUND");
  const items =
    state.mode === "append" ? [...state.items, ...result.items] : result.items;
  if (new Set(items.map((item) => item.id.toLowerCase())).size !== items.length)
    return fail("CATALOG_UNAVAILABLE");
  return {
    ...state,
    items,
    catalogVersion: result.catalogVersion,
    hasNextPage: result.pageInfo.hasNextPage,
    endCursor: result.pageInfo.endCursor,
    loading: false,
    error: undefined,
    anchor: state.mode === "replace" ? state.pendingAnchor : state.anchor,
  };
}

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

/** Location is public navigation context; unrelated commerce query and fragment survive. */
export function directoryAnchorHref(
  currentUrl: string,
  anchor: string | undefined,
): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("q");
  url.searchParams.delete("after");
  if (anchor === undefined) url.searchParams.delete("anchorId");
  else url.searchParams.set("anchorId", anchor);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function canSelectSearchArtist(
  artist: Pick<PublishedIdolView, "status" | "acceptingGifts">,
  acceptingOnly: boolean,
): boolean {
  return (
    !acceptingOnly || (artist.status === "active" && artist.acceptingGifts)
  );
}
