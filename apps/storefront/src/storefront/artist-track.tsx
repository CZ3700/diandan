"use client";

import { useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button, Icon } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";
import type { DirectoryState } from "./directory-model";
import { PublishedImage } from "./published-image";
import { storefrontHref } from "./navigation";
import styles from "./artist-directory.module.css";

export function ArtistTrack({
  locale,
  copy,
  state,
  contextQuery,
  headingLevel,
  onLoadMore,
}: Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  state: DirectoryState;
  contextQuery?: string;
  headingLevel: 2 | 3;
  onLoadMore: () => void;
}>) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const track = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const focusedRequest = useRef(-1);

  useEffect(() => {
    if (
      state.loading ||
      state.error ||
      state.anchor === undefined ||
      state.mode !== "replace" ||
      focusedRequest.current === state.request
    )
      return;
    const link = track.current?.querySelector<HTMLAnchorElement>(
      `[data-artist-link="${state.anchor}"]`,
    );
    if (link === undefined || link === null) return;
    focusedRequest.current = state.request;
    link.focus({ preventScroll: true });
    link.scrollIntoView({
      block: "nearest",
      inline: "start",
      behavior: "auto",
    });
  }, [state.anchor, state.loading, state.error, state.mode, state.request]);

  const move = (direction: number) => {
    const element = track.current;
    if (element === null) return;
    element.scrollBy({
      left: direction * Math.max(element.clientWidth * 0.8, 1),
      behavior: "auto",
    });
    if (
      direction > 0 &&
      atEnd &&
      state.hasNextPage &&
      !state.loading &&
      !state.error
    )
      onLoadMore();
  };

  return (
    <div className={styles["trackFrame"]}>
      <div className={styles["trackControls"]}>
        <Button
          variant="quiet"
          aria-label={copy.artistPrevious}
          disabled={atStart}
          data-artist-previous="true"
          onClick={() => move(-1)}
        >
          <Icon name="arrow-left" decorative />
        </Button>
        <Button
          variant="quiet"
          aria-label={copy.artistNext}
          disabled={atEnd && !state.hasNextPage}
          data-artist-next="true"
          onClick={() => move(1)}
        >
          <Icon name="arrow-right" decorative />
        </Button>
      </div>
      <ul
        ref={track}
        className={styles["track"]}
        aria-label={copy.artistTrackLabel}
        data-artist-track="true"
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          const remaining =
            element.scrollWidth - element.clientWidth - element.scrollLeft;
          setAtStart(element.scrollLeft <= 2);
          setAtEnd(remaining <= 2);
          if (
            remaining < element.clientWidth * 0.7 &&
            state.hasNextPage &&
            !state.loading &&
            !state.error
          )
            onLoadMore();
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          const links = [
            ...event.currentTarget.querySelectorAll<HTMLAnchorElement>(
              "[data-artist-link]",
            ),
          ];
          const index = links.indexOf(event.target as HTMLAnchorElement);
          if (index < 0 && event.target !== event.currentTarget) return;
          event.preventDefault();
          let next: number;
          if (event.key === "Home") next = 0;
          else if (event.key === "End") next = links.length - 1;
          else {
            const step = event.key === "ArrowRight" ? 1 : -1;
            next = Math.min(links.length - 1, Math.max(0, index + step));
          }
          links[next]?.focus({ preventScroll: true });
          links[next]?.scrollIntoView({
            block: "nearest",
            inline: "center",
            behavior: "auto",
          });
          if (
            event.key === "ArrowRight" &&
            next === links.length - 1 &&
            state.hasNextPage &&
            !state.loading &&
            !state.error
          )
            onLoadMore();
        }}
      >
        {state.items.map((artist) => (
          <li
            className={styles["card"]}
            key={artist.id}
            data-artist-card={artist.id}
            data-accepting={artist.acceptingGifts}
            lang={artist.localeContext.resolvedLocale}
          >
            <a
              href={storefrontHref(
                locale,
                `/idols/${artist.handle}`,
                contextQuery,
              )}
              data-artist-link={artist.id}
              aria-current={state.anchor === artist.id ? "true" : undefined}
            >
              <figure>
                <div className={styles["portrait"]}>
                  <PublishedImage
                    media={artist.portrait}
                    fallbackLabel={copy.mediaFallback}
                  />
                </div>
                <figcaption>
                  <Heading>{artist.displayName}</Heading>
                  <p className={styles["availability"]}>
                    {artist.acceptingGifts
                      ? copy.artistAccepting
                      : copy.artistPaused}
                  </p>
                  {state.anchor === artist.id ? (
                    <span className={styles["selected"]}>
                      <Icon name="check" decorative />
                      {copy.artistSelected}
                    </span>
                  ) : null}
                </figcaption>
              </figure>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
