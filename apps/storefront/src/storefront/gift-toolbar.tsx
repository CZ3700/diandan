"use client";

import { use } from "react";
import { Icon } from "@fan-support/ui";
import { GiftNavigationPending } from "./gift-navigation-context";

export type GiftToolbarChoice = Readonly<{
  id: string;
  label: string;
  href: string;
  current: boolean;
}>;
export type GiftToolbarSort = Readonly<{
  /** Names the group for assistive technology, e.g. "Sort by". */
  heading: string;
  /** The visible word next to the two arrows, e.g. "Price". */
  label: string;
  options: ReadonlyArray<
    GiftToolbarChoice & Readonly<{ icon: "sort-ascending" | "sort-descending" }>
  >;
}>;

/**
 * User request 2026-09-30 (L2-17): one row of gift kinds and a price order, no category
 * and no "apply" step. Each choice is a link; the active price order links back to the
 * recommended order. A choice still loading is already shown as selected.
 */
export function GiftToolbar({
  kindsLabel,
  kinds,
  count,
  sort,
}: Readonly<{
  kindsLabel: string;
  kinds: ReadonlyArray<GiftToolbarChoice>;
  count: string;
  sort?: GiftToolbarSort | undefined;
}>) {
  const pending = use(GiftNavigationPending);
  const chosen = (group: "kind" | "sort") =>
    pending?.startsWith(`${group}:`)
      ? pending.slice(group.length + 1)
      : undefined;
  const kind = chosen("kind");
  const order = chosen("sort");
  return (
    <div className="gift-toolbar" data-gift-toolbar>
      <nav className="gift-toolbar__kinds" aria-label={kindsLabel}>
        <ul>
          {kinds.map((choice) => (
            <li key={choice.id}>
              <a
                className="gift-kind-chip"
                href={choice.href}
                data-gift-nav={`kind:${choice.id}`}
                data-gift-kind-option={choice.id}
                aria-current={
                  (kind === undefined ? choice.current : kind === choice.id)
                    ? "true"
                    : undefined
                }
              >
                {choice.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="gift-directory-count" aria-live="polite">
        {count}
      </p>
      {sort && (
        <div
          className="gift-sort"
          role="group"
          aria-label={sort.heading}
          data-gift-sort
        >
          <span className="gift-sort__label" aria-hidden="true">
            {sort.label}
          </span>
          {sort.options.map((option) => (
            <a
              key={option.id}
              className="gift-sort__option"
              href={option.href}
              data-gift-nav={`sort:${option.current ? "RECOMMENDED" : option.id}`}
              data-gift-sort-option={option.id}
              aria-label={option.label}
              title={option.label}
              aria-current={
                (order === undefined ? option.current : order === option.id)
                  ? "true"
                  : undefined
              }
            >
              <Icon decorative name={option.icon} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
