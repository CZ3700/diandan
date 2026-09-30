"use client";
import { useEffect, useState } from "react";
import type {
  AdminCatalogOwner,
  SupportedLocale,
  WishGiftSummary,
} from "@fan-support/contracts";
import { Button, Field } from "@fan-support/ui";
import type { ManagementApi } from "./api";
import type { ManagementCopy } from "./copy";
import { wishStatusLabel } from "./form-fields";

/** A bounded artist search inside the daily gift form; it never nests another form. */
export function WishArtistPicker({
  api,
  locale,
  copy,
  value,
  wish,
  onChange,
  error,
}: {
  api: Pick<ManagementApi, "wishArtists"> | undefined;
  locale: SupportedLocale;
  copy: ManagementCopy;
  value: string;
  wish: WishGiftSummary | undefined;
  onChange: (id: string) => void;
  error: string | undefined;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Awaited<
    ReturnType<ManagementApi["wishArtists"]>
  > | null>(null);
  const [chosen, setChosen] = useState<AdminCatalogOwner | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (wish || !api) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void api
      .wishArtists(locale, page, query)
      .then((next) => {
        if (active) setResult(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, locale, page, query, wish, attempt]);
  const name =
    chosen?.target.kind === "IDOL" && chosen.target.idolId === value
      ? (chosen.label ?? chosen.handle)
      : null;
  return (
    <fieldset
      className="mc-wish"
      data-management-wish={wish?.status ?? "NEW"}
      aria-describedby="management-wish-hint"
    >
      <legend>{copy.wishArtist}</legend>
      <p id="management-wish-hint" className="mc-hint">
        {copy.wishOnlyOnce}
      </p>
      {wish ? (
        <>
          <p className="mc-wish-recipient">{wish.artistName}</p>
          <p>{wishStatusLabel(wish.status, copy)}</p>
          <p className="mc-hint">{copy.wishArtistLocked}</p>
        </>
      ) : (
        <div data-management-wish-picker>
          {name ? (
            <div className="mc-wish-selected">
              <strong>{name}</strong>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  onChange("");
                  setChosen(null);
                }}
              >
                {copy.wishArtistChange}
              </Button>
            </div>
          ) : null}
          <div className="mc-wish-search">
            <Field
              id="management-wish-artist-search"
              label={copy.search}
              value={input}
              maxLength={160}
              error={error}
              autoComplete="off"
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  setPage(1);
                  setQuery(input.trim());
                  setAttempt((old) => old + 1);
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={loading || !api}
              onClick={() => {
                setPage(1);
                setQuery(input.trim());
                setAttempt((old) => old + 1);
              }}
            >
              {copy.search}
            </Button>
          </div>
          {!api || failed ? (
            <div role="alert">
              <p>{copy.loadFailed}</p>
              <Button
                type="button"
                variant="quiet"
                disabled={!api}
                onClick={() => setAttempt((old) => old + 1)}
              >
                {copy.retry}
              </Button>
            </div>
          ) : loading ? (
            <p role="status">{copy.processing}</p>
          ) : (
            <div className="mc-wish-results">
              {result?.items.map((artist) => {
                if (artist.target.kind !== "IDOL") return null;
                const id = artist.target.idolId;
                const eligible =
                  artist.status === "active" &&
                  artist.acceptingGifts === true &&
                  artist.publishedRevisionId !== null;
                return (
                  <button
                    key={id}
                    type="button"
                    className="mc-wish-choice"
                    aria-pressed={value === id}
                    disabled={!eligible}
                    data-management-wish-artist={id}
                    onClick={() => {
                      onChange(id);
                      setChosen(artist);
                    }}
                  >
                    <span>
                      {artist.label ?? artist.handle ?? copy.untitled}
                    </span>
                    <small>
                      {eligible
                        ? copy.wishArtistChoose
                        : copy.wishArtistUnavailable}
                    </small>
                  </button>
                );
              })}
              {result?.items.length === 0 ? <p>{copy.noResults}</p> : null}
            </div>
          )}
          <div className="mc-wish-pages">
            <Button
              type="button"
              variant="quiet"
              disabled={loading || page === 1}
              onClick={() => setPage((old) => old - 1)}
            >
              {copy.previous}
            </Button>
            <span>{new Intl.NumberFormat(locale).format(page)}</span>
            <Button
              type="button"
              variant="quiet"
              disabled={
                loading || failed || !result || page * 10 >= result.totalItems
              }
              onClick={() => setPage((old) => old + 1)}
            >
              {copy.next}
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
