"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import type {
  IdolDirectoryResponse,
  PublishedIdolView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { Drawer } from "@fan-support/ui/interactions";
import type { StorefrontCopy } from "./copy";
import { ArtistSearch } from "./artist-search";
import { PublishedImage } from "./published-image";
import { requestArtistDirectory } from "./directory-request";
import { giftSelectionHref } from "./gift-selection-values";
import { createDirectoryState, directoryReducer } from "./directory-model";

export function GiftRecipientPicker({
  locale,
  copy,
  contextQuery,
  path,
  initial,
  selected = false,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  path: string;
  initial: IdolDirectoryResponse;
  selected?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(
    directoryReducer,
    initial,
    createDirectoryState,
  );
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => active.current?.abort(), []);
  const resetNeeded =
    state.error === "CATALOG_CHANGED" ||
    state.error === "INVALID_CURSOR" ||
    state.error === "INVALID_QUERY";
  const select = (id: PublishedIdolView["id"]) => {
    window.location.assign(
      giftSelectionHref(locale, path, contextQuery, { idol: id }),
    );
  };
  async function more() {
    if (busy.current) return;
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    busy.current = true;
    const request = ++sequence.current;
    const mode = resetNeeded || state.endCursor === null ? "replace" : "append";
    dispatch({ type: "begin", request, mode });
    const result = await requestArtistDirectory(
      {
        schemaVersion: 1,
        locale,
        limit: 12,
        ...(mode === "append" && state.endCursor !== null
          ? { after: state.endCursor }
          : {}),
      },
      controller.signal,
    );
    if (controller.signal.aborted || request !== sequence.current) return;
    busy.current = false;
    dispatch({ type: "receive", request, response: result });
  }
  return (
    <div data-gift-recipient-picker>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={copy.giftRecipientChoose}
        description={copy.giftRecipientMissing}
        closeLabel={copy.close}
        triggerLabel={
          selected ? copy.giftRecipientChange : copy.giftRecipientChoose
        }
      >
        <ArtistSearch
          acceptingOnly
          locale={locale}
          copy={copy}
          onSelect={select}
        />
        <div className="gift-recipient-options">
          {state.items.map((artist) => (
            <button
              type="button"
              key={artist.id}
              disabled={!artist.acceptingGifts}
              data-recipient-option={artist.id}
              onClick={() => select(artist.id)}
            >
              <PublishedImage
                media={artist.portrait}
                fallbackLabel={copy.mediaFallback}
                sizes="64px"
              />
              <span lang={artist.localeContext.resolvedLocale}>
                {artist.displayName}
              </span>
              {!artist.acceptingGifts && <small>{copy.artistPaused}</small>}
            </button>
          ))}
        </div>
        {state.error && (
          <p role="status">
            {resetNeeded ? copy.artistCatalogChanged : copy.artistLoadError}
          </p>
        )}
        {!state.error && state.items.length === 0 && (
          <p>{copy.artistSearchEmpty}</p>
        )}
        {(state.error || state.hasNextPage) && (
          <Button
            disabled={state.loading}
            onClick={() => {
              void more();
            }}
          >
            {state.loading
              ? copy.artistLoading
              : resetNeeded
                ? copy.artistReload
                : state.error
                  ? copy.artistRetry
                  : copy.artistLoadMore}
          </Button>
        )}
      </Drawer>
    </div>
  );
}
