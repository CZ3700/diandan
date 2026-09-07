"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  PublishedIdolView,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button, Field } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import { prepareArtistSearch } from "./directory-model";
import { requestArtistDirectory } from "./directory-request";
import styles from "./artist-directory.module.css";

type SearchState = Readonly<{
  status: "idle" | "loading" | "ready" | "error" | "invalid";
  items: readonly PublishedIdolView[];
  more: boolean;
}>;
const idle: SearchState = { status: "idle", items: [], more: false };

function searchStatusMessage(state: SearchState, copy: StorefrontCopy): string {
  switch (state.status) {
    case "loading":
      return copy.artistSearchLoading;
    case "error":
      return copy.artistSearchError;
    case "invalid":
      return copy.artistSearchInvalid;
    case "ready":
      return state.items.length === 0 ? copy.artistSearchEmpty : "";
    default:
      return "";
  }
}

export function ArtistSearch({
  locale,
  copy,
  onSelect,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  onSelect: (id: PublishedIdolView["id"]) => void;
}>) {
  const id = useId();
  const [raw, setRaw] = useState("");
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>(idle);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    sequence.current += 1;
    controller.current?.abort();
    setActive(-1);
    setState(idle);
  };

  useEffect(() => {
    const prepared = prepareArtistSearch(raw, composing);
    const requestId = ++sequence.current;
    controller.current?.abort();
    if (!open || prepared.kind === "idle") {
      setState(idle);
      return;
    }
    if (prepared.kind === "invalid") {
      setState({ ...idle, status: "invalid" });
      return;
    }
    const cancellation = new AbortController();
    controller.current = cancellation;
    setState({ ...idle, status: "loading" });
    const timer = window.setTimeout(() => {
      void requestArtistDirectory(
        { schemaVersion: 1, locale, limit: 6, q: prepared.q },
        cancellation.signal,
      ).then((response) => {
        if (requestId !== sequence.current || cancellation.signal.aborted)
          return;
        setState(
          response.outcome === "SUCCESS"
            ? {
                status: "ready",
                items: response.items,
                more: response.pageInfo.hasNextPage,
              }
            : { ...idle, status: "error" },
        );
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      cancellation.abort();
    };
  }, [locale, raw, composing, open, retry]);

  const close = () => {
    invalidate();
    setOpen(false);
  };
  const select = (artist: PublishedIdolView) => {
    close();
    setRaw(artist.displayName);
    onSelect(artist.id);
  };
  const resultId = (index: number) => `${id}-option-${index}`;
  const expanded = open && !composing && state.status !== "idle";
  const status = searchStatusMessage(state, copy);

  return (
    <div
      className={styles["search"]}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <Field
        ref={input}
        id={id}
        label={copy.artistSearchLabel}
        hint={copy.artistSearchHint}
        placeholder={copy.artistSearchPlaceholder}
        value={raw}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-results` : undefined}
        aria-activedescendant={
          expanded && active >= 0 ? resultId(active) : undefined
        }
        autoComplete="off"
        data-artist-search="true"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          invalidate();
          setRaw(event.currentTarget.value);
          setOpen(true);
        }}
        onCompositionStart={() => {
          invalidate();
          setComposing(true);
        }}
        onCompositionEnd={(event) => {
          invalidate();
          setRaw(event.currentTarget.value);
          setComposing(false);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (
            composing ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (state.items.length > 0)
              setActive((value) => {
                if (event.key === "ArrowDown")
                  return Math.min(state.items.length - 1, value + 1);
                if (value < 0) return state.items.length - 1;
                return Math.max(0, value - 1);
              });
          }
          if (
            event.key === "Enter" &&
            expanded &&
            active >= 0 &&
            state.items[active] !== undefined
          ) {
            event.preventDefault();
            select(state.items[active]);
          }
        }}
      />
      {expanded ? (
        <div className={styles["suggestions"]}>
          <ul
            id={`${id}-results`}
            role="listbox"
            aria-label={copy.artistSearchResults}
            data-artist-search-results="true"
          >
            {state.items.map((artist, index) => (
              <li role="presentation" key={artist.id}>
                <button
                  type="button"
                  id={resultId(index)}
                  role="option"
                  aria-selected={active === index}
                  tabIndex={-1}
                  data-artist-result={artist.id}
                  lang={artist.localeContext.resolvedLocale}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => select(artist)}
                  onPointerMove={() => setActive(index)}
                >
                  <span>{artist.displayName}</span>
                  <span className={styles["resultHandle"]}>
                    @{artist.handle}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {status ? <p role="status">{status}</p> : null}
          {state.more ? <p>{copy.artistSearchMore}</p> : null}
          {state.status === "error" ? (
            <Button
              variant="quiet"
              onClick={() => {
                invalidate();
                setRetry((value) => value + 1);
                input.current?.focus();
              }}
            >
              {copy.artistRetry}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
