"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  minorAmountSchema,
  type GiftDiscoveryQuery,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button, Field } from "@fan-support/ui";
import { Drawer } from "@fan-support/ui/interactions";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import {
  formatGiftPriceInput,
  giftFilterHref,
  giftResetHref,
  parseGiftPriceInput,
} from "./gift-query";

type FilterProps = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  query: GiftDiscoveryQuery;
  contextQuery: string;
  basePath: string;
}>;

function draftFor(query: GiftDiscoveryQuery, locale: SupportedLocale) {
  return {
    sort: query.sort,
    category: query.category ?? "",
    availability: query.availability,
    minimum: formatGiftPriceInput(query.priceMinMinor, locale, query.currency),
    maximum: formatGiftPriceInput(query.priceMaxMinor, locale, query.currency),
  };
}

export function GiftFilters({
  locale,
  copy,
  query,
  contextQuery,
  basePath,
}: FilterProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFor(query, locale));
  const [errors, setErrors] = useState<{ minimum?: string; maximum?: string }>(
    {},
  );
  const composing = useRef(false);
  useEffect(() => {
    const navigation = window.performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    let frame: number | undefined;
    const restore = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      // History can restore native select values after pageshow, even without
      // BFCache. Reapply the URL's filters after that browser restoration.
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        setDraft(draftFor(query, locale));
        setErrors({});
        setOpen(false);
        composing.current = false;
      });
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted || navigation?.type === "back_forward") restore();
    };
    window.addEventListener("pageshow", pageShow);
    // Hydration can subscribe after this document's pageshow event.
    if (navigation?.type === "back_forward") restore();
    return () => {
      window.removeEventListener("pageshow", pageShow);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [locale, query]);
  const resetHref = giftResetHref(query, basePath, contextQuery);
  const hint = formatStorefrontMessage(copy, "giftPriceInputHint", locale, {
    currency: query.currency,
    example: formatGiftPriceInput(
      minorAmountSchema.parse(1234),
      locale,
      query.currency,
    ),
  });

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing.current) return;
    const minimum = parseGiftPriceInput(draft.minimum, locale, query.currency);
    const maximum = parseGiftPriceInput(draft.maximum, locale, query.currency);
    const nextErrors: typeof errors = {};
    if (!minimum.valid) nextErrors.minimum = copy.giftPriceInvalid;
    if (!maximum.valid) nextErrors.maximum = copy.giftPriceInvalid;
    if (
      minimum.valid &&
      maximum.valid &&
      minimum.amountMinor !== undefined &&
      maximum.amountMinor !== undefined &&
      minimum.amountMinor > maximum.amountMinor
    )
      nextErrors.maximum = copy.giftPriceRangeInvalid;
    setErrors(nextErrors);
    if (!minimum.valid || !maximum.valid || nextErrors.maximum) {
      const input = event.currentTarget.elements.namedItem(
        nextErrors.minimum ? "priceMinimum" : "priceMaximum",
      );
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    window.location.assign(
      giftFilterHref(query, basePath, contextQuery, {
        sort: draft.sort,
        availability: draft.availability,
        ...(draft.category
          ? {
              category: draft.category as NonNullable<
                GiftDiscoveryQuery["category"]
              >,
            }
          : {}),
        ...(minimum.amountMinor !== undefined
          ? { priceMinMinor: minimum.amountMinor }
          : {}),
        ...(maximum.amountMinor !== undefined
          ? { priceMaxMinor: maximum.amountMinor }
          : {}),
      }),
    );
  }

  function form(surface: "desktop" | "mobile") {
    const prefix = `${id}-${surface}`;
    return (
      <form
        className={`gift-filter-form gift-filter-form--${surface}`}
        data-gift-filters={surface}
        onSubmit={apply}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229)
          )
            event.preventDefault();
        }}
      >
        <div className="gift-filter-selects">
          <label className="gift-filter-select" htmlFor={`${prefix}-sort`}>
            <span>{copy.giftSortLabel}</span>
            <select
              id={`${prefix}-sort`}
              data-gift-sort
              value={draft.sort}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  sort: event.target.value as GiftDiscoveryQuery["sort"],
                })
              }
            >
              <option value="RECOMMENDED">{copy.giftSortRecommended}</option>
              <option value="PRICE_ASC">{copy.giftSortPriceAsc}</option>
              <option value="PRICE_DESC">{copy.giftSortPriceDesc}</option>
            </select>
          </label>
          <label className="gift-filter-select" htmlFor={`${prefix}-category`}>
            <span>{copy.giftCategoryLabel}</span>
            <select
              id={`${prefix}-category`}
              data-gift-category
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value })
              }
            >
              <option value="">{copy.giftCategoryAll}</option>
              <option value="FLOWERS">{copy.giftCategoryFlowers}</option>
              <option value="FOOD">{copy.giftCategoryFood}</option>
              <option value="BEAUTY">{copy.giftCategoryBeauty}</option>
              <option value="ACCESSORY">{copy.giftCategoryAccessory}</option>
              <option value="OTHER">{copy.giftCategoryOther}</option>
            </select>
          </label>
          <label
            className="gift-filter-select"
            htmlFor={`${prefix}-availability`}
          >
            <span>{copy.giftAvailabilityLabel}</span>
            <select
              id={`${prefix}-availability`}
              data-gift-availability
              value={draft.availability}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  availability: event.target
                    .value as GiftDiscoveryQuery["availability"],
                })
              }
            >
              <option value="ALL">{copy.giftAvailabilityAll}</option>
              <option value="PURCHASABLE">
                {copy.giftAvailabilityPurchasable}
              </option>
              <option value="UNAVAILABLE">
                {copy.giftAvailabilityUnavailable}
              </option>
            </select>
          </label>
        </div>
        <fieldset className="gift-filter-prices">
          <legend>
            {copy.giftPriceRangeLabel} <span>({query.currency})</span>
          </legend>
          <p className="gift-filter-hint" id={`${prefix}-price-hint`}>
            {hint}
          </p>
          <div className="gift-filter-price-inputs">
            <Field
              id={`${prefix}-minimum`}
              name="priceMinimum"
              label={copy.giftPriceMinimum}
              inputMode="decimal"
              autoComplete="off"
              value={draft.minimum}
              data-gift-price-min
              data-amount-minor={query.priceMinMinor}
              aria-describedby={`${prefix}-price-hint`}
              error={errors.minimum}
              onChange={(event) =>
                setDraft({ ...draft, minimum: event.target.value })
              }
            />
            <Field
              id={`${prefix}-maximum`}
              name="priceMaximum"
              label={copy.giftPriceMaximum}
              inputMode="decimal"
              autoComplete="off"
              value={draft.maximum}
              data-gift-price-max
              data-amount-minor={query.priceMaxMinor}
              aria-describedby={`${prefix}-price-hint`}
              error={errors.maximum}
              onChange={(event) =>
                setDraft({ ...draft, maximum: event.target.value })
              }
            />
          </div>
        </fieldset>
        <div className="gift-filter-actions">
          <Button type="submit" data-gift-apply>
            {copy.giftApplyFilters}
          </Button>
          <a className="storefront-text-link" href={resetHref} data-gift-reset>
            {copy.giftResetFilters}
          </a>
        </div>
      </form>
    );
  }

  return (
    <div className="gift-filters">
      <div className="gift-filters__desktop">{form("desktop")}</div>
      <div className="gift-filters__mobile">
        <Drawer
          title={copy.giftFilters}
          description={copy.giftFiltersDescription}
          triggerLabel={copy.giftFilters}
          closeLabel={copy.close}
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            setDraft(draftFor(query, locale));
            setErrors({});
            composing.current = false;
          }}
        >
          {form("mobile")}
        </Drawer>
      </div>
    </div>
  );
}
