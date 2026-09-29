"use client";

import { useEffect, useReducer, useRef } from "react";
import type {
  IdolDirectoryResponse,
  IdolId,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { ArtistSearch } from "./artist-search";
import { ArtistTrack } from "./artist-track";
import {
  createDirectoryState,
  directoryAnchorHref,
  directoryContextQuery,
  directoryReducer,
} from "./directory-model";
import { requestArtistDirectory } from "./directory-request";
import styles from "./artist-directory.module.css";

export type ArtistDirectoryProps = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  initial: IdolDirectoryResponse;
  initialAnchor?: IdolId;
  contextQuery?: string;
  headingLevel?: 1 | 2;
  /** False when the homepage hero already carries the artist search. */
  search?: boolean;
}>;

export function ArtistDirectory(props: ArtistDirectoryProps) {
  const version =
    props.initial.outcome === "SUCCESS"
      ? props.initial.catalogVersion
      : props.initial.code;
  return (
    <Directory
      key={`${props.locale}:${props.initialAnchor ?? ""}:${version}`}
      {...props}
    />
  );
}

function Directory({
  locale,
  copy,
  initial,
  initialAnchor,
  contextQuery,
  headingLevel = 2,
  search = true,
}: ArtistDirectoryProps) {
  const Heading = headingLevel === 1 ? "h2" : "h3";
  const [state, dispatch] = useReducer(directoryReducer, undefined, () =>
    createDirectoryState(initial, initialAnchor),
  );
  const activeRequest = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      sequence.current += 1;
      activeRequest.current?.abort();
    },
    [],
  );

  const load = async (mode: "append" | "replace", anchor?: IdolId) => {
    if (
      mode === "append" &&
      (busy.current || !state.hasNextPage || state.endCursor === null)
    )
      return;
    activeRequest.current?.abort();
    const cancellation = new AbortController();
    activeRequest.current = cancellation;
    const request = ++sequence.current;
    busy.current = true;
    dispatch({
      type: "begin",
      request,
      mode,
      ...(anchor === undefined ? {} : { anchor }),
    });
    const response = await requestArtistDirectory(
      {
        schemaVersion: 1,
        locale,
        ...(mode === "append" && state.endCursor !== null
          ? { after: state.endCursor }
          : {}),
        ...(anchor === undefined ? {} : { anchorId: anchor }),
      },
      cancellation.signal,
    );
    if (request !== sequence.current || cancellation.signal.aborted) return;
    busy.current = false;
    dispatch({ type: "receive", request, response });
    if (
      response.outcome === "SUCCESS" &&
      mode === "replace" &&
      (anchor === undefined ||
        response.items.some((artist) => artist.id === anchor))
    )
      window.history.replaceState(
        window.history.state,
        "",
        directoryAnchorHref(window.location.href, anchor),
      );
  };
  const resetNeeded =
    state.error === "CATALOG_CHANGED" ||
    state.error === "INVALID_CURSOR" ||
    state.error === "INVALID_QUERY";
  let errorCopy = copy.artistLoadError;
  if (resetNeeded) errorCopy = copy.artistCatalogChanged;
  else if (state.error === "ANCHOR_NOT_FOUND")
    errorCopy = copy.artistAnchorMissing;

  let statusContent = null;
  if (state.loading) statusContent = <p>{copy.artistLoading}</p>;
  else if (state.error) {
    statusContent = (
      <>
        <p role="status">{errorCopy}</p>
        <Button
          variant="secondary"
          data-artist-retry={resetNeeded ? undefined : "true"}
          data-artist-reload={resetNeeded ? "true" : undefined}
          onClick={() => {
            void load(
              resetNeeded ? "replace" : state.mode,
              resetNeeded ? state.anchor : state.pendingAnchor,
            );
          }}
        >
          {resetNeeded ? copy.artistReload : copy.artistRetry}
        </Button>
      </>
    );
  } else if (state.items.length === 0) {
    statusContent = (
      <>
        <Heading>{copy.artistEmptyTitle}</Heading>
        <p>{copy.artistEmptyDescription}</p>
      </>
    );
  } else if (!state.hasNextPage) statusContent = <p>{copy.artistEnd}</p>;

  return (
    <div className={styles["directory"]} data-artist-directory="true">
      {search ? (
        <ArtistSearch
          locale={locale}
          copy={copy}
          onSelect={(artist) => {
            void load("replace", artist.id);
          }}
        />
      ) : null}
      {state.anchor !== undefined || state.error === "ANCHOR_NOT_FOUND" ? (
        <Button
          variant="quiet"
          data-artist-start="true"
          onClick={() => {
            void load("replace");
          }}
        >
          {copy.artistStart}
        </Button>
      ) : null}
      {state.items.length > 0 ? (
        <ArtistTrack
          locale={locale}
          copy={copy}
          state={state}
          headingLevel={headingLevel === 1 ? 2 : 3}
          contextQuery={directoryContextQuery(contextQuery ?? "", state.anchor)}
          onLoadMore={() => {
            void load("append");
          }}
        />
      ) : null}
      <div
        className={styles["status"]}
        data-artist-directory-status="true"
        data-error={state.error}
        data-loading={state.loading}
        aria-live="polite"
      >
        {statusContent}
      </div>
      {state.hasNextPage && !state.error ? (
        <div className={styles["more"]}>
          <Button
            variant="secondary"
            data-artist-load-more="true"
            disabled={state.loading}
            onClick={() => {
              void load("append");
            }}
          >
            {state.loading ? copy.artistLoading : copy.artistLoadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
